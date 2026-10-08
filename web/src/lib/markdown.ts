// Conversión de Markdown a HTML para la vista previa (con fórmulas KaTeX y diagramas Mermaid).
import MarkdownIt from 'markdown-it';
// @ts-expect-error: el paquete no incluye tipos
import texmath from 'markdown-it-texmath';
import katex from 'katex';
// Notación química de mhchem: $\ce{2H2 + O2 -> 2H2O}$
import 'katex/contrib/mhchem';
import { consultaMolecula } from '../../../shared/quimica';
import { dibujarMolecula, resolverMolecula } from './moleculas';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
md.use(texmath, { engine: katex, delimiters: ['dollars', 'brackets'], katexOptions: { throwOnError: false } });

// Cada bloque de primer nivel lleva las líneas del Markdown de las que sale (data-l="desde-hasta",
// desde 0 y sin incluir «hasta»): así una selección en la vista previa se traduce a su fragmento
md.core.ruler.push('lineas', (state) => {
  for (const t of state.tokens) {
    if (t.map && t.level === 0 && (t.nesting === 1 || t.nesting === 0)) t.attrSet('data-l', `${t.map[0]}-${t.map[1]}`);
  }
});
const lineas = (t: { map: [number, number] | null }) => (t.map ? ` data-l="${t.map[0]}-${t.map[1]}"` : '');

// Bloques ```mermaid → contenedor que se renderiza después
const fenceOriginal = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  if (t.info.trim() === 'mermaid') {
    return `<div class="mermaid"${lineas(t)} data-codigo="${encodeURIComponent(t.content)}"></div>`;
  }
  if (t.info.trim() === 'molecula') {
    return `<div class="molecula"${lineas(t)} data-consulta="${encodeURIComponent(consultaMolecula(t.content))}"></div>`;
  }
  return fenceOriginal(tokens, idx, opts, env, self);
};

// Las imágenes relativas se resuelven contra la carpeta del documento
const imagenOriginal = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const src = String(t.attrGet('src') ?? '');
  if (env?.base && !/^(https?:|data:|\/)/.test(src)) {
    const limpio = src.replace(/^\.\//, '').replace(/^\.\.\//, '');
    t.attrSet('src', `${env.base}/${limpio.split('/').map(encodeURIComponent).join('/')}`);
  }
  t.attrSet('loading', 'lazy');
  return imagenOriginal(tokens, idx, opts, env, self);
};

// Los enlaces se abren fuera de la app
md.renderer.rules.link_open = (tokens, idx, opts, _env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, opts);
};

export function renderizar(texto: string, base?: string): string {
  return (
    md
      .render(texto, { base })
      // Imagen sola en su párrafo → figura con su pie (el texto alternativo)
      .replace(/<p( data-l="[^"]*")?>(<img [^>]*alt="([^"]+)"[^>]*>)<\/p>/g, '<figure$1>$2<figcaption>$3</figcaption></figure>')
      // Pies de diagramas («*Figura: …*») y de tablas («Tabla: …»)
      .replace(/<p( data-l="[^"]*")?>(<em>(?:Figura|Esquema|Diagrama)[^<]*<\/em>)<\/p>/g, '<p$1 class="pie">$2</p>')
      .replace(/<p( data-l="[^"]*")?>((?:Tabla|Table)\s*\d*\s*[:.][^<]*)<\/p>/g, '<p$1 class="pie">$2</p>')
      // Referencias de imágenes ajenas (APA: «Tomado de …»; antes «*Fuente: …*»), bajo la figura
      .replace(/<p( data-l="[^"]*")?>((?:Tomado|Adaptado) de |<em>Fuente:)/g, '<p$1 class="pie referencia">$2')
  );
}

let mermaidListo: Promise<typeof import('mermaid').default> | undefined;
let contador = 0;

/** Dibuja las moléculas pendientes dentro de un contenedor. */
async function dibujarMoleculas(contenedor: HTMLElement) {
  const oscuro = document.documentElement.classList.contains('dark');
  for (const nodo of contenedor.querySelectorAll<HTMLElement>('.molecula[data-consulta]')) {
    const consulta = decodeURIComponent(nodo.dataset.consulta ?? '');
    nodo.removeAttribute('data-consulta');
    nodo.textContent = 'Buscando la molécula…';
    try {
      const m = await resolverMolecula(consulta);
      nodo.innerHTML = await dibujarMolecula(m.smiles, oscuro);
      const info = document.createElement('div');
      info.className = 'molecula-info';
      info.textContent = [m.nombre ?? consulta, m.formula].filter(Boolean).join(' · ') + (m.verificada ? '' : ' · SMILES no comprobado en PubChem');
      info.title = m.iupac ? `IUPAC: ${m.iupac}\nSMILES: ${m.smiles}` : `SMILES: ${m.smiles}`;
      nodo.appendChild(info);
    } catch (e) {
      nodo.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'mermaid-error';
      err.textContent = `Molécula «${consulta}»: ${(e as Error).message}`;
      nodo.appendChild(err);
    }
  }
}

/** Dibuja los diagramas Mermaid y las moléculas pendientes dentro de un contenedor. */
export async function dibujarDiagramas(contenedor: HTMLElement) {
  void dibujarMoleculas(contenedor);
  const nodos = [...contenedor.querySelectorAll<HTMLElement>('.mermaid[data-codigo]')];
  if (!nodos.length) return;
  mermaidListo ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidListo;
  const oscuro = document.documentElement.classList.contains('dark');
  mermaid.initialize({ startOnLoad: false, theme: oscuro ? 'dark' : 'default', securityLevel: 'strict', fontFamily: 'Inter Variable' });
  for (const nodo of nodos) {
    const codigo = decodeURIComponent(nodo.dataset.codigo ?? '');
    nodo.removeAttribute('data-codigo');
    try {
      const { svg } = await mermaid.render(`mmd-${++contador}`, codigo);
      nodo.innerHTML = svg;
    } catch (e) {
      nodo.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'mermaid-error';
      err.textContent = `Error en el diagrama: ${(e as Error).message}`;
      nodo.appendChild(err);
    }
  }
}
