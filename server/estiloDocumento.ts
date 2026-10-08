// Espaciado y aspecto de los documentos de Word y LibreOffice. Los estilos por defecto de
// Pandoc dejan todo muy junto: texto, listas, figuras, tablas y pies casi sin aire.
// Solo se aplica cuando la asignatura no tiene una plantilla propia.

// ---------------------------------------------------------------------------
// Orden de los elementos: Word exige el orden del esquema dentro de pPr, rPr y tblPr;
// si no se respeta, puede decir que el documento tiene «contenido ilegible».

const ORDEN: Record<'pPr' | 'rPr' | 'tblPr', string[]> = {
  pPr: ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'],
  rPr: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'],
  tblPr: ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'],
};

/** Elementos hijos de primer nivel de un fragmento XML de Word. */
function hijos(xml: string): { nombre: string; xml: string }[] {
  const res: { nombre: string; xml: string }[] = [];
  const re = /<w:([A-Za-z]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/w:\1>)/g;
  for (const m of xml.matchAll(re)) res.push({ nombre: m[1], xml: m[0] });
  return res;
}

/** Sustituye o añade elementos dentro de un pPr/rPr/tblPr respetando el orden del esquema. */
export function fusionar(tipo: keyof typeof ORDEN, dentro: string, nuevos: string): string {
  const n = hijos(nuevos);
  const nombres = new Set(n.map((x) => x.nombre));
  const todos = [...hijos(dentro).filter((x) => !nombres.has(x.nombre)), ...n];
  const orden = ORDEN[tipo];
  const pos = (x: { nombre: string }) => {
    const i = orden.indexOf(x.nombre);
    return i < 0 ? orden.length : i;
  };
  return todos
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => pos(a) - pos(b) || a.i - b.i)
    .map((x) => x.xml)
    .join('');
}

/** Aplica `fusionar` a todas las apariciones de <w:tipo>…</w:tipo> (o lo crea tras la etiqueta de apertura). */
export function ajustar(xml: string, tipo: keyof typeof ORDEN, nuevos: string): string {
  if (new RegExp(`<w:${tipo}>`).test(xml)) {
    return xml.replace(new RegExp(`<w:${tipo}>([\\s\\S]*?)</w:${tipo}>`), (_m, d: string) => `<w:${tipo}>${fusionar(tipo, d, nuevos)}</w:${tipo}>`);
  }
  if (new RegExp(`<w:${tipo}\\s*/>`).test(xml)) return xml.replace(new RegExp(`<w:${tipo}\\s*/>`), `<w:${tipo}>${fusionar(tipo, '', nuevos)}</w:${tipo}>`);
  return xml;
}

// ---------------------------------------------------------------------------
// Word (styles.xml). Medidas en veinteavos de punto (240 = 12 pt); tamaños en medios puntos.

interface EstiloWord {
  antes?: number;
  despues?: number;
  interlineado?: number; // 240 = sencillo
  sangria?: number;
  tamano?: number;
  color?: string;
  negrita?: boolean;
  cursiva?: boolean;
  mantenerConSiguiente?: boolean;
  nombre?: string; // para crear el estilo si no existe
  basadoEn?: string;
}

function pPr(e: EstiloWord) {
  const sp = [
    e.antes !== undefined && `w:before="${e.antes}"`,
    e.despues !== undefined && `w:after="${e.despues}"`,
    e.interlineado !== undefined && `w:line="${e.interlineado}" w:lineRule="auto"`,
  ].filter(Boolean);
  return [
    e.mantenerConSiguiente ? '<w:keepNext/>' : '',
    sp.length ? `<w:spacing ${sp.join(' ')}/>` : '',
    e.sangria !== undefined ? `<w:ind w:left="${e.sangria}"/>` : '',
  ].join('');
}

function rPr(e: EstiloWord) {
  return [
    e.negrita ? '<w:b/>' : '',
    e.cursiva ? '<w:i/>' : '',
    e.color ? `<w:color w:val="${e.color}"/>` : '',
    e.tamano ? `<w:sz w:val="${e.tamano}"/><w:szCs w:val="${e.tamano}"/>` : '',
  ].join('');
}

/** Sustituye (o añade) las propiedades indicadas en un estilo de párrafo de Word. */
function estiloWord(xml: string, id: string, e: EstiloWord): string {
  const re = new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?</w:style>`);
  const actual = xml.match(re)?.[0];
  if (!actual) {
    if (!e.nombre) return xml;
    const nuevo = `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${e.nombre}"/>${e.basadoEn ? `<w:basedOn w:val="${e.basadoEn}"/>` : ''}<w:qFormat/><w:pPr>${pPr(e)}</w:pPr><w:rPr>${rPr(e)}</w:rPr></w:style>`;
    return xml.replace('</w:styles>', `${nuevo}</w:styles>`);
  }
  let s = actual;
  const p = pPr(e);
  if (p) {
    if (!/<w:pPr>/.test(s)) s = s.replace(/(<w:style [^>]*>(?:\s*<w:(?:name|aliases|basedOn|next|link|autoRedefine|hidden|uiPriority|semiHidden|unhideWhenUsed|qFormat|locked|personal\w*|rsid)[^>]*\/>)*)/, '$1<w:pPr></w:pPr>');
    s = ajustar(s, 'pPr', p);
  }
  const r = rPr(e);
  if (r) {
    if (!/<w:rPr>/.test(s)) s = s.replace('</w:style>', '<w:rPr></w:rPr></w:style>');
    s = ajustar(s, 'rPr', r);
  }
  return xml.replace(actual, s);
}

