export type TxType = "income" | "expense";
export type TxSource = "manual" | "receipt";
export type ReceiptLang = "ko" | "en" | "ja" | "zh";

export const RECEIPT_LANGS: { id: ReceiptLang; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "zh", label: "中文" },
];

export interface TxItem {
  id?: string;
  name: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  occurred_on: string; // YYYY-MM-DD
  category: string;
  merchant: string | null;
  memo: string | null;
  payment_method: string | null;
  receipt_path: string | null;
  source: TxSource;
  /** 원래 통화 (amount 는 항상 원화) */
  currency: string;
  original_amount: number | null;
  exchange_rate: number | null;
  items: TxItem[];
  created_at: string;
}

/** 저장 요청 시 프론트가 넘기는 값 */
export interface TxDraft {
  type: TxType;
  amount: number;
  occurred_on: string;
  category: string;
  merchant: string | null;
  memo: string | null;
  payment_method: string | null;
  source: TxSource;
  currency: string;
  original_amount: number | null;
  exchange_rate: number | null;
  items: TxItem[];
  /** 새로 첨부한(압축된) 영수증 사진 */
  receiptFile?: Blob | null;
  /** 기존 영수증 사진을 지울지 */
  removeReceipt?: boolean;
}

/** parse-receipt Edge Function 응답 */
export interface ParsedReceipt {
  is_receipt: boolean;
  merchant: string | null;
  date: string | null;
  currency: string;
  total: number;
  category: string;
  payment_method: string | null;
  items: TxItem[];
}

export const EXPENSE_CATEGORIES = [
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
] as const;

export const INCOME_CATEGORIES = ["급여", "용돈", "부수입", "환급", "이자·배당", "기타"] as const;

export const PAYMENT_METHODS = ["신용카드", "체크카드", "현금", "계좌이체", "간편결제"] as const;
