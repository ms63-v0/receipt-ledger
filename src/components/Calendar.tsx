import { compact, monthGrid, num, parseYmd, todayYmd, WEEKDAYS } from "../lib/format";

export interface DayTotal {
  income: number;
  expense: number;
}

interface Props {
  year: number;
  month: number;
  totals: Record<string, DayTotal>;
  selected: string;
  onSelect: (date: string) => void;
}

export function Calendar({ year, month, totals, selected, onSelect }: Props) {
  const cells = monthGrid(year, month);
  const today = todayYmd();

  return (
    <div className="cal" role="grid" aria-label={`${year}년 ${month}월`}>
      {WEEKDAYS.map((w, i) => (
        <div key={w} className={`cal-weekday t-caption ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`} role="columnheader">
          {w}
        </div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`e${i}`} className="cal-cell empty" aria-hidden />;
        const t = totals[date];
        const hasData = Boolean(t && (t.income || t.expense));
        const cls = [
          "cal-cell",
          hasData && "has-data",
          date === today && "today",
          date === selected && "selected",
          i % 7 === 0 && "sun",
          i % 7 === 6 && "sat",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={date}
            className={cls}
            role="gridcell"
            aria-selected={date === selected}
            aria-label={`${parseYmd(date).d}일${t?.expense ? `, 지출 ${t.expense}원` : ""}${t?.income ? `, 수입 ${t.income}원` : ""}`}
            onClick={() => onSelect(date)}
          >
            <span className="cal-day">{parseYmd(date).d}</span>
            {t?.income ? (
              <span className="cal-amt income">
                <span className="full">+{num(t.income)}</span>
                <span className="short">+{compact(t.income)}</span>
              </span>
            ) : null}
            {t?.expense ? (
              <span className="cal-amt expense">
                <span className="full">−{num(t.expense)}</span>
                <span className="short">−{compact(t.expense)}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
