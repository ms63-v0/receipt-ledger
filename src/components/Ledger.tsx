import { useCallback, useEffect, useMemo, useState } from "react";
import { backend, type AppUser } from "../lib/api";
import { parseYmd, todayYmd, won, ymd } from "../lib/format";
import type { Transaction } from "../lib/types";
import { Calendar, type DayTotal } from "./Calendar";
import { DayPanel } from "./DayPanel";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { TransactionForm, type FormSeed } from "./TransactionForm";
import { ReceiptScanner } from "./ReceiptScanner";
import { ChevronLeft, ChevronRight, ReceiptIcon } from "./Icons";

export function Ledger({ user }: { user: AppUser }) {
  const today = parseYmd(todayYmd());
  const [year, setYear] = useState(today.y);
  const [month, setMonth] = useState(today.m);
  const [selected, setSelected] = useState(todayYmd());
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormSeed | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTxs(await backend.listMonth(year, month));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    setYear(y);
    setMonth(m);
    setSelected(y === today.y && m === today.m ? todayYmd() : ymd(y, m, 1));
  }

  const totals = useMemo(() => {
    const map: Record<string, DayTotal> = {};
    for (const t of txs) {
      const cur = (map[t.occurred_on] ??= { income: 0, expense: 0 });
      cur[t.type] += t.amount;
    }
    return map;
  }, [txs]);

  const monthIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthExpense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const dayItems = txs.filter((t) => t.occurred_on === selected);

  function afterSave(tx: Transaction) {
    setForm(null);
    const { y, m } = parseYmd(tx.occurred_on);
    setSelected(tx.occurred_on);
    if (y !== year || m !== month) {
      setYear(y);
      setMonth(m);
    } else {
      load();
    }
  }

  return (
    <>
      <nav className="global-nav">
        <div className="global-nav__inner">
          <span className="global-nav__brand"><ReceiptIcon size={16} /> 영수증 가계부</span>
          <div className="global-nav__right">
            {backend.mode === "demo" ? <span className="badge-demo">데모 모드</span> : <span className="badge-demo">{user.email}</span>}
            <button onClick={() => backend.signOut()}>{backend.mode === "demo" ? "데모 초기화" : "로그아웃"}</button>
          </div>
        </div>
      </nav>

      <div className="sub-nav">
        <div className="sub-nav__inner">
          <div className="month-switch">
            <button className="btn btn-icon small" onClick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeft /></button>
            <span className="t-tagline" aria-live="polite">{year}년 {month}월</span>
            <button className="btn btn-icon small" onClick={() => moveMonth(1)} aria-label="다음 달"><ChevronRight /></button>
          </div>
          <div className="sub-nav__actions">
            <button className="btn btn-secondary btn-sm hide-sm" onClick={() => setForm({ initial: { occurred_on: selected } })}>직접 입력</button>
            <button className="btn btn-primary btn-sm" onClick={() => setScanning(true)}>영수증 스캔</button>
          </div>
        </div>
      </div>

      <section className="tile-dark" aria-label="이번 달 요약">
        <div className="summary__label t-body on-dark-muted">{month}월 지출</div>
        <div className="t-hero">{won(monthExpense)}</div>
        <div className="summary__row">
          <div>
            <span className="t-caption on-dark-muted">수입</span>
            <span className="t-body-strong">{won(monthIncome)}</span>
          </div>
          <div>
            <span className="t-caption on-dark-muted">남은 돈</span>
            <span className="t-body-strong">{monthIncome - monthExpense < 0 ? "−" : ""}{won(Math.abs(monthIncome - monthExpense))}</span>
          </div>
          <div>
            <span className="t-caption on-dark-muted">기록</span>
            <span className="t-body-strong">{txs.length}건</span>
          </div>
        </div>
      </section>

      <main className="main">
        <section className="card" aria-label="달력">
          {error ? (
            <div className="empty-state">
              <p className="error-text">{error}</p>
              <button className="btn btn-secondary btn-sm" onClick={load}>다시 시도</button>
            </div>
          ) : (
            <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .2s" }}>
              <Calendar year={year} month={month} totals={totals} selected={selected} onSelect={setSelected} />
            </div>
          )}
        </section>

        <div className="stack">
          <DayPanel
            date={selected}
            items={dayItems}
            onOpen={(tx) => setForm({ existing: tx })}
            onAdd={() => setForm({ initial: { occurred_on: selected } })}
          />
          <CategoryBreakdown items={txs} />
        </div>
      </main>

      <footer className="footer">
        <div className="footer__inner t-fine">
          영수증 인식 결과는 틀릴 수 있어요. 저장 전에 금액과 날짜를 확인해 주세요.
        </div>
      </footer>

      {scanning && (
        <ReceiptScanner
          onClose={() => setScanning(false)}
          onResult={(seed) => { setScanning(false); setForm(seed); }}
        />
      )}
      {form && (
        <TransactionForm
          {...form}
          onClose={() => setForm(null)}
          onSaved={afterSave}
          onDeleted={() => { setForm(null); load(); }}
        />
      )}
    </>
  );
}
