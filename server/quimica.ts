// Traducción de la notación química mhchem (\ce{…}, \pu{…}) a LaTeX normal para exportar: Pandoc no
// la entiende. Se usa la librería oficial de mhchem y se simplifica su salida.
import { mhchemParser } from 'mhchemparser';

/** Quita de la salida de mhchem los ajustes tipográficos que Pandoc no entiende. */
function simplificar(tex: string): string {
  let t = sinMathrel(tex);
  for (let i = 0; i < 6; i++) {
    const antes = t;
    t = t
      .replace(/\\[vh]phantom\{[^{}]*\}/g, '')
      .replace(/\\smash\[[tb]\]\{([^{}]*)\}/g, '$1')
      .replace(/\\smash\{([^{}]*)\}/g, '$1')
      .replace(/\\[lr]lap\{([^{}]*)\}/g, '$1')
      .replace(/\{\}\^\{\}_\{\}/g, '')
      .replace(/\{\s*\}(?=[_^])/g, '{}');
    if (t === antes) break;
  }
  return t
    .replace(/\\mkern-?[\d.]+mu/g, '')
    .replace(/\\mskip-?[\d.]+mu/g, '\\,')
    .replace(/\\long(right|left)(leftharpoons|rightharpoons)/g, '\\rightleftharpoons')
    .replace(/\\longleftrightarrows|\\longrightleftarrows/g, '\\rightleftarrows')
    .replace(/\\longLeftrightharpoons|\\longRightleftharpoons/g, '\\rightleftharpoons')
    .replace(/\\x(?:long)?(rightleftharpoons|leftrightharpoons)/g, '\\xrightarrow')
    .replace(/\{\}\+\{\}/g, '+')
    .replace(/\{\}(\\(?:long)?(?:right|left)\w*arrow\w*|\\rightleftharpoons|\\rightleftarrows|\\xrightarrow)/g, '$1')
    .replace(/(\\(?:long)?(?:right|left)\w*arrow\w*|\\rightleftharpoons|\\rightleftarrows)\{\}/g, '$1')
    .replace(/(\\(?:up|down)arrow)\{\}/g, '$1')
    // «H{}_{2}»: el grupo vacío sirve a LaTeX para alinear, pero en Word se ve como un hueco
    .replace(/([}\])a-zA-Z0-9])\{\}(?=[_^])/g, '$1');
}

/** «\mathrel{X}» → «X» (con X entre llaves anidadas). */
function sinMathrel(t: string): string {
  for (let i = t.indexOf('\\mathrel{'); i >= 0; i = t.indexOf('\\mathrel{', i)) {
    const g = grupo(t, i + '\\mathrel'.length);
    if (!g) break;
    t = t.slice(0, i) + g.contenido + t.slice(g.fin);
  }
  return t;
}

/** Contenido de un grupo entre llaves que empieza en `inicio` (la posición de «{»). */
function grupo(texto: string, inicio: number): { contenido: string; fin: number } | undefined {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '\\') {
      i++;
      continue;
    }
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) return { contenido: texto.slice(inicio + 1, i), fin: i + 1 };
  }
  return undefined;
}

/** Traduce cada \ce{…} y \pu{…} de un texto a LaTeX que entiende Pandoc. */
export function traducirQuimica(texto: string): string {
  if (!/\\(ce|pu)\s*\{/.test(texto)) return texto;
  let res = '';
  let i = 0;
  const re = /\\(ce|pu)\s*(?=\{)/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const g = grupo(texto, m.index + m[0].length);
    if (!g) break;
    let tex: string;
    try {
      tex = simplificar(mhchemParser.toTex(g.contenido, m[1] as 'ce' | 'pu'));
    } catch {
      tex = `\\text{${g.contenido}}`;
    }
    res += texto.slice(i, m.index) + tex;
    i = g.fin;
    re.lastIndex = g.fin;
  }
  return res + texto.slice(i);
}
