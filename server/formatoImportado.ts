// Ajustes sobre el árbol de Pandoc (JSON) de un Word u ODT importado, para conservar su formato en
// un Markdown que la app sepa mostrar y editar:
// - Tablas: las que tienen celdas combinadas o varios párrafos por celda no caben en una tabla con
//   barras (Pandoc las dejaba como «[TABLE]», sin su contenido). Se aplanan: la celda combinada se
//   queda en la primera posición y las demás, vacías; los párrafos y listas de una celda, en una línea.
// - Estilos propios del Word (de párrafo y de carácter): se conservan como `::: {custom-style="…"}` y
//   `[texto]{custom-style="…"}`, que Pandoc vuelve a aplicar al exportar con el original de plantilla.
//   El estilo del texto normal y los estilos estándar (títulos, listas…) no se marcan.
// - Subrayado y resaltado se conservan; el ancho de las imágenes, en cm.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Nodo = { t: string; c?: any };
type Attr = [string, string[], [string, string][]];

const SIN_ATRIBUTOS: Attr = ['', [], []];

// Estilos de Word que no aportan nada propio: los genera Pandoc o los traduce a su elemento (títulos,
// listas, pies, citas…). «… Char»/«… Car» son los de carácter enlazados a un estilo de párrafo.
const PARRAFO_ESTANDAR =
  /^(normal|body text.*|first paragraph|compact|list.*|no spacing|default.*|standard|text body|table.*|caption|footnote.*|endnote.*|header|footer|plain text|normal \(web\)|contents.*|toc.*|index.*|heading.*|title|subtitle|author|date|abstract|bibliography|image caption|figure|captioned figure|source code|balloon text|comment.*|annotation.*|block text|.*\s(char|car))$/i;
const CARACTER_ESTANDAR =
  /^(default paragraph font|hyperlink|followedhyperlink|strong|emphasis|footnote.*|endnote.*|page number|line number|verbatim char|section number|.*\s(char|car))$/i;

export interface FormatoAst {
  ast: any;
  tablasAplanadas: number;
  estilos: string[]; // estilos propios que se conservan
  estiloCuerpo?: string; // estilo del texto normal (si no es «Normal»)
  estiloTabla?: string; // estilo de tabla más usado
}

const estiloDe = (attr: Attr | undefined) => attr?.[2]?.find(([k]) => k === 'custom-style')?.[1];