export function espaciarWord(xml: string, color: string): string {
  let s = xml;
  // Por defecto: 8 pt tras cada párrafo e interlineado 1,2
  s = s.replace(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/, '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault>');
  const estilos: Record<string, EstiloWord> = {
    BodyText: { antes: 0, despues: 160, interlineado: 288 },
    FirstParagraph: { antes: 0, despues: 160, interlineado: 288 },
    Compact: { antes: 40, despues: 80, interlineado: 264 }, // elementos de lista y celdas
    Heading1: { antes: 480, despues: 200, color, mantenerConSiguiente: true },
    Heading2: { antes: 360, despues: 140, color, mantenerConSiguiente: true },
    Heading3: { antes: 280, despues: 100, mantenerConSiguiente: true },
    Heading4: { antes: 240, despues: 80, mantenerConSiguiente: true },
    CaptionedFigure: { antes: 280, despues: 80, mantenerConSiguiente: true },
    ImageCaption: { antes: 60, despues: 320, tamano: 18, cursiva: true, color: '595959' },
    TableCaption: { antes: 120, despues: 320, tamano: 18, cursiva: true, color: '595959' },
    BlockText: { antes: 240, despues: 240, sangria: 360 },
    SourceCode: { antes: 160, despues: 200 },
    TOCHeading: { antes: 240, despues: 240, color },
    TOC1: { nombre: 'TOC 1', basadoEn: 'Normal', antes: 160, despues: 60, negrita: true },
    TOC2: { nombre: 'TOC 2', basadoEn: 'Normal', antes: 20, despues: 40, sangria: 360 },
  };
  for (const [id, e] of Object.entries(estilos)) s = estiloWord(s, id, e);
  // Celdas de tabla con algo de margen arriba y abajo
  s = s.replace(
    /(<w:style [^>]*w:styleId="Table"[\s\S]*?<w:tblCellMar>)[\s\S]*?(<\/w:tblCellMar>)/,
    '$1<w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>$2',
  );
  return s;
}

// ---------------------------------------------------------------------------
// LibreOffice (styles.xml del ODT)

function estiloOdt(xml: string, nombre: string, props: Record<string, string>, texto?: Record<string, string>): string {
  const re = new RegExp(`<style:style style:name="${nombre}"[^>]*?(?:/>|>[\\s\\S]*?</style:style>)`);
  const actual = xml.match(re)?.[0];
  if (!actual) return xml;
  const attrs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
  let s = actual.endsWith('/>') ? actual.replace(/\/>$/, '></style:style>') : actual;
  const fusionar = (etiqueta: string, nuevos: Record<string, string>) => {
    const r = new RegExp(`<${etiqueta}([^>]*?)(/?)>`);
    if (r.test(s)) {
      s = s.replace(r, (_m, at: string, vacio: string) => {
        let a = at;
        for (const k of Object.keys(nuevos)) a = a.replace(new RegExp(`\\s${k}="[^"]*"`), '');
        return `<${etiqueta}${a} ${attrs(nuevos)}${vacio}>`;
      });
    } else {
      s = s.replace(/^(<style:style[^>]*>)/, `$1<${etiqueta} ${attrs(nuevos)}/>`);
    }
  };
  fusionar('style:paragraph-properties', props);
  if (texto) fusionar('style:text-properties', texto);
  return xml.replace(actual, s);
}

export function espaciarOdt(xml: string, color: string): string {
  let s = xml;
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : '#6d4aff';
  const cuerpo = { 'fo:margin-top': '0cm', 'fo:margin-bottom': '0.28cm', 'fo:line-height': '120%' };
  s = estiloOdt(s, 'Text_20_body', cuerpo);
  s = estiloOdt(s, 'First_20_paragraph', cuerpo);
  s = estiloOdt(s, 'Heading', { 'fo:margin-top': '0.6cm', 'fo:margin-bottom': '0.25cm', 'fo:keep-with-next': 'always' });
  s = estiloOdt(s, 'Heading_20_1', { 'fo:margin-top': '0.85cm', 'fo:margin-bottom': '0.35cm' }, { 'fo:color': c });
  s = estiloOdt(s, 'Heading_20_2', { 'fo:margin-top': '0.65cm', 'fo:margin-bottom': '0.25cm' }, { 'fo:color': c });
  s = estiloOdt(s, 'Heading_20_3', { 'fo:margin-top': '0.5cm', 'fo:margin-bottom': '0.2cm' });
  s = estiloOdt(s, 'Figure', { 'fo:margin-top': '0.5cm', 'fo:margin-bottom': '0.15cm', 'fo:keep-with-next': 'always' });
  s = estiloOdt(s, 'Caption', { 'fo:margin-top': '0.1cm', 'fo:margin-bottom': '0.55cm' }, { 'fo:font-size': '9pt', 'fo:font-style': 'italic', 'fo:color': '#595959' });
  s = estiloOdt(s, 'Quotations', { 'fo:margin-top': '0.4cm', 'fo:margin-bottom': '0.4cm' });
  s = estiloOdt(s, 'Preformatted_20_Text', { 'fo:margin-top': '0.25cm', 'fo:margin-bottom': '0.35cm' });
  s = estiloOdt(s, 'Table_20_Contents', { 'fo:margin-top': '0.06cm', 'fo:margin-bottom': '0.06cm' });
  return s;
}
