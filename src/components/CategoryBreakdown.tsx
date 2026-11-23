import { won } from "../lib/format";
import type { Transaction } from "../lib/types";

export function CategoryBreakdown({ items }: { items: Transaction[] }) {
  const map = new Map<string, number>();
  for (const t of items) if (t.type === "expense") map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);

  return (
    <section className="card" aria-label="카테고리별 지출">
      <div className="card__head">
        <span className="t-body-strong">카테고리별 지출</span>
      </div>
      {rows.length === 0 ? (
        <p className="t-body muted" style={{ margin: 0 }}>이번 달 지출이 아직 없어요.</p>
      ) : (
        <ul className="cat-list">
          {rows.map(([cat, v]) => (
            <li key={cat}>
              <div className="cat-line t-caption">
                <span>{cat}</span>
                <span>
                  {won(v)} <span className="muted">· {Math.round((v / total) * 100)}%</span>
                </span>
              </div>
              <div className="bar"><span style={{ width: `${(v / rows[0][1]) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
