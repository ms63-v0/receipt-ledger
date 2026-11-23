import { dayLabel, num, signed } from "../lib/format";
import type { Transaction } from "../lib/types";
import { ReceiptIcon } from "./Icons";
import { money } from "../lib/fx";

interface Props {
  date: string;
  items: Transaction[];
  onOpen: (tx: Transaction) => void;
  onAdd: () => void;
}

export function DayPanel({ date, items, onOpen, onAdd }: Props) {
  const income = items.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = items.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  return (
    <section className="card" aria-label={`${dayLabel(date)} 내역`}>
      <div className="card__head">
        <span className="t-body-strong">{dayLabel(date)}</span>
        <button className="link t-caption" onClick={onAdd}>이 날짜에 추가</button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p className="t-body muted">이 날은 기록이 없어요.</p>
        </div>
      ) : (
        <>
          <div className="day-totals t-caption">
            {income > 0 && <span><span className="muted">수입</span> <span className="amt-income">+{num(income)}원</span></span>}
            {expense > 0 && <span><span className="muted">지출</span> <span className="amt-expense">−{num(expense)}원</span></span>}
          </div>
          <ul className="tx-list">
            {items.map((tx) => (
              <li key={tx.id}>
                <button className="tx-row" onClick={() => onOpen(tx)}>
                  <span className="tx-icon" aria-hidden>{tx.category.slice(0, 1)}</span>
                  <span className="tx-row__main">
                    <span className="tx-row__title t-body" style={{ display: "block" }}>
                      {tx.merchant || tx.category}
                      {tx.receipt_path && (
                        <span className="receipt-mark" title="영수증 첨부됨"><ReceiptIcon size={15} /></span>
                      )}
                    </span>
                    <span className="t-caption muted">
                      {tx.category}
                      {tx.currency !== "KRW" && tx.original_amount != null && ` · ${money(tx.original_amount, tx.currency)}`}
                      {tx.payment_method && ` · ${tx.payment_method}`}
                      {tx.items.length > 0 && ` · 품목 ${tx.items.length}개`}
                      {tx.memo && ` · ${tx.memo}`}
                    </span>
                  </span>
                  <span className={`tx-row__amt t-body ${tx.type}`}>{signed(tx.amount, tx.type)}원</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
