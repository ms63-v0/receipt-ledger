import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/api";
import { compressImage } from "../lib/image";
import { todayYmd, won } from "../lib/format";
import { krwRate, money } from "../lib/fx";
import { RECEIPT_LANGS, type ParsedReceipt, type ReceiptLang } from "../lib/types";
import { Sheet } from "./Sheet";
import { Camera, Photo } from "./Icons";
import type { FormSeed } from "./TransactionForm";

interface Props {
  onClose: () => void;
  onResult: (seed: FormSeed) => void;
}

type Phase = "pick" | "reading" | "error";

const LANG_KEY = "receipt-ledger-lang";
const loadLang = (): ReceiptLang => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return RECEIPT_LANGS.some((l) => l.id === v) ? (v as ReceiptLang) : "ko";
  } catch {
    return "ko";
  }
};

/** 인식 결과 → 폼 초기값 (외화면 원화로 환산) */
async function toSeed(r: ParsedReceipt, image: Blob): Promise<FormSeed> {
  const foreign = r.currency !== "KRW";
  const rate = foreign ? await krwRate(r.currency) : 1;
  const conv = (n: number) => (rate ? Math.round(n * rate) : 0);

  const items = r.items.map((it) => ({ ...it, amount: foreign ? conv(it.amount) : Math.round(it.amount) }));
  const itemsTotal = r.items.reduce((s, it) => s + it.amount, 0);
  const mismatch = r.items.length > 0 && Math.abs(itemsTotal - r.total) > 0.009;

  const notes = ["자동으로 채웠어요. 저장하기 전에 금액과 날짜를 확인해 주세요."];
  if (!r.date) notes.push("날짜를 읽지 못해 오늘 날짜로 넣었어요.");
  if (foreign && rate) notes.push(`${money(r.total, r.currency)}를 오늘 환율(1 ${r.currency} = ${rate.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}원)로 환산했어요.`);
  if (foreign && !rate) notes.push(`${money(r.total, r.currency)} 영수증이에요. 환율을 불러오지 못했으니 환율을 직접 입력해 주세요.`);
  if (mismatch) notes.push(`품목 합계(${foreign ? money(itemsTotal, r.currency) : won(itemsTotal)})가 총액과 달라요. 할인·봉투값 등을 확인해 주세요.`);

  return {
    initial: {
      type: "expense",
      source: "receipt",
      amount: foreign ? conv(r.total) : Math.round(r.total),
      occurred_on: r.date ?? todayYmd(),
      category: r.category,
      merchant: r.merchant,
      payment_method: r.payment_method,
      currency: r.currency,
      original_amount: foreign ? r.total : null,
      exchange_rate: foreign ? rate : null,
      items,
    },
    receiptBlob: image,
    notice: { tone: !r.date || mismatch || (foreign && !rate) ? "warn" : "info", text: notes.join(" ") },
  };
}

export function ReceiptScanner({ onClose, onResult }: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [lang, setLang] = useState<ReceiptLang>(loadLang);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function chooseLang(l: ReceiptLang) {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* noop */
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    let compressed: Blob;
    try {
      compressed = await compressImage(file);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      return;
    }
    setBlob(compressed);
    await read(compressed);
  }

  async function read(image: Blob) {
    setPhase("reading");
    try {
      const r = await backend.parseReceipt(image, lang);
      if (!r.is_receipt) {
        onResult({
          initial: { type: "expense", source: "receipt", occurred_on: todayYmd(), category: "기타", items: [] },
          receiptBlob: image,
          notice: { tone: "warn", text: "영수증으로 보이지 않아요. 사진은 첨부해 두었으니 내용을 직접 입력해 주세요." },
        });
        return;
      }
      onResult(await toSeed(r, image));
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const langLabel = RECEIPT_LANGS.find((l) => l.id === lang)?.label;

  return (
    <Sheet title="영수증 스캔" onClose={onClose}>
      {phase === "pick" && (
        <>
          <div className="field-group">
            <span className="field-label">영수증 언어</span>
            <div className="segmented four" role="radiogroup" aria-label="영수증 언어">
              {RECEIPT_LANGS.map((l) => (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={lang === l.id}
                  className={`chip ${lang === l.id ? "selected" : ""}`}
                  onClick={() => chooseLang(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <span className="t-caption muted">외화 영수증은 오늘 환율로 원화 환산해 드려요.</span>
          </div>
          <div className="scan-pick">
            <button className="scan-option" onClick={() => cameraRef.current?.click()}>
              <Camera />
              <span className="t-body-strong">카메라로 촬영</span>
            </button>
            <button className="scan-option" onClick={() => albumRef.current?.click()}>
              <Photo />
              <span className="t-body-strong">앨범에서 선택</span>
            </button>
          </div>
          <p className="t-caption muted" style={{ margin: 0 }}>
            영수증 전체가 보이도록 밝은 곳에서 찍어 주세요.
          </p>
          {backend.mode === "demo" && (
            <p className="notice" style={{ margin: 0 }}>데모 모드에서는 어떤 사진을 올려도 선택한 언어의 예시 결과가 채워져요.</p>
          )}
        </>
      )}

      {previewUrl && phase !== "pick" && <img className="scan-preview" src={previewUrl} alt="선택한 영수증" />}

      {phase === "reading" && (
        <div className="center" aria-live="polite">
          <div className="spinner" />
          <span className="t-body">{langLabel} 영수증을 읽는 중…</span>
          <span className="t-caption muted">보통 3~8초 걸려요</span>
        </div>
      )}

      {phase === "error" && (
        <div className="center">
          <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {blob && <button className="btn btn-primary" onClick={() => read(blob)}>다시 인식</button>}
            <button className="btn btn-secondary" onClick={() => { setBlob(null); setPhase("pick"); }}>언어·사진 바꾸기</button>
            {blob && (
              <button
                className="link t-body"
                onClick={() => onResult({ initial: { type: "expense", source: "receipt", occurred_on: todayYmd() }, receiptBlob: blob })}
              >
                직접 입력하기
              </button>
            )}
          </div>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={albumRef} type="file" accept="image/*" hidden onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
    </Sheet>
  );
}
