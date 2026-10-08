// Pies de figura y de tabla. Toda imagen, esquema, diagrama y tabla lleva pie:
// - Imagen: `![Pie](recursos/x.png)` en su propio párrafo.
// - Diagrama: bloque ```mermaid seguido de la línea `*Figura: pie*`.
// - Tabla: línea `Tabla: pie` justo antes o después de la tabla.
// Al exportar, lo que no tenga pie recibe uno genérico numerado, y en Word/ODT los pies
// se numeran («Figura 3.», «Tabla 1.»), como hace Typst en el PDF.
import { PATRON_MERMAID } from '../shared/hash';
import { PATRON_MOLECULA, consultaMolecula } from '../shared/quimica';

export interface ElementoSinPie {
  tipo: 'imagen' | 'diagrama' | 'molecula' | 'tabla';
  muestra: string;
}

const IMAGEN_SOLA = /^!\[([^\]]*)\]\(([^)\s]+)\)(\{[^}]*\})?\s*$/;
// Admite «Tabla: …», «Tabla 3. …», «*Tabla: …*», «**Tabla 3:** …» y la sintaxis de Pandoc «: …»
const PIE_TABLA = /^\s*\*{0,2}(?:Tabla|Table)\s*\d*\s*[:.]\*{0,2}\s*(.+?)\*{0,2}\s*$|^\s*:\s+(.+?)\s*$/;
const esFilaTabla = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const esSeparadorTabla = (l: string) => /^\s*\|?\s*:?-{3,}/.test(l);

/** Elementos sin pie en el Markdown de una sección (para avisar al usuario). */
export function elementosSinPie(md: string): ElementoSinPie[] {
  const res: ElementoSinPie[] = [];
  for (const m of md.matchAll(PATRON_MERMAID)) {
    if (!m[2]?.trim()) res.push({ tipo: 'diagrama', muestra: m[1].trim().split('\n').slice(0, 2).join(' ').slice(0, 80) });
  }
  for (const m of md.matchAll(PATRON_MOLECULA)) {
    if (!m[2]?.trim()) res.push({ tipo: 'molecula', muestra: consultaMolecula(m[1]) });
  }
  const lineas = sinBloquesDeCodigo(md).split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const img = lineas[i].trim().match(IMAGEN_SOLA);
    if (img && !img[1].trim()) res.push({ tipo: 'imagen', muestra: img[2] });
    if (esFilaTabla(lineas[i]) && esSeparadorTabla(lineas[i + 1] ?? '') && !esFilaTabla(lineas[i - 1] ?? '')) {
      let fin = i + 2;
      while (fin < lineas.length && esFilaTabla(lineas[fin])) fin++;
      if (!pieDeTabla(lineas, i, fin)) res.push({ tipo: 'tabla', muestra: lineas[i].trim().slice(0, 80) });
    }
  }
  return res;
}

function sinBloquesDeCodigo(md: string) {
  return md.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '));
}

/** Busca el pie de una tabla (líneas [inicio, fin)) en la línea no vacía anterior o posterior. */
function pieDeTabla(lineas: string[], inicio: number, fin: number): { linea: number; texto: string } | undefined {
  const cercana = (desde: number, paso: number) => {
    for (let j = desde, n = 0; j >= 0 && j < lineas.length && n < 2; j += paso, n++) {
      if (lineas[j].trim()) return j;
    }
    return -1;
  };
  for (const j of [cercana(fin, 1), cercana(inicio - 1, -1)]) {
    const m = j >= 0 ? lineas[j].match(PIE_TABLA) : null;
    if (m) return { linea: j, texto: (m[1] ?? m[2]).replace(/^\*(.*)\*$/, '$1') };
  }
  return undefined;
}

/**
 * Prepara pies para la exportación: todos los elementos con pie, numerados en Word/ODT.
 * `diagrama(codigo)` devuelve la ruta de la imagen del diagrama o undefined si no se pudo dibujar.
 */
export function prepararPies(md: string, formato: 'docx' | 'odt' | 'pdf', textos: { figura: string; tabla: string }, conPies = true) {
  const numerar = formato !== 'pdf'; // Typst ya numera («Figura 3:»)
  let nFig = 0;
  let nTab = 0;
  const pie = (tipo: 'fig' | 'tab', texto: string) => {
    const n = tipo === 'fig' ? ++nFig : ++nTab;
    const t = texto.trim();
    const limpio = t ? t[0].toLocaleUpperCase('es') + t.slice(1) : '';
    if (!numerar) return limpio || '​'; // pie vacío pero presente: Typst pone «Figura N:»
    return `${tipo === 'fig' ? textos.figura : textos.tabla} ${n}${limpio ? `. ${limpio}` : ''}`;
  };

  const lineas = md.split('\n');
  const res: string[] = [];
  let enCodigo = false;
  const quitar = new Set<number>(); // líneas de pie de tabla ya movidas
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^\s*(```|~~~)/.test(l)) enCodigo = !enCodigo;
    if (enCodigo || quitar.has(i)) {
      if (!quitar.has(i)) res.push(l);
      continue;
    }
    const img = l.trim().match(IMAGEN_SOLA);
    if (img) {
      // La línea «*Fuente: …*» de las imágenes de internet pasa a formar parte del pie
      let texto = img[1];
      let j = i + 1;
      while (j < lineas.length && !lineas[j].trim()) j++;
      const fuente = lineas[j]?.trim().match(/^\*(Fuente:[^*]+)\*$/);
      if (fuente && conPies) {
        texto = `${texto.replace(/\.?\s*$/, '')}. ${fuente[1]}`;
        quitar.add(j);
      }
      if (conPies) {
        res.push(`![${pie('fig', texto)}](${img[2]})${img[3] ?? ''}`);
      } else if (formato === 'pdf') {
        // Sin pie, Pandoc la trataría como imagen en línea (alineada a la izquierda): se centra a mano
        const ancho = img[3]?.match(/width=([\d.]+cm)/)?.[1];
        res.push('```{=typst}', `#align(center, image("${img[2].replace(/"/g, '')}"${ancho ? `, width: ${ancho}` : ''}))`, '```');
      } else {
        res.push(`![](${img[2]})${img[3] ?? ''}`); // se centra al retocar el Word/ODT
      }
      continue;
    }
    if (esFilaTabla(l) && esSeparadorTabla(lineas[i + 1] ?? '') && !esFilaTabla(lineas[i - 1] ?? '')) {
      let fin = i + 2;
      while (fin < lineas.length && esFilaTabla(lineas[fin])) fin++;
      const p = pieDeTabla(lineas, i, fin);
      if (p) {
        quitar.add(p.linea);
        // Pies repetidos tras el primero (p. ej. añadidos dos veces por un agente): se descartan
        for (let k = p.linea + 1; k < lineas.length; k++) {
          if (!lineas[k].trim()) continue;
          if (PIE_TABLA.test(lineas[k]) && !esFilaTabla(lineas[k + 1] ?? '') && !esFilaTabla(lineas[k + 2] ?? '')) quitar.add(k);
          else break;
        }
        // Si el pie estaba antes de la tabla, ya se copió: se retira de la salida
        if (p.linea < i) {
          const k = res.lastIndexOf(lineas[p.linea]);
          if (k >= 0) res.splice(k, 1);
        }
      }
      res.push(...lineas.slice(i, fin), ...(conPies ? ['', `: ${pie('tab', p?.texto ?? '')}`] : []));
      i = fin - 1;
      continue;
    }
    res.push(l);
  }
  return res.join('\n');
}
