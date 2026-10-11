// Marcas de Pandoc que trae el texto de unos apuntes importados de Word, para verlas en la vista previa:
// `::: {custom-style="Definición"}` (estilo de párrafo), `[texto]{.underline}`, `[texto]{.mark}`,
// `[texto]{custom-style="Término"}` (estilo de carácter) y `![…](…){width=8cm}` (ancho de la imagen).
import type MarkdownItConstructor from 'markdown-it';
import contenedor from 'markdown-it-container';

type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;

const ESTILO_PARRAFO = /^\s*\{\s*custom-style\s*=\s*"([^"]+)"\s*\}\s*$/;
const ATRIBUTOS = /^\s*(?:(?:\.[\w-]+|#[\w-]+|[\w-]+=(?:"[^"]*"|[^\s"}]+))\s*)+$/;

function escapar(t: string) {
  return t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function marcasPandoc(md: MarkdownIt) {
  md.use(contenedor, 'estilo', {
    validate: (params: string) => ESTILO_PARRAFO.test(params),
    render: (tokens: { nesting: number; info: string }[], idx: number) => {
      if (tokens[idx].nesting !== 1) return '</div>\n';
      const nombre = escapar(tokens[idx].info.match(ESTILO_PARRAFO)?.[1] ?? '');
      return `<div class="estilo-propio" data-estilo="${nombre}" title="Estilo del Word original: ${nombre}">\n`;
    },
  });

  // [texto]{atributos}: delante de la regla de enlaces, que no lo reconoce
  md.inline.ruler.before('link', 'marca_pandoc', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
    const fin = state.md.helpers.parseLinkLabel(state, state.pos, false);
    if (fin < 0 || state.src.charCodeAt(fin + 1) !== 0x7b /* { */) return false;
    const cierre = state.src.indexOf('}', fin + 2);
    if (cierre < 0 || cierre > state.posMax) return false;
    const attrs = state.src.slice(fin + 2, cierre);
    if (!ATRIBUTOS.test(attrs)) return false;
    if (!silent) {
      const clases = [...attrs.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const estilo = attrs.match(/custom-style="([^"]*)"/)?.[1];
      const etiqueta = clases.includes('underline') ? 'u' : clases.includes('mark') ? 'mark' : 'span';
      const abre = state.push('marca_pandoc_open', etiqueta, 1);
      if (estilo) {
        abre.attrSet('class', 'estilo-caracter');
        abre.attrSet('title', `Estilo del Word original: ${estilo}`);
      } else if (etiqueta === 'span' && clases.length) abre.attrSet('class', clases.join(' '));
      const max = state.posMax;
      state.pos += 1;
      state.posMax = fin;
      state.md.inline.tokenize(state);
      state.posMax = max;
      state.push('marca_pandoc_close', etiqueta, -1);
    }
    state.pos = cierre + 1;
    return true;
  });

  // {width=…} justo detrás de una imagen: su ancho (la regla de texto se lo ha comido como texto)
  md.core.ruler.after('inline', 'ancho_imagen', (state) => {
    for (const t of state.tokens) {
      const hijos = t.type === 'inline' ? t.children : null;
      if (!hijos) continue;
      for (let i = 0; i < hijos.length - 1; i++) {
        const img = hijos[i];
        const sig = hijos[i + 1];
        if (img.type !== 'image' || sig.type !== 'text') continue;
        const m = sig.content.match(/^\{([^}]*)\}/);
        if (!m) continue;
        const ancho = m[1].match(/width="?([\d.]+(?:cm|mm|in|px|%))"?/)?.[1];
        if (ancho) img.attrSet('style', `width: ${ancho}; max-width: 100%`);
        sig.content = sig.content.slice(m[0].length);
      }
    }
  });
}
