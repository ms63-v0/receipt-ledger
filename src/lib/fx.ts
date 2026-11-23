/** 1 단위 외화 = ? 원 (Frankfurter: 유럽중앙은행 기준환율, 키 불필요) */
export async function krwRate(currency: string): Promise<number | null> {
  if (currency === "KRW") return 1;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(currency)}&symbols=KRW`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = Number(data?.rates?.KRW);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

const SYMBOLS: Record<string, string> = { KRW: "₩", USD: "$", JPY: "¥", CNY: "¥", EUR: "€", GBP: "£", TWD: "NT$", HKD: "HK$" };

export function money(n: number, currency: string) {
  const digits = currency === "KRW" || currency === "JPY" ? 0 : 2;
  const s = n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return `${SYMBOLS[currency] ?? ""}${s} ${currency}`;
}
