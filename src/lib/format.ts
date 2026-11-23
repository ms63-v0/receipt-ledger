export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const num = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 부호 붙은 짧은 금액 (달력 셀용) */
export function signed(n: number, type: "income" | "expense") {
  return `${type === "income" ? "+" : "−"}${num(n)}`;
}

/** 달력 모바일용 짧은 금액: 12,300 / 12.3만 / 320만 / 1.2억 */
export function compact(n: number) {
  const a = Math.abs(n);
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (a >= 100_000_000) return `${trim(a / 100_000_000)}억`;
  if (a >= 1_000_000) return `${Math.round(a / 10_000).toLocaleString("ko-KR")}만`;
  if (a >= 100_000) return `${trim(a / 10_000)}만`;
  return Math.round(a).toLocaleString("ko-KR");
}

const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function todayYmd() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** 해당 월의 달력 칸 (일요일 시작). null은 빈 칸 */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthRange(year: number, month: number) {
  const start = ymd(year, month, 1);
  const next = month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1);
  return { start, next };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function dayLabel(s: string) {
  const { y, m, d } = parseYmd(s);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 ${wd}요일`;
}

export { WEEKDAYS };
