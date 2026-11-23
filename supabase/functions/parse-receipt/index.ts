// Supabase Edge Function: parse-receipt
// 영수증 이미지(base64)를 Gemini로 읽어 구조화된 JSON을 돌려준다.
//
// 시크릿:
//   GEMINI_API_KEY            (필수)
//   GEMINI_MODEL              (선택, 기본 gemini-3.5-flash-lite  — 저렴·빠름)
//   GEMINI_FALLBACK_MODEL     (선택, 기본 gemini-3.8-flash      — 혼잡/실패 시 사용)
//
// 요청:  POST { image: "<base64>", mimeType: "image/jpeg", lang: "ko" | "en" | "ja" | "zh" }
// 응답:  200 { receipt, model }  |  4xx/5xx { error }
//
// 토큰 절약:
//  - 이미지 media_resolution: 기본 모델 medium(≈560 토큰), 폴백 모델 high(≈1120 토큰)
//  - thinkingLevel: low  (단순 추출 작업)
//  - maxOutputTokens 상한, 짧은 영어 프롬프트, JSON 스키마로 출력 형식 고정

import { createClient } from "jsr:@supabase/supabase-js@2";

const PRIMARY_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "gemini-3.8-flash";

const CATEGORIES = ["식비", "카페·간식", "생활·마트", "교통", "쇼핑", "의료·건강", "문화·여가", "주거·통신", "교육", "기타"];

const LANGS: Record<string, { name: string; currency: string }> = {
  ko: { name: "Korean", currency: "KRW" },
  en: { name: "English", currency: "USD" },
  ja: { name: "Japanese", currency: "JPY" },
  zh: { name: "Chinese (Simplified or Traditional)", currency: "CNY" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BASE64_LENGTH = 8 * 1024 * 1024;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// JSON Schema (responseJsonSchema)
const schema = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    merchant: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    currency: { type: "string", description: "ISO 4217, e.g. KRW JPY USD CNY" },
    total: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    payment_method: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          amount: { type: "number" },
        },
        required: ["name", "quantity", "amount"],
      },
    },
  },
  required: ["is_receipt", "currency", "total", "category", "items"],
};

function prompt(lang: string, today: string) {
  const l = LANGS[lang] ?? LANGS.ko;
  return `Extract this receipt (printed mainly in ${l.name}) into the JSON schema.
- merchant: store name as printed (original script). No address/tax id.
- date: purchase date YYYY-MM-DD. If year missing, use the latest date not after ${today}. null if unreadable.
- currency: from symbols/text; if none, assume ${l.currency}.
- total: final amount actually paid (after discounts). Number only.
- items: purchased lines, names as printed. Discounts may be negative amounts. [] if unreadable.
- category: best fit from the enum (enum values are Korean).
- payment_method: in Korean (e.g. 신용카드, 현금, 간편결제) if visible, else null.
Do not invent values. If not a receipt: is_receipt=false, total=0, items=[].`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const toNum = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const normalizeDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallResult {
  ok: boolean;
  status: number;
  text?: string;
  detail?: string;
}

async function callGemini(
  apiKey: string,
  model: string,
  image: string,
  mimeType: string,
  text: string,
  resolution: "media_resolution_medium" | "media_resolution_high",
  advanced: boolean,
): Promise<CallResult> {
  const imagePart: Record<string, unknown> = { inline_data: { mime_type: mimeType, data: image } };
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema: schema,
    maxOutputTokens: 2048,
  };
  if (advanced) {
    imagePart.mediaResolution = { level: resolution };
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [imagePart, { text }] }], generationConfig }),
  });

  if (!res.ok) return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };

  const data = await res.json();
  const out: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  const usage = data?.usageMetadata;
  console.log(`gemini ${model} tokens in=${usage?.promptTokenCount} out=${usage?.candidatesTokenCount} think=${usage?.thoughtsTokenCount ?? 0}`);
  return { ok: true, status: 200, text: out };
}

