// Supabase Edge Function: parse-receipt
// 영수증 이미지(base64)를 받아 Gemini로 구조화된 JSON(가게, 날짜, 품목, 합계, 카테고리)을 돌려준다.
//
// 필요한 시크릿:
//   supabase secrets set GEMINI_API_KEY=...
//   (선택) supabase secrets set GEMINI_MODEL=gemini-flash-latest
//
// 요청:  POST { image: "<base64, data: 접두사 없이>", mimeType: "image/jpeg" }
// 응답:  200 { receipt: ParsedReceipt }  |  4xx/5xx { error: string }

import { createClient } from "jsr:@supabase/supabase-js@2";

const EXPENSE_CATEGORIES = [
  "식비",
  "카페·간식",
  "생활·마트",
  "교통",
  "쇼핑",
  "의료·건강",
  "문화·여가",
  "주거·통신",
  "교육",
  "기타",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BASE64_LENGTH = 8 * 1024 * 1024; // ≈ 6MB 이미지

// Gemini responseSchema (OpenAPI 서브셋)
const responseSchema = {
  type: "OBJECT",
  properties: {
    is_receipt: { type: "BOOLEAN", description: "이미지가 영수증/결제 전표인지 여부" },
    merchant: { type: "STRING", nullable: true, description: "가게(상호) 이름" },
    date: { type: "STRING", nullable: true, description: "결제일 YYYY-MM-DD" },
    total: { type: "INTEGER", description: "최종 결제 금액(원). 할인 반영 후 실제 낸 금액" },
    category: { type: "STRING", enum: EXPENSE_CATEGORIES },
    payment_method: { type: "STRING", nullable: true, description: "예: 신용카드, 체크카드, 현금, 카카오페이" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          quantity: { type: "NUMBER" },
          unit_price: { type: "INTEGER", nullable: true },
          amount: { type: "INTEGER" },
        },
        required: ["name", "quantity", "amount"],
        propertyOrdering: ["name", "quantity", "unit_price", "amount"],
      },
    },
  },
  required: ["is_receipt", "total", "category", "items"],
  propertyOrdering: ["is_receipt", "merchant", "date", "total", "category", "payment_method", "items"],
};

function buildPrompt(today: string) {
  return [
    "너는 한국 영수증을 가계부 데이터로 정리하는 도우미야.",
    "이미지에서 다음을 추출해:",
    "- merchant: 상호명 (지점명은 포함해도 됨). 사업자번호·주소는 제외.",
    `- date: 결제 일자를 YYYY-MM-DD로. 연도가 없거나 두 자리면 오늘(${today}) 기준으로 가장 가까운 과거 날짜로 판단. 알 수 없으면 null.`,
    "- total: 실제로 결제된 최종 금액(원, 정수). '합계', '받을금액', '결제금액', '승인금액' 등을 우선. 부가세는 따로 더하지 마.",
    "- items: 구매 품목. 수량, 단가, 금액(원 정수). 할인 줄은 음수 금액 품목으로 넣어도 됨. 품목을 읽을 수 없으면 빈 배열.",
    "- category: 가게와 품목을 보고 가장 알맞은 카테고리 하나.",
    "- payment_method: 보이는 경우만.",
    "금액의 쉼표·'원'은 제거하고 숫자만. 확실하지 않은 글자는 추측하지 말고 가장 그럴듯한 값을 쓰되 지어내지 마.",
    "영수증이 아니면 is_receipt=false, total=0, items=[] 로.",
  ].join("\n");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST만 지원합니다." }, 405);

  // 1) 로그인한 사용자만 허용
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "로그인이 필요합니다." }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "로그인이 필요합니다." }, 401);

  // 2) 입력 검증
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." }, 500);
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

  let body: { image?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }
  const image = body.image?.replace(/^data:[^;]+;base64,/, "");
  const mimeType = body.mimeType ?? "image/jpeg";
  if (!image) return json({ error: "image가 비어 있습니다." }, 400);
  if (image.length > MAX_BASE64_LENGTH) return json({ error: "이미지가 너무 큽니다." }, 413);
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return json({ error: "지원하지 않는 이미지 형식입니다." }, 400);

  // 3) Gemini 호출
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: image } },
              { text: buildPrompt(today) },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    },
  );

  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error("Gemini error", geminiRes.status, detail);
    return json({ error: `영수증 인식에 실패했습니다. (Gemini ${geminiRes.status})` }, 502);
  }

  const geminiJson = await geminiRes.json();
  const text: string | undefined = geminiJson?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) return json({ error: "인식 결과가 비어 있습니다." }, 502);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("JSON parse failed", text);
    return json({ error: "인식 결과를 해석하지 못했습니다." }, 502);
  }

  // 4) 후처리·정규화
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const receipt = {
    is_receipt: parsed.is_receipt !== false,
    merchant: typeof parsed.merchant === "string" ? parsed.merchant.trim() || null : null,
    date: normalizeDate(parsed.date),
    total: toInt(parsed.total),
    category: EXPENSE_CATEGORIES.includes(parsed.category as string) ? parsed.category : "기타",
    payment_method: typeof parsed.payment_method === "string" ? parsed.payment_method : null,
    items: items
      .map((it: Record<string, unknown>) => ({
        name: String(it.name ?? "").trim(),
        quantity: Number(it.quantity) || 1,
        unit_price: it.unit_price == null ? null : toInt(it.unit_price),
        amount: toInt(it.amount),
      }))
      .filter((it: { name: string }) => it.name.length > 0),
  };

  // 합계를 못 읽었으면 품목 합으로 대체
  if (receipt.total <= 0 && receipt.items.length > 0) {
    receipt.total = receipt.items.reduce((s: number, it: { amount: number }) => s + it.amount, 0);
  }

  return json({ receipt, model });
});
