// Importación de apuntes existentes (Word, LibreOffice, Markdown o PDF): conversión a Markdown,
// limpieza de lo que la app ya hace por su cuenta (numeración, índice, «Figura N.») y reparto en
// secciones por los encabezados.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { Apartado, FormatoImportado } from '../shared/tipos';
import { ejecutarBinario, rutaPandoc } from './conversion';
import { ErrorUsuario, slug } from './store';
import { textoPdf } from './rag';
import { ajustarAst } from './formatoImportado';

export const EXTENSIONES_IMPORTABLES = ['.docx', '.odt', '.md', '.markdown', '.txt', '.zip', '.pdf'];

export function formatoDe(nombre: string): FormatoImportado | undefined {
  const ext = path.extname(nombre).toLowerCase();
  if (ext === '.docx' || ext === '.odt' || ext === '.pdf') return ext.slice(1) as FormatoImportado;
  if (['.md', '.markdown', '.txt', '.zip'].includes(ext)) return 'md';
}

// Markdown de Pandoc reducido a lo que entiende la vista previa: tablas con barras y sin HTML. Los
// estilos propios van en `::: {custom-style}` y `[…]{…}`, y el ancho de las imágenes en `{width=…}`
// (ver formatoImportado.ts)
const SALIDA_PANDOC = [
  'markdown',
  '-raw_html',
  '-native_divs',
  '-native_spans',
  '-header_attributes',
  '-grid_tables',
  '-multiline_tables',
  '-simple_tables',
  '-smart',
  '+pipe_tables',
].join('');

/** Formatos de imagen que no se ven en la vista previa ni en el PDF. */
const IMAGEN_NO_WEB = /\.(emf|wmf|tiff?)$/i;

export interface Convertido {
  texto: string;
  titulo?: string; // de las propiedades del documento o del bloque YAML del Markdown
  imagenes: number;
  avisos: string[];
  estiloCuerpo?: string; // Word: estilo propio del texto normal
  estiloTabla?: string; // Word: estilo de tabla más usado
}

/**
 * Convierte unos apuntes a Markdown. Las imágenes que trae se copian a `dirRecursos` con un nombre
 * propio y el texto las enlaza como `recursos/…`.
 */
