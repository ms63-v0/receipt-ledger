import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/api";
import { compressImage } from "../lib/image";
import { todayYmd, won } from "../lib/format";
import { Sheet } from "./Sheet";
import { Camera, Photo } from "./Icons";
import type { FormSeed } from "./TransactionForm";

interface Props {
  onClose: () => void;
  onResult: (seed: FormSeed) => void;
}

type Phase = "pick" | "reading" | "error";

export function ReceiptScanner({ onClose, onResult }: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

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
    setPhase("reading");
    await read(compressed);
  }

  async function read(image: Blob) {
    setPhase("reading");
    try {
      const r = await backend.parseReceipt(image);
      if (!r.is_receipt) {
        onResult({
          initial: { type: "expense", source: "receipt", occurred_on: todayYmd(), category: "기타", items: [] },
          receiptBlob: image,
          notice: { tone: "warn", text: "영수증으로 보이지 않아요. 사진은 첨부해 두었으니 내용을 직접 입력해 주세요." },
        });
        return;
      }
      const itemsTotal = r.items.reduce((s, it) => s + it.amount, 0);
      const mismatch = r.items.length > 0 && itemsTotal !== r.total;
      onResult({
        initial: {
          type: "expense",
          source: "receipt",
          amount: r.total,
          occurred_on: r.date ?? todayYmd(),
          category: r.category,
          merchant: r.merchant,
          payment_method: r.payment_method,
          items: r.items,
        },
        receiptBlob: image,
        notice: {
          tone: !r.date || mismatch ? "warn" : "info",
          text: [
            "자동으로 채웠어요. 저장하기 전에 금액과 날짜를 한 번 확인해 주세요.",
            !r.date && "날짜를 읽지 못해 오늘 날짜로 넣었어요.",
            mismatch && `품목 합계(${won(itemsTotal)})가 총액과 달라요. 할인·봉투값 등을 확인해 주세요.`,
          ]
            .filter(Boolean)
            .join(" "),
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  return (
    <Sheet title="영수증 스캔" onClose={onClose}>
      {phase === "pick" && (
        <>
          <p className="t-body muted" style={{ margin: 0 }}>
            영수증 전체가 보이도록 밝은 곳에서 찍어 주세요. 가게, 날짜, 품목, 금액을 자동으로 채워 드려요.
          </p>
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
          {backend.mode === "demo" && (
            <p className="notice" style={{ margin: 0 }}>데모 모드에서는 어떤 사진을 올려도 예시 결과가 채워져요. Supabase를 연결하면 Gemini가 실제로 인식합니다.</p>
          )}
        </>
      )}

      {previewUrl && phase !== "pick" && <img className="scan-preview" src={previewUrl} alt="선택한 영수증" />}

      {phase === "reading" && (
        <div className="center" aria-live="polite">
          <div className="spinner" />
          <span className="t-body">영수증을 읽는 중…</span>
          <span className="t-caption muted">보통 3~8초 걸려요</span>
        </div>
      )}

      {phase === "error" && (
        <div className="center">
          <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {blob && <button className="btn btn-primary" onClick={() => read(blob)}>다시 인식</button>}
            <button className="btn btn-secondary" onClick={() => { setBlob(null); setPhase("pick"); }}>다른 사진</button>
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
