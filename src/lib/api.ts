import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ParsedReceipt, Transaction, TxDraft, TxItem } from "./types";
import { blobToBase64, blobToDataUrl } from "./image";
import { monthRange, todayYmd, ymd } from "./format";

export interface AppUser {
  id: string;
  email: string | null;
}

export interface Backend {
  mode: "supabase" | "demo";
  getUser(): Promise<AppUser | null>;
  onAuthChange(cb: (user: AppUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  listMonth(year: number, month: number): Promise<Transaction[]>;
  save(draft: TxDraft, existing?: Transaction): Promise<Transaction>;
  remove(tx: Transaction): Promise<void>;
  receiptUrl(path: string): Promise<string>;
  parseReceipt(image: Blob): Promise<ParsedReceipt>;
}

const sortItems = (items: (TxItem & { position?: number })[] | null | undefined) =>
  [...(items ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------
function createSupabaseBackend(sb: SupabaseClient): Backend {
  const toUser = (u: { id: string; email?: string | null } | null | undefined): AppUser | null =>
    u ? { id: u.id, email: u.email ?? null } : null;

  async function requireUser() {
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error("로그인이 필요합니다.");
    return data.user;
  }

  return {
    mode: "supabase",

    async getUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "이메일 또는 비밀번호가 맞지 않습니다." : error.message);
    },

    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      return { needsConfirmation: !data.session };
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listMonth(year, month) {
      const { start, next } = monthRange(year, month);
      const { data, error } = await sb
        .from("transactions")
        .select("*, items:transaction_items(*)")
        .gte("occurred_on", start)
        .lt("occurred_on", next)
        .order("occurred_on", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({ ...row, items: sortItems(row.items) })) as Transaction[];
    },

    async save(draft, existing) {
      const user = await requireUser();
      let receipt_path = existing?.receipt_path ?? null;
      const oldPath = receipt_path;

      if (draft.receiptFile) {
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage
          .from("receipts")
          .upload(path, draft.receiptFile, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(`사진 업로드 실패: ${error.message}`);
        receipt_path = path;
      } else if (draft.removeReceipt) {
        receipt_path = null;
      }

      const row = {
        type: draft.type,
        amount: draft.amount,
        occurred_on: draft.occurred_on,
        category: draft.category,
        merchant: draft.merchant,
        memo: draft.memo,
        payment_method: draft.payment_method,
        source: draft.source,
        receipt_path,
      };

      const query = existing
        ? sb.from("transactions").update(row).eq("id", existing.id).select().single()
        : sb.from("transactions").insert(row).select().single();
      const { data: tx, error } = await query;
      if (error) throw new Error(error.message);

      // 품목은 통째로 교체
      if (existing) {
        const { error: delErr } = await sb.from("transaction_items").delete().eq("transaction_id", tx.id);
        if (delErr) throw new Error(delErr.message);
      }
      const items = draft.items
        .filter((it) => it.name.trim())
        .map((it, i) => ({
          transaction_id: tx.id,
          name: it.name.trim(),
          quantity: it.quantity,
          unit_price: it.unit_price,
          amount: it.amount,
          position: i,
        }));
      if (items.length) {
        const { error: itemErr } = await sb.from("transaction_items").insert(items);
        if (itemErr) throw new Error(itemErr.message);
      }

      // 바뀐/지운 옛 사진 정리
      if (oldPath && oldPath !== receipt_path) {
        await sb.storage.from("receipts").remove([oldPath]);
      }

      return { ...(tx as Transaction), items: draft.items };
    },

    async remove(tx) {
      const { error } = await sb.from("transactions").delete().eq("id", tx.id);
      if (error) throw new Error(error.message);
      if (tx.receipt_path) await sb.storage.from("receipts").remove([tx.receipt_path]);
    },

    async receiptUrl(path) {
      const { data, error } = await sb.storage.from("receipts").createSignedUrl(path, 60 * 10);
      if (error || !data) throw new Error("사진을 불러오지 못했습니다.");
      return data.signedUrl;
    },

    async parseReceipt(image) {
      const base64 = await blobToBase64(image);
      const { data, error } = await sb.functions.invoke("parse-receipt", {
        body: { image: base64, mimeType: image.type || "image/jpeg" },
      });
      if (error) {
        let message = "영수증 인식에 실패했습니다.";
        try {
          const ctx = (error as { context?: Response }).context;
          const body = ctx ? await ctx.json() : null;
          if (body?.error) message = body.error;
        } catch {
          /* noop */
        }
        throw new Error(message);
      }
      return data.receipt as ParsedReceipt;
    },
  };
}

// ---------------------------------------------------------------------
// 데모 모드: Supabase 설정 없이 화면을 확인할 수 있도록 localStorage 사용
// ---------------------------------------------------------------------
const DEMO_KEY = "receipt-ledger-demo-v1";
const DEMO_IMG_KEY = "receipt-ledger-demo-images-v1";

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("브라우저 저장 공간이 부족합니다. (데모 모드)");
  }
}

function seedDemo(): Transaction[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const last = Math.min(now.getDate(), new Date(y, m, 0).getDate());
  const d = (day: number) => ymd(y, m, Math.min(day, last));
  const mk = (p: Partial<Transaction> & Pick<Transaction, "type" | "amount" | "occurred_on" | "category">): Transaction => ({
    id: crypto.randomUUID(),
    merchant: null,
    memo: null,
    payment_method: null,
    receipt_path: null,
    source: "manual",
    items: [],
    created_at: new Date().toISOString(),
    ...p,
  });
  return [
    mk({ type: "income", amount: 3200000, occurred_on: d(1), category: "급여", merchant: "회사", payment_method: "계좌이체" }),
    mk({ type: "expense", amount: 4500, occurred_on: d(2), category: "카페·간식", merchant: "블루보틀 성수", payment_method: "체크카드" }),
    mk({
      type: "expense", amount: 38900, occurred_on: d(3), category: "생활·마트", merchant: "이마트 성수점", payment_method: "신용카드", source: "receipt",
      items: [
        { name: "신라면 멀티팩", quantity: 1, unit_price: 4980, amount: 4980 },
        { name: "서울우유 1L", quantity: 2, unit_price: 2980, amount: 5960 },
        { name: "삼겹살 500g", quantity: 1, unit_price: 17960, amount: 17960 },
        { name: "양파 1.5kg", quantity: 1, unit_price: 10000, amount: 10000 },
      ],
    }),
    mk({ type: "expense", amount: 1550, occurred_on: d(3), category: "교통", merchant: "지하철", payment_method: "체크카드" }),
    mk({ type: "expense", amount: 12000, occurred_on: d(5), category: "식비", merchant: "을지면옥", payment_method: "신용카드" }),
    mk({ type: "expense", amount: 69000, occurred_on: d(8), category: "주거·통신", merchant: "통신요금", payment_method: "계좌이체" }),
    mk({ type: "expense", amount: 15000, occurred_on: d(10), category: "문화·여가", merchant: "CGV 왕십리", payment_method: "간편결제" }),
    mk({ type: "income", amount: 50000, occurred_on: d(12), category: "용돈", memo: "생일 용돈" }),
    mk({ type: "expense", amount: 27400, occurred_on: d(14), category: "식비", merchant: "배달", payment_method: "간편결제" }),
  ];
}

function createDemoBackend(): Backend {
  const demoUser: AppUser = { id: "demo", email: "demo@local" };
  const load = (): Transaction[] => {
    const existing = readStore<Transaction[] | null>(DEMO_KEY, null);
    if (existing) return existing;
    const seeded = seedDemo();
    writeStore(DEMO_KEY, seeded);
    return seeded;
  };
  const images = () => readStore<Record<string, string>>(DEMO_IMG_KEY, {});

  return {
    mode: "demo",
    async getUser() {
      return demoUser;
    },
    onAuthChange() {
      return () => {};
    },
    async signIn() {},
    async signUp() {
      return { needsConfirmation: false };
    },
    async signOut() {
      localStorage.removeItem(DEMO_KEY);
      localStorage.removeItem(DEMO_IMG_KEY);
      location.reload();
    },
    async listMonth(year, month) {
      const { start, next } = monthRange(year, month);
      return load()
        .filter((t) => t.occurred_on >= start && t.occurred_on < next)
        .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at));
    },
    async save(draft, existing) {
      const all = load();
      const imgs = images();
      let receipt_path = existing?.receipt_path ?? null;
      if (draft.receiptFile) {
        if (receipt_path) delete imgs[receipt_path];
        receipt_path = `demo/${crypto.randomUUID()}.jpg`;
        imgs[receipt_path] = await blobToDataUrl(draft.receiptFile);
      } else if (draft.removeReceipt && receipt_path) {
        delete imgs[receipt_path];
        receipt_path = null;
      }
      writeStore(DEMO_IMG_KEY, imgs);

      const { receiptFile: _f, removeReceipt: _r, ...rest } = draft;
      const tx: Transaction = {
        id: existing?.id ?? crypto.randomUUID(),
        created_at: existing?.created_at ?? new Date().toISOString(),
        ...rest,
        items: draft.items.filter((it) => it.name.trim()),
        receipt_path,
      };
      writeStore(DEMO_KEY, existing ? all.map((t) => (t.id === tx.id ? tx : t)) : [...all, tx]);
      return tx;
    },
    async remove(tx) {
      writeStore(DEMO_KEY, load().filter((t) => t.id !== tx.id));
      if (tx.receipt_path) {
        const imgs = images();
        delete imgs[tx.receipt_path];
        writeStore(DEMO_IMG_KEY, imgs);
      }
    },
    async receiptUrl(path) {
      const url = images()[path];
      if (!url) throw new Error("사진을 찾을 수 없습니다.");
      return url;
    },
    async parseReceipt() {
      await new Promise((r) => setTimeout(r, 1400));
      return {
        is_receipt: true,
        merchant: "GS25 성수역점 (데모)",
        date: todayYmd(),
        total: 9300,
        category: "카페·간식",
        payment_method: "체크카드",
        items: [
          { name: "삼각김밥 참치마요", quantity: 2, unit_price: 1500, amount: 3000 },
          { name: "바나나우유", quantity: 1, unit_price: 1700, amount: 1700 },
          { name: "컵라면 육개장", quantity: 1, unit_price: 1300, amount: 1300 },
          { name: "아메리카노 RTD", quantity: 1, unit_price: 3300, amount: 3300 },
        ],
      };
    },
  };
}

// ---------------------------------------------------------------------
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const backend: Backend =
  url && anon ? createSupabaseBackend(createClient(url, anon)) : createDemoBackend();