export async function aMarkdown(origen: string, nombre: string, dirBin: string | undefined, dirRecursos: string): Promise<Convertido> {
  const formato = formatoDe(nombre);
  const avisos: string[] = [];
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-importar-'));
  try {
    let texto: string;
    let base: string; // carpeta desde la que se resuelven las imágenes del texto
    let formatoWord: { estiloCuerpo?: string; estiloTabla?: string } = {};
    if (formato === 'docx' || formato === 'odt') {
      if (!dirBin || !existsSync(rutaPandoc(dirBin))) throw new ErrorUsuario('No se encuentra Pandoc para convertir el archivo: reinstala la aplicación.');
      // Las imágenes se extraen a tmp/media; Pandoc las enlaza con rutas relativas a cwd. Se pasa por
      // el árbol JSON para ajustar tablas, estilos e imágenes antes de escribir el Markdown
      const pandoc = rutaPandoc(dirBin);
      const json = await ejecutarBinario(pandoc, ['-f', formato === 'docx' ? 'docx+styles' : 'odt', '-t', 'json', '--extract-media=.', origen], tmp);
      const ajustado = ajustarAst(JSON.parse(json), formato === 'docx');
      await fs.writeFile(path.join(tmp, '.arbol.json'), JSON.stringify(ajustado.ast), 'utf8');
      texto = (await ejecutarBinario(pandoc, ['-s', '-f', 'json', '-t', SALIDA_PANDOC, '--wrap=none', '.arbol.json'], tmp))
        // Sin comillas, como las escribe la app: {width=8.5cm}
        .replace(/\{width="([^"]+)"\}/g, '{width=$1}');
      base = tmp;
      if (ajustado.tablasAplanadas) {
        const n = ajustado.tablasAplanadas;
        avisos.push(`${n === 1 ? 'Una tabla tenía' : `${n} tablas tenían`} celdas combinadas o con varios párrafos: se han separado las celdas y unido los párrafos (el contenido está completo). Revisa cómo han quedado.`);
      }
      formatoWord = { estiloCuerpo: ajustado.estiloCuerpo, estiloTabla: ajustado.estiloTabla };
    } else if (path.extname(nombre).toLowerCase() === '.zip') {
      // Markdown con sus imágenes (p. ej. el que exporta la propia app)
      const zip = await JSZip.loadAsync(await fs.readFile(origen));
      const mds = Object.values(zip.files).filter((f) => !f.dir && /\.(md|markdown)$/i.test(f.name) && !f.name.startsWith('__MACOSX'));
      if (!mds.length) throw new ErrorUsuario('El .zip no contiene ningún archivo Markdown (.md)');
      for (const f of Object.values(zip.files)) {
        if (f.dir || f.name.includes('..')) continue;
        const destino = path.join(tmp, f.name);
        await fs.mkdir(path.dirname(destino), { recursive: true });
        await fs.writeFile(destino, await f.async('nodebuffer'));
      }
      // El más largo es el de los apuntes (puede haber un LEEME)
      const principal = (await Promise.all(mds.map(async (f) => ({ f, n: (await f.async('string')).length })))).sort((a, b) => b.n - a.n)[0].f;
      texto = await fs.readFile(path.join(tmp, principal.name), 'utf8');
      base = path.dirname(path.join(tmp, principal.name));
    } else {
      texto = await fs.readFile(origen, 'utf8');
      base = '';
    }
    // Metadatos (Pandoc con -s, o el bloque YAML de un Markdown): el título y nada más
    let titulo: string | undefined;
    const cabecera = texto.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n/);
    if (cabecera) {
      titulo = cabecera[1].match(/^title:[ \t]*(.+)$/m)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
      texto = texto.slice(cabecera[0].length);
    }
    // Imágenes: a recursos/ con nombre propio
    let imagenes = 0;
    const copiadas = new Map<string, string>();
    const faltan: string[] = [];
    const reemplazos: [string, string][] = [];
    for (const m of texto.matchAll(/!\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const ruta = decodeURIComponent(m[1]);
      if (/^(https?:|data:)/.test(ruta) || copiadas.has(ruta)) continue;
      const absoluta = base ? path.resolve(base, ruta) : '';
      if (!base || !absoluta.startsWith(base) || !existsSync(absoluta)) {
        faltan.push(ruta);
        continue;
      }
      if (IMAGEN_NO_WEB.test(absoluta)) avisos.push(`La imagen «${path.basename(ruta)}» está en un formato que no se puede mostrar (${path.extname(ruta)}): sustitúyela por un PNG o JPG.`);
      await fs.mkdir(dirRecursos, { recursive: true });
      const nombreFinal = await nombreLibre(dirRecursos, `importada-${slug(path.basename(ruta, path.extname(ruta)))}${path.extname(ruta).toLowerCase()}`);
      await fs.copyFile(absoluta, path.join(dirRecursos, nombreFinal));
      copiadas.set(ruta, nombreFinal);
      reemplazos.push([m[1], `recursos/${nombreFinal}`]);
      imagenes++;
    }
    for (const [de, a] of reemplazos) texto = texto.split(`](${de})`).join(`](${a})`).split(`](<${de}>)`).join(`](${a})`);
    if (faltan.length) {
      avisos.push(
        base
          ? `No se han encontrado ${faltan.length} ${faltan.length === 1 ? 'imagen enlazada' : 'imágenes enlazadas'} (${faltan.slice(0, 3).join(', ')}${faltan.length > 3 ? '…' : ''}).`
          : `El Markdown enlaza ${faltan.length} ${faltan.length === 1 ? 'imagen' : 'imágenes'} que no se han podido importar: sube un .zip con el .md y sus imágenes.`,
      );
    }
    return { texto: limpiar(texto), titulo, imagenes, avisos, ...formatoWord };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function nombreLibre(dir: string, nombre: string): Promise<string> {
  const ext = path.extname(nombre);
  const base = nombre.slice(0, nombre.length - ext.length);
  let n = nombre;
  for (let i = 2; existsSync(path.join(dir, n)); i++) n = `${base}-${i}${ext}`;
  return n;
}

/** Quita lo que la app genera por su cuenta al exportar y que, importado, saldría duplicado. */
export function limpiar(md: string): string {
  let t = md.replace(/\r\n?/g, '\n');
  // Índice o tabla de contenidos manual: el encabezado y sus líneas de enlaces (o de «Tema …… 3»)
  t = t.replace(
    /^#{1,6}[ \t]+(?:Índice|Indice|Índice general|Contenidos?|Sumario|Tabla de contenidos?|Table of contents)[ \t]*\n(?:[ \t]*(?:[-*+][ \t]+|\d+\.[ \t]+)?(?:\[[^\]\n]*\]\(#[^)\n]*\)|[^\n#]*?\.{3,}[ \t]*\d+)[ \t]*\n|[ \t]*\n)+/gim,
    '',
  );
  // Numeración manual de los encabezados («1.2 Título», «II. Título», «Tema 3: Título» se respeta)
  t = t.replace(/^(#{1,6})[ \t]+(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)[ \t]+(?=\S)/gm, '$1 ');
  // «Figura 3.» o «Tabla 2:» al principio de los pies (la app numera al exportar)
  t = t.replace(/!\[(?:Figura|Fig\.|Imagen|Ilustración)\s*\d+[.:]?\s*/gi, '![');
  t = t.replace(/^:[ \t]+(?:Tabla|Cuadro)\s*\d+[.:]?\s*/gim, ': ');
  // Restos de exportaciones de la propia app
  t = t.replace(/^\*\\\[Diagrama no disponible\\\]\*[ \t]*$/gm, '');
  // Saltos de página y separadores sueltos
  t = t.replace(/^\\newpage[ \t]*$/gm, '');
  return t.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export interface SeccionImportada {
  titulo: string;
  texto: string; // empieza por «# Título»
  apartados: Apartado[];
}

/**
 * Reparte el Markdown en secciones por sus encabezados. Si hay un único encabezado del nivel más alto
 * al principio, es el título del documento y las secciones son los del nivel siguiente. Los niveles
 * se ajustan para que cada sección empiece con `#`.
 */
export function partirEnSecciones(md: string, tituloPorDefecto: string): { titulo?: string; secciones: SeccionImportada[] } {
  // Las notas al pie (Pandoc las pone todas al final) van a la sección donde se citan
  const { texto, notas } = separarNotas(md);
  const r = partirPorEncabezados(texto, tituloPorDefecto);
  const pendientes = new Map(notas);
  for (const s of r.secciones) {
    const propias = [...s.texto.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map((m) => m[1]).filter((n) => pendientes.has(n));
    const defs = [...new Set(propias)].map((n) => {
      const d = pendientes.get(n)!;
      pendientes.delete(n);
      return d;
    });
    if (defs.length) s.texto = `${s.texto.trimEnd()}\n\n${defs.join('\n\n')}\n`;
  }
  if (pendientes.size && r.secciones.length) {
    const ultima = r.secciones[r.secciones.length - 1];
    ultima.texto = `${ultima.texto.trimEnd()}\n\n${[...pendientes.values()].join('\n\n')}\n`;
  }
  return r;
}

/** Saca del texto las definiciones de las notas al pie (`[^n]: …` y sus líneas sangradas). */
export function separarNotas(md: string): { texto: string; notas: Map<string, string> } {
  const lineas = md.split('\n');
  const notas = new Map<string, string>();
  const resto: string[] = [];
  let enCodigo = false;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^\s*(```|~~~)/.test(l)) enCodigo = !enCodigo;
    const m = !enCodigo && l.match(/^\[\^([^\]\s]+)\]:/);
    if (!m) {
      resto.push(l);
      continue;
    }
    const nota = [l];
    // Continúa mientras haya líneas sangradas (o en blanco seguidas de una sangrada)
    while (i + 1 < lineas.length && (/^( {4}|\t)/.test(lineas[i + 1]) || (!lineas[i + 1].trim() && /^( {4}|\t)/.test(lineas[i + 2] ?? '')))) nota.push(lineas[++i]);
    notas.set(m[1], nota.join('\n').trimEnd());
  }
  return { texto: notas.size ? resto.join('\n').replace(/\n{3,}/g, '\n\n') : md, notas };
}

function partirPorEncabezados(md: string, tituloPorDefecto: string): { titulo?: string; secciones: SeccionImportada[] } {
  const lineas = md.split('\n');
  const encabezados: { linea: number; nivel: number; titulo: string }[] = [];
  let enCodigo = false;
  lineas.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) enCodigo = !enCodigo;
    const m = !enCodigo && l.match(/^(#{1,6})[ \t]+(.+?)[ \t#]*$/);
    if (m) encabezados.push({ linea: i, nivel: m[1].length, titulo: limpiarTitulo(m[2]) });
  });
  if (!encabezados.length) {
    return { secciones: [{ titulo: tituloPorDefecto, texto: `# ${tituloPorDefecto}\n\n${md.trim()}\n`, apartados: [] }] };
  }
  let titulo: string | undefined;
  let quitar = -1; // línea del título del documento, que no va en ninguna sección
  const minimo = Math.min(...encabezados.map((e) => e.nivel));
  const delMinimo = encabezados.filter((e) => e.nivel === minimo);
  if (delMinimo.length === 1 && encabezados[0].nivel === minimo && encabezados.length > 1) {
    titulo = delMinimo[0].titulo;
    quitar = delMinimo[0].linea;
  }
  const restantes = encabezados.filter((e) => e.linea !== quitar);
  if (!restantes.length) {
    const cuerpo = lineas.filter((_, i) => i !== quitar).join('\n').trim();
    return { titulo, secciones: [{ titulo: titulo ?? tituloPorDefecto, texto: `# ${titulo ?? tituloPorDefecto}\n\n${cuerpo}\n`, apartados: [] }] };
  }
  // Nivel de corte: el más alto que se repite (si ninguno se repite, el más alto que quede)
  const niveles = [...new Set(restantes.map((e) => e.nivel))].sort();
  const corte = niveles.find((n) => restantes.filter((e) => e.nivel === n).length >= 2) ?? niveles[0];
  const cortes = restantes.filter((e) => e.nivel === corte);
  const desplazar = corte - 1;
  const secciones: SeccionImportada[] = [];
  // Lo que hay antes del primer corte (sin el título), si tiene contenido, es una introducción
  const previo = lineas
    .slice(0, cortes[0].linea)
    .filter((_, i) => i !== quitar)
    .join('\n')
    .trim();
  const palabrasPrevio = previo.replace(/^#.*$/gm, '').split(/\s+/).filter(Boolean).length;
  if (palabrasPrevio >= 40) {
    secciones.push(crearSeccion('Introducción', previo, desplazar, corte));
  } else if (palabrasPrevio && !titulo) {
    // Portada (título, asignatura, fecha…): no es una sección, pero da el título del documento
    const destacado = previo.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m) ?? previo.match(/^#{1,6}[ \t]+(.+)$/m);
    if (destacado) titulo = limpiarTitulo(destacado[1]);
  }
  cortes.forEach((c, k) => {
    const fin = k + 1 < cortes.length ? cortes[k + 1].linea : lineas.length;
    const cuerpo = lineas
      .slice(c.linea + 1, fin)
      .filter((_, i) => c.linea + 1 + i !== quitar)
      .join('\n')
      .trim();
    secciones.push(crearSeccion(c.titulo, cuerpo, desplazar, corte));
  });
  return { titulo, secciones };
}

function limpiarTitulo(t: string) {
  return t.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1').replace(/\*\*|__/g, '').trim();
}

function crearSeccion(titulo: string, cuerpo: string, desplazar: number, corte: number): SeccionImportada {
  // Encabezados internos: el nivel de corte pasa a ser «#»; los de dentro, «##», «###»…
  let enCodigo = false;
  const apartados: Apartado[] = [];
  const texto = cuerpo
    .split('\n')
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) enCodigo = !enCodigo;
      const m = !enCodigo && l.match(/^(#{1,6})([ \t]+.*)$/);
      if (!m) return l;
      const nivel = Math.max(2, m[1].length - desplazar);
      const t = limpiarTitulo(m[2].replace(/[ \t#]*$/, ''));
      if (m[1].length === corte + 1) apartados.push({ id: idCorto(), titulo: t, apartados: [] });
      else if (m[1].length === corte + 2 && apartados.length) apartados[apartados.length - 1].apartados.push({ id: idCorto(), titulo: t, apartados: [] });
      return `${'#'.repeat(Math.min(6, nivel))} ${t}`;
    })
    .join('\n');
  return { titulo, texto: `# ${titulo}\n\n${texto.trim()}\n`, apartados };
}

const idCorto = () => Math.random().toString(36).slice(2, 10);

/** Comprueba que un PDF tiene texto (y no es un escaneo) y lo devuelve por páginas. */
export async function leerPdf(ruta: string): Promise<{ paginas: number; texto: string }> {
  let paginas: { pagina: number; texto: string }[];
  try {
    paginas = await textoPdf(ruta);
  } catch (e) {
    throw new ErrorUsuario(`No se ha podido leer el PDF: ${(e as Error).message}`);
  }
  const caracteres = paginas.reduce((n, p) => n + p.texto.replace(/\s/g, '').length, 0);
  if (!paginas.length || caracteres / paginas.length < 120) {
    throw new ErrorUsuario(
      'El PDF parece escaneado (son imágenes de páginas, sin texto). Pásalo antes por un programa de reconocimiento de texto (OCR) o importa el Word original.',
    );
  }
  return { paginas: paginas.length, texto: paginas.map((p) => `<!-- página ${p.pagina} -->\n${p.texto}`).join('\n\n') };
}