/** 기본 모델 → (혼잡 시 1회 재시도) → 폴백 모델 */
async function extract(apiKey: string, image: string, mimeType: string, text: string) {
  const plan: { model: string; res: "media_resolution_medium" | "media_resolution_high" }[] = [
    { model: PRIMARY_MODEL, res: "media_resolution_medium" },
    { model: PRIMARY_MODEL, res: "media_resolution_medium" },
    { model: FALLBACK_MODEL, res: "media_resolution_high" },
  ];
  let last: CallResult = { ok: false, status: 0 };

  for (let i = 0; i < plan.length; i++) {
    const { model, res } = plan[i];
    // 같은 모델 재시도는 혼잡(재시도 가능 오류)일 때만
    if (i === 1 && !RETRYABLE.has(last.status)) continue;
    if (i === 1) await sleep(900);

    let r = await callGemini(apiKey, model, image, mimeType, text, res, true);
    // 모델이 thinkingLevel/mediaResolution 을 지원하지 않으면 기본 설정으로 한 번 더
    if (r.status === 400) r = await callGemini(apiKey, model, image, mimeType, text, res, false);

    if (r.ok && r.text) {
      try {
        return { parsed: JSON.parse(r.text) as Record<string, unknown>, model };
      } catch {
        console.error(`JSON parse failed (${model})`, r.text.slice(0, 300));
        last = { ok: false, status: 502 };
        continue;
      }
    }
    console.error(`Gemini ${model} ${r.status}`, r.detail);
    last = r;
    // 키/권한 문제는 다른 모델로 바꿔도 소용없음
    if (r.status === 401 || r.status === 403) break;
  }
  return { error: last };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST만 지원합니다." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "로그인이 필요합니다." }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "로그인이 필요합니다." }, 401);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." }, 500);

  let body: { image?: string; mimeType?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }
  const image = body.image?.replace(/^data:[^;]+;base64,/, "");
  const mimeType = body.mimeType ?? "image/jpeg";
  const lang = body.lang && LANGS[body.lang] ? body.lang : "ko";
  if (!image) return json({ error: "image가 비어 있습니다." }, 400);
  if (image.length > MAX_BASE64_LENGTH) return json({ error: "이미지가 너무 큽니다." }, 413);
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return json({ error: "지원하지 않는 이미지 형식입니다." }, 400);

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST
  const result = await extract(apiKey, image, mimeType, prompt(lang, today));

  if ("error" in result) {
    const s = result.error.status;
    const msg = RETRYABLE.has(s)
      ? "Gemini 서버가 혼잡해요. 잠시 후 다시 시도해 주세요."
      : s === 401 || s === 403
        ? "Gemini API 키가 올바르지 않거나 권한이 없습니다."
        : s === 404
          ? "Gemini 모델을 찾을 수 없습니다. GEMINI_MODEL 설정을 확인해 주세요."
          : "영수증 인식에 실패했습니다.";
    return json({ error: `${msg} (${s || "unknown"})` }, 502);
  }

  const p = result.parsed;
  const items = (Array.isArray(p.items) ? p.items : [])
    .map((it: Record<string, unknown>) => ({
      name: String(it.name ?? "").trim(),
      quantity: Number(it.quantity) || 1,
      unit_price: null,
      amount: toNum(it.amount),
    }))
    .filter((it: { name: string }) => it.name);

  const currency = typeof p.currency === "string" && /^[A-Za-z]{3}$/.test(p.currency.trim())
    ? p.currency.trim().toUpperCase()
    : LANGS[lang].currency;

  let total = toNum(p.total);
  if (total <= 0 && items.length) total = items.reduce((s: number, it: { amount: number }) => s + it.amount, 0);

  return json({
    model: result.model,
    receipt: {
      is_receipt: p.is_receipt !== false,
      merchant: typeof p.merchant === "string" ? p.merchant.trim() || null : null,
      date: normalizeDate(p.date),
      currency,
      total,
      category: CATEGORIES.includes(p.category as string) ? p.category : "기타",
      payment_method: typeof p.payment_method === "string" ? p.payment_method : null,
      items,
    },
  });
});
