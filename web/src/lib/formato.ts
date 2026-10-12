// Los formateadores se crean una vez: toLocaleString con opciones crea uno en cada llamada (lento
// en listas que se redibujan a menudo, como la de los trabajos de los agentes)
const entero = new Intl.NumberFormat('es');
const unDecimal = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const sinDecimales = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });

/** 1234567 → «1.234.567». */
export const numero = (n: number) => entero.format(n);

/** 1234 → «1,2 k», 2500000 → «2,5 M». */
export function abreviar(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n < 10_000 ? unDecimal : sinDecimales).format(n / 1000)} k`;
  return `${unDecimal.format(n / 1_000_000)} M`;
}
