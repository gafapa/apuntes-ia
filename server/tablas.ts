// Anchos de columna de las tablas al exportar.
//
// Cuando una fila de una tabla Markdown es larga, Pandoc reparte el ancho según los guiones de
// la línea separadora (|---|---|---|). Como los agentes ponen siempre tres guiones, todas las
// columnas salían iguales: una columna con «No» ocupaba lo mismo que otra con frases largas.
// Aquí se reescribe la línea separadora con guiones proporcionales al contenido de cada columna.

const esFila = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const esSeparador = (l: string) => /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/.test(l);

/** Celdas de una fila (sin contar las barras escapadas ni las que hay dentro de `código`). */
function celdas(fila: string): string[] {
  const res: string[] = [];
  let actual = '';
  let enCodigo = false;
  const t = fila.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && t[i + 1] === '|') {
      actual += '\\|';
      i++;
    } else if (c === '`') {
      enCodigo = !enCodigo;
      actual += c;
    } else if (c === '|' && !enCodigo) {
      res.push(actual);
      actual = '';
    } else actual += c;
  }
  res.push(actual);
  return res.map((x) => x.trim());
}

/** Longitud «visible» de una celda (sin la sintaxis Markdown). */
function largo(celda: string) {
  return celda
    .replace(/\*\*|__|`|\\\|/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\$[^$]*\$/g, 'xxxx').length;
}

/** Palabra más larga de una celda; el código en monoespaciada ocupa más que el texto normal. */
function palabraMasLarga(celda: string) {
  let max = 0;
  for (const [, codigo, texto] of celda.matchAll(/`([^`]*)`|([^`]+)/g)) {
    for (const p of (codigo ?? texto ?? '').split(/\s+/)) {
      max = Math.max(max, Math.ceil(largo(p) * (codigo !== undefined ? 1.25 : 1)));
    }
  }
  return max;
}

export function ajustarAnchos(md: string): string {
  const lineas = md.split('\n');
  let enCodigo = false;
  for (let i = 0; i < lineas.length - 1; i++) {
    if (/^\s*(```|~~~)/.test(lineas[i])) enCodigo = !enCodigo;
    if (enCodigo || !esFila(lineas[i]) || !esSeparador(lineas[i + 1]) || (i > 0 && esFila(lineas[i - 1]))) continue;
    let fin = i + 2;
    while (fin < lineas.length && esFila(lineas[fin])) fin++;
    const filas = [lineas[i], ...lineas.slice(i + 2, fin)].map(celdas);
    const sep = celdas(lineas[i + 1]);
    const n = sep.length;
    // Peso de cada columna: mezcla de la celda más larga y la media, nunca menos que la palabra
    // más larga (las palabras ya no se parten y el código no puede cortarse) más el margen interior
    const pesos = Array.from({ length: n }, (_, c) => {
      const largos = filas.map((f) => largo(f[c] ?? ''));
      const maximo = Math.max(...largos, 3);
      const medio = largos.reduce((a, b) => a + b, 0) / Math.max(1, largos.length);
      const palabra = Math.max(...filas.map((f) => palabraMasLarga(f[c] ?? '')), 3) + 3;
      return Math.max(palabra, Math.min(60, Math.max(6, Math.round(0.6 * maximo + 0.4 * medio))));
    });
    const separador = sep.map((s, c) => {
      const izq = s.startsWith(':') ? ':' : '';
      const der = s.endsWith(':') ? ':' : '';
      return izq + '-'.repeat(Math.max(3, pesos[c] - izq.length - der.length)) + der;
    });
    lineas[i + 1] = `|${separador.join('|')}|`;
    i = fin - 1;
  }
  return lineas.join('\n');
}
