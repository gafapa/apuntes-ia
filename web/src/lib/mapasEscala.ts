// Escalas de los mapas de datos (coropletas): cortes por cuantiles o por intervalos iguales y la
// gama de colores de las clases. Sin DOM, para poder probarlo.

export type MetodoCortes = 'cuantiles' | 'iguales';

/** Los `clases - 1` límites entre clases, de menor a mayor y sin repetir. */
export function cortes(valores: number[], clases: number, metodo: MetodoCortes = 'cuantiles'): number[] {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2 || clases < 2) return [];
  const min = v[0];
  const max = v[v.length - 1];
  const res: number[] = [];
  for (let i = 1; i < clases; i++) {
    let c: number;
    if (metodo === 'iguales') c = min + ((max - min) * i) / clases;
    else {
      // Cuantil con interpolación lineal
      const pos = ((v.length - 1) * i) / clases;
      const b = Math.floor(pos);
      c = v[b] + (v[Math.min(b + 1, v.length - 1)] - v[b]) * (pos - b);
    }
    c = redondear(c);
    if (c > min && c < max && !res.includes(c)) res.push(c);
  }
  // Con muchos valores repetidos los cuantiles no separan nada: intervalos iguales
  return res.length || metodo === 'iguales' || min === max ? res : cortes(v, clases, 'iguales');
}

/** Clase (0…cortes.length) de un valor: la primera cuyo límite superior lo contiene. */
export function claseDe(valor: number, limites: number[]): number {
  const i = limites.findIndex((c) => valor <= c);
  return i === -1 ? limites.length : i;
}

/** Redondea a 3 cifras significativas para que la leyenda se lea bien (12 345 → 12 300; 0,04567 → 0,0457). */
export function redondear(x: number): number {
  return x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(3));
}

const aRgb = (hex: string): [number, number, number] => {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) throw new Error(`Color no válido: ${hex}`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const aHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** `n` colores repartidos a lo largo de la gama que forman `paradas` (dos o más colores). */
export function gama(paradas: string[], n: number): string[] {
  const p = paradas.map(aRgb);
  if (n <= 1) return [aHex(p[p.length - 1])];
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (p.length - 1);
    const a = Math.min(Math.floor(t), p.length - 2);
    const f = t - a;
    return aHex(p[a].map((c, k) => c + (p[a + 1][k] - c) * f));
  });
}

/** Texto de cada clase para la leyenda: «≤ 9,1», «9,1 – 12,4», «> 20,3». */
export function textosClases(limites: number[], unidad = ''): string[] {
  const f = (x: number) => `${x.toLocaleString('es', { maximumFractionDigits: 3 })}${unidad ? ` ${unidad}` : ''}`;
  if (!limites.length) return [];
  return [
    `≤ ${f(limites[0])}`,
    ...limites.slice(1).map((c, i) => `${f(limites[i])} – ${f(c)}`),
    `> ${f(limites[limites.length - 1])}`,
  ];
}