export function ajustarAst(ast: any, conEstilos: boolean): FormatoAst {
  // 1. Estilo del texto normal: el de párrafo más usado (si cubre casi todo, no se marca)
  const usos = new Map<string, number>();
  const usosTabla = new Map<string, number>();
  const contar = (bloques: Nodo[], estilo = 'Normal') => {
    for (const b of bloques) {
      if (b.t === 'Para' || b.t === 'Plain') usos.set(estilo, (usos.get(estilo) ?? 0) + 1);
      else if (b.t === 'Div') contar(b.c[1], estiloDe(b.c[0]) ?? estilo);
      else if (b.t === 'BlockQuote') contar(b.c, estilo);
      else if (b.t === 'Table') {
        const t = estiloDe(b.c[0]);
        if (t) usosTabla.set(t, (usosTabla.get(t) ?? 0) + 1);
      }
    }
  };
  contar(ast.blocks);
  const total = [...usos.values()].reduce((a, b) => a + b, 0);
  const [masUsado, veces] = [...usos.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['Normal', 0];
  const estiloCuerpo = masUsado !== 'Normal' && !PARRAFO_ESTANDAR.test(masUsado) && veces >= total * 0.4 ? masUsado : undefined;
  const estiloTabla = [...usosTabla.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const estilos = new Set<string>();
  let tablasAplanadas = 0;

  const conservarParrafo = (s: string | undefined) => conEstilos && !!s && s !== estiloCuerpo && !PARRAFO_ESTANDAR.test(s);
  const conservarCaracter = (s: string | undefined) => conEstilos && !!s && !CARACTER_ESTANDAR.test(s);

  // Recorre el árbol; un nodo que se «desenvuelve» devuelve { varios: [...] } y se expande en su lista
  const mapear = (x: any, enTitulo = false): any => {
    if (Array.isArray(x)) {
      const res: any[] = [];
      for (const e of x) {
        const m = mapear(e, enTitulo);
        if (m && m.varios) res.push(...m.varios);
        else res.push(m);
      }
      return unirDivs(res);
    }
    if (!x || typeof x !== 'object' || typeof x.t !== 'string') return x;
    const n = x as Nodo;
    switch (n.t) {
      case 'Header':
        return { t: 'Header', c: [n.c[0], SIN_ATRIBUTOS, mapear(n.c[2], true)] };
      case 'Div': {
        const s = estiloDe(n.c[0]);
        const hijos = mapear(n.c[1]);
        if (!conservarParrafo(s)) return { varios: hijos };
        estilos.add(s!);
        return { t: 'Div', c: [['', [], [['custom-style', s!]]], hijos] };
      }
      case 'Span': {
        const hijos = mapear(n.c[1], enTitulo);
        if (enTitulo) return { varios: hijos };
        const s = estiloDe(n.c[0]);
        if (conservarCaracter(s)) {
          estilos.add(s!);
          return { t: 'Span', c: [['', [], [['custom-style', s!]]], hijos] };
        }
        if (n.c[0][1].includes('mark')) return { t: 'Span', c: [['', ['mark'], []], hijos] };
        return { varios: hijos };
      }
      case 'Underline':
        return enTitulo ? { varios: mapear(n.c, true) } : { t: 'Underline', c: mapear(n.c) };
      case 'Image': {
        const ancho = anchoCm(n.c[0][2].find(([k]: [string, string]) => k === 'width')?.[1]);
        return { t: 'Image', c: [['', [], ancho ? [['width', ancho]] : []], mapear(n.c[1]), n.c[2]] };
      }
      case 'Figure':
        // Sin atributos (Word les pone el estilo «Captioned Figure»), para que se escriba `![pie](…)`
        return { t: 'Figure', c: [SIN_ATRIBUTOS, mapear(n.c[1]), mapear(n.c[2])] };
      case 'Link':
        return { t: 'Link', c: [SIN_ATRIBUTOS, mapear(n.c[1], enTitulo), n.c[2]] };
      case 'Table': {
        const r = aplanarTabla({ t: 'Table', c: mapear(n.c) });
        if (r.aplanada) tablasAplanadas++;
        return r.tabla;
      }
      default:
        return n.c === undefined ? n : { t: n.t, c: mapear(n.c, enTitulo) };
    }
  };

  const blocks = mapear(ast.blocks);
  return { ast: { ...ast, blocks }, tablasAplanadas, estilos: [...estilos], estiloCuerpo, estiloTabla };
}

/** Une los bloques de estilo consecutivos con el mismo estilo (Pandoc pone uno por párrafo). */
function unirDivs(lista: any[]): any[] {
  const res: any[] = [];
  for (const b of lista) {
    const prev = res[res.length - 1];
    if (b?.t === 'Div' && prev?.t === 'Div' && estiloDe(b.c[0]) && estiloDe(b.c[0]) === estiloDe(prev.c[0])) {
      res[res.length - 1] = { t: 'Div', c: [prev.c[0], [...prev.c[1], ...b.c[1]]] };
    } else res.push(b);
  }
  return res;
}

/** Ancho de una imagen en cm («3.5in», «250px», «8cm»…), o en % si venía así. */
export function anchoCm(v: string | undefined): string | undefined {
  const m = v?.trim().match(/^([\d.]+)\s*(in|cm|mm|px|pt|%)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!(n > 0)) return undefined;
  if (m[2] === '%') return `${Math.round(n)}%`;
  const factor = { in: 2.54, cm: 1, mm: 0.1, pt: 2.54 / 72, px: 2.54 / 96 }[(m[2] ?? 'px') as 'in'];
  return `${Math.round(n * factor * 10) / 10}cm`;
}

// ---------- Tablas ----------

const celda = (alin: Nodo, inlines: Nodo[]) => [SIN_ATRIBUTOS, alin, 1, 1, inlines.length ? [{ t: 'Plain', c: inlines }] : []];
const ESPACIO: Nodo = { t: 'Space' };

/**
 * Deja la tabla con una fila de cabecera y celdas de un solo párrafo, sin combinar, para que se pueda
 * escribir con barras. `aplanada` indica si se ha perdido algo de su forma (no de su contenido).
 */
export function aplanarTabla(tabla: Nodo): { tabla: Nodo; aplanada: boolean } {
  const [, caption, colspecs, head, bodies, foot] = tabla.c;
  const ncols = colspecs.length;
  let aplanada = false;
  const filasCabecera: any[] = head[1];
  const filas: any[] = [...filasCabecera, ...bodies.flatMap((b: any) => [...b[2], ...b[3]]), ...foot[1]];
  const ocupado = new Set<string>();
  const rejilla: any[][] = filas.map((fila, r) => {
    const res: any[] = new Array(ncols).fill(null);
    let col = 0;
    for (const c of fila[1]) {
      while (col < ncols && ocupado.has(`${r},${col}`)) col++;
      if (col >= ncols) break;
      const [, alin, rs, cs, bloques] = c;
      if (rs > 1 || cs > 1) aplanada = true;
      const { inlines, varios } = aInlines(bloques);
      if (varios) aplanada = true;
      res[col] = celda(alin, inlines);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (dr || dc) ocupado.add(`${r + dr},${col + dc}`);
      col += cs;
    }
    return res.map((x) => x ?? celda({ t: 'AlignDefault' }, []));
  });
  if (filasCabecera.length > 1) aplanada = true;
  const nCab = Math.min(1, filasCabecera.length);
  const fila = (celdas: any[]) => [SIN_ATRIBUTOS, celdas];
  return {
    aplanada,
    tabla: {
      t: 'Table',
      c: [
        SIN_ATRIBUTOS,
        caption,
        colspecs.map((cs: any) => [cs[0], { t: 'ColWidthDefault' }]),
        [SIN_ATRIBUTOS, rejilla.slice(0, nCab).map(fila)],
        [[SIN_ATRIBUTOS, 0, [], rejilla.slice(nCab).map(fila)]],
        [SIN_ATRIBUTOS, []],
      ],
    },
  };
}

/** El contenido de una celda en una sola línea: párrafos separados por « · », listas con «•». */
function aInlines(bloques: Nodo[]): { inlines: Nodo[]; varios: boolean } {
  const partes: Nodo[][] = [];
  const añadir = (bs: Nodo[]) => {
    for (const b of bs) {
      switch (b.t) {
        case 'Para':
        case 'Plain':
          partes.push(b.c);
          break;
        case 'Header':
          partes.push([{ t: 'Strong', c: b.c[2] }]);
          break;
        case 'BulletList':
          for (const item of b.c) partes.push([{ t: 'Str', c: '•' }, ESPACIO, ...aInlines(item).inlines]);
          break;
        case 'OrderedList':
          b.c[1].forEach((item: Nodo[], i: number) => partes.push([{ t: 'Str', c: `${b.c[0][0] + i}.` }, ESPACIO, ...aInlines(item).inlines]));
          break;
        case 'Div':
          añadir(b.c[1]);
          break;
        case 'BlockQuote':
          añadir(b.c);
          break;
        case 'Figure':
          añadir(b.c[2]);
          break;
        case 'CodeBlock':
          partes.push([{ t: 'Code', c: [SIN_ATRIBUTOS, b.c[1].replace(/\s*\n\s*/g, ' ')] }]);
          break;
        case 'LineBlock':
          for (const l of b.c) partes.push(l);
          break;
        case 'Table': {
          // Tabla dentro de una celda: sus celdas, en línea
          const t = aplanarTabla(b).tabla.c;
          for (const f of [...t[3][1], ...t[4][0][3]]) {
            const textos = f[1].map((c: any) => c[4][0]?.c ?? []).filter((x: Nodo[]) => x.length);
            partes.push(textos.flatMap((x: Nodo[], i: number) => (i ? [ESPACIO, { t: 'Str', c: '|' }, ESPACIO, ...x] : x)));
          }
          break;
        }
      }
    }
  };
  añadir(bloques);
  const inlines = partes
    .filter((p) => p.length)
    .flatMap((p, i) => (i === 0 ? p : p[0]?.t === 'Str' && p[0].c === '•' ? [ESPACIO, ...p] : [ESPACIO, { t: 'Str', c: '·' }, ESPACIO, ...p]));
  return { inlines: sinSaltos(inlines), varios: partes.filter((p) => p.length).length > 1 };
}

/** Los saltos de línea no caben en una celda con barras. */
function sinSaltos(x: any): any {
  if (Array.isArray(x)) return x.map(sinSaltos);
  if (!x || typeof x !== 'object') return x;
  if (x.t === 'LineBreak' || x.t === 'SoftBreak') return ESPACIO;
  if (x.t === 'Note') return x; // las notas al pie van fuera de la tabla
  return x.c === undefined ? x : { t: x.t, c: sinSaltos(x.c) };
}
