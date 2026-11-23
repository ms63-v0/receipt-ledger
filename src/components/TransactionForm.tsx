import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/api";
import { compressImage } from "../lib/image";
import { num, todayYmd, won } from "../lib/format";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  type Transaction,
  type TxDraft,
  type TxItem,
  type TxType,
} from "../lib/types";
import { Lightbox, Sheet } from "./Sheet";
import { Plus, Trash } from "./Icons";

export interface FormSeed {
  existing?: Transaction;
  initial?: Partial<TxDraft>;
  /** 스캔에서 넘어온 압축 사진 */
  receiptBlob?: Blob | null;
  notice?: { tone: "info" | "warn"; text: string };
}

interface Props extends FormSeed {
  onClose: () => void;
  onSaved: (tx: Transaction) => void;
  onDeleted: (tx: Transaction) => void;
}

const parseAmount = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

export function TransactionForm({ existing, initial, receiptBlob, notice, onClose, onSaved, onDeleted }: Props) {
  const src = existing ?? initial ?? {};
  const [type, setType] = useState<TxType>(src.type ?? "expense");
  const [amountText, setAmountText] = useState(src.amount ? num(src.amount) : "");
  const [date, setDate] = useState(src.occurred_on ?? todayYmd());
  const [category, setCategory] = useState(src.category ?? "식비");
  const [merchant, setMerchant] = useState(src.merchant ?? "");
  const [payment, setPayment] = useState(src.payment_method ?? "");
  const [memo, setMemo] = useState(src.memo ?? "");
  const [items, setItems] = useState<TxItem[]>(src.items ?? []);
  const [showItems, setShowItems] = useState((src.items?.length ?? 0) > 0);

  const [newReceipt, setNewReceipt] = useState<Blob | null>(receiptBlob ?? null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const categories: readonly string[] = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amount = parseAmount(amountText);
  const itemsTotal = items.reduce((s, it) => s + (it.amount || 0), 0);

  const newReceiptUrl = useMemo(() => (newReceipt ? URL.createObjectURL(newReceipt) : null), [newReceipt]);
  useEffect(() => () => { if (newReceiptUrl) URL.revokeObjectURL(newReceiptUrl); }, [newReceiptUrl]);

  useEffect(() => {
    if (existing?.receipt_path) {
      backend.receiptUrl(existing.receipt_path).then(setExistingUrl).catch(() => setExistingUrl(null));
    }
  }, [existing?.receipt_path]);

  const receiptUrl = newReceiptUrl ?? (removeReceipt ? null : existingUrl);
  const hasReceipt = Boolean(newReceipt || (existing?.receipt_path && !removeReceipt));

  function switchType(t: TxType) {
    setType(t);
    const list: readonly string[] = t === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    if (!list.includes(category)) setCategory(list[0]);
  }

  function updateItem(i: number, patch: Partial<TxItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    try {
      setNewReceipt(await compressImage(file));
      setRemoveReceipt(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (amount <= 0) return setError("금액을 입력해 주세요.");
    if (!date) return setError("날짜를 선택해 주세요.");
    setSaving(true);
    setError(null);
    try {
      const draft: TxDraft = {
        type,
        amount,
        occurred_on: date,
        category,
        merchant: merchant.trim() || null,
        payment_method: payment || null,
        memo: memo.trim() || null,
        source: existing?.source ?? initial?.source ?? "manual",
        items: type === "expense" ? items.filter((it) => it.name.trim()) : [],
        receiptFile: newReceipt,
        removeReceipt: removeReceipt && !newReceipt,
      };
      onSaved(await backend.save(draft, existing));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!window.confirm("이 내역을 삭제할까요? 첨부된 영수증 사진도 함께 삭제됩니다.")) return;
    setSaving(true);
    try {
      await backend.remove(existing);
      onDeleted(existing);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={existing ? "내역 수정" : initial?.source === "receipt" ? "인식 결과 확인" : "새 내역"}
      onClose={onClose}
      footer={
        <>
          {existing ? (
            <button className="link t-caption" onClick={remove} disabled={saving}>삭제</button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      {notice && <div className={`notice ${notice.tone === "warn" ? "warn" : ""}`}>{notice.text}</div>}

      <div className="segmented" role="radiogroup" aria-label="구분">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={type === t}
            className={`chip ${type === t ? "selected" : ""}`}
            onClick={() => switchType(t)}
          >
            {t === "expense" ? "지출" : "수입"}
          </button>
        ))}
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="amount">금액</label>
        <div className="amount-wrap">
          <input
            id="amount"
            className="field field-amount"
            inputMode="numeric"
            placeholder="0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value ? num(parseAmount(e.target.value)) : "")}
            autoFocus={!existing && !initial?.amount}
          />
        </div>
      </div>

      <div className="row-2">
        <div className="field-group">
          <label className="field-label" htmlFor="date">날짜</label>
          <input id="date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="merchant">{type === "expense" ? "사용처" : "받은 곳"}</label>
          <input id="merchant" className="field" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={type === "expense" ? "예: 이마트" : "예: 회사"} />
        </div>
      </div>

      <div className="field-group">
        <span className="field-label">카테고리</span>
        <div className="chips">
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? "selected" : ""}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <span className="field-label">결제 수단</span>
        <div className="chips">
          {PAYMENT_METHODS.map((p) => (
            <button key={p} className={`chip ${payment === p ? "selected" : ""}`} onClick={() => setPayment(payment === p ? "" : p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="memo">메모</label>
        <input id="memo" className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="선택" />
      </div>

      {type === "expense" && (
        <div className="field-group">
          <div className="card__head" style={{ marginBottom: 0 }}>
            <span className="field-label">품목 {items.length > 0 && <span className="muted">· {items.length}개</span>}</span>
            <button className="link t-caption" onClick={() => setShowItems((v) => !v)}>
              {showItems ? "접기" : items.length ? "펼치기" : "품목 추가"}
            </button>
          </div>
          {showItems && (
            <div className="items">
              {items.length > 0 && (
                <div className="items-head t-fine muted">
                  <span>품목명</span><span style={{ textAlign: "right" }}>수량</span><span style={{ textAlign: "right" }}>금액</span><span />
                </div>
              )}
              {items.map((it, i) => (
                <div className="item-row" key={i}>
                  <input className="field" value={it.name} placeholder="품목명" aria-label="품목명" onChange={(e) => updateItem(i, { name: e.target.value })} />
                  <input className="field num" inputMode="decimal" value={it.quantity} aria-label="수량" onChange={(e) => updateItem(i, { quantity: Number(e.target.value) || 0 })} />
                  <input className="field num" inputMode="numeric" value={it.amount ? num(it.amount) : ""} placeholder="0" aria-label="금액" onChange={(e) => updateItem(i, { amount: parseAmount(e.target.value) })} />
                  <button className="btn btn-icon small" aria-label="품목 삭제" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}>
                    <Trash />
                  </button>
                </div>
              ))}
              <div className="card__head" style={{ margin: 0 }}>
                <button className="btn btn-pearl" onClick={() => setItems((p) => [...p, { name: "", quantity: 1, unit_price: null, amount: 0 }])}>
                  <Plus size={14} /> 품목
                </button>
                {items.length > 0 && (
                  <span className="t-caption muted">
                    품목 합계 {won(itemsTotal)}
                    {amount > 0 && itemsTotal !== amount && (
                      <> · <button className="link" onClick={() => setAmountText(num(itemsTotal))}>총액에 반영</button></>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="field-group">
        <span className="field-label">영수증 사진</span>
        {hasReceipt ? (
          <div className="receipt-thumb">
            {receiptUrl ? (
              <img src={receiptUrl} alt="영수증" onClick={() => setLightbox(receiptUrl)} />
            ) : (
              <div className="receipt-thumb__ph spinner" />
            )}
            <div className="receipt-actions">
              {receiptUrl && <button className="link t-caption" onClick={() => setLightbox(receiptUrl)}>크게 보기</button>}
              <button className="link t-caption" onClick={() => fileRef.current?.click()}>사진 교체</button>
              <button className="link t-caption" onClick={() => { setNewReceipt(null); setRemoveReceipt(true); }}>사진 삭제</button>
            </div>
          </div>
        ) : (
          <div>
            <button className="btn btn-pearl" onClick={() => fileRef.current?.click()}>사진 첨부</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </Sheet>
  );
}
