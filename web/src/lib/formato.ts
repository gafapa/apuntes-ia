/** 1234 → «1,2 k», 2500000 → «2,5 M». */
export function abreviar(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toLocaleString('es', { maximumFractionDigits: n < 10_000 ? 1 : 0 })} k`;
  return `${(n / 1_000_000).toLocaleString('es', { maximumFractionDigits: 1 })} M`;
}
