// Exportación de un documento a Word (docx), LibreOffice (odt) y PDF (Pandoc + Typst).
// Los diagramas Mermaid los convierte a PNG la interfaz (que tiene el motor de Mermaid)
// y los envía junto con la petición.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Exportado, OpcionesExportacion } from '../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../shared/tipos';
import { ESCALA_DIAGRAMAS, PATRON_MERMAID, hashTexto } from '../shared/hash';
import { anchoExportacion, dimensiones } from './imagenes';
import { bloqueIndice, prepararEncabezados, retocar, saltoPagina } from './indiceDocumento';
import { prepararPies } from './pies';
import { Almacen, ErrorUsuario, slug } from './store';
import { ejecutarBinario, rutaPandoc } from './conversion';

const IDIOMAS: Record<string, string> = {
  español: 'es',
  castellano: 'es',
  valenciano: 'ca',
  'aranés (occitano)': 'oc',
  aranés: 'oc',
  inglés: 'en',
  ingles: 'en',
  english: 'en',
  gallego: 'gl',
  galego: 'gl',
  catalán: 'ca',
  català: 'ca',
  euskera: 'eu',
  francés: 'fr',
  alemán: 'de',
  portugués: 'pt',
  italiano: 'it',
};

const TEXTOS: Record<string, { indice: string; figura: string; tabla: string }> = {
  es: { indice: 'Índice', figura: 'Figura', tabla: 'Tabla' },
  gl: { indice: 'Índice', figura: 'Figura', tabla: 'Táboa' },
  ca: { indice: 'Índex', figura: 'Figura', tabla: 'Taula' },
  en: { indice: 'Contents', figura: 'Figure', tabla: 'Table' },
};

// Salto entre secciones (en PDF lo hace la plantilla de Typst)
const SALTO = {
  docx: `\n${saltoPagina('docx')}\n`,
  odt: `\n${saltoPagina('odt')}\n`,
  pdf: '',
};

export async function exportar(
  almacen: Almacen,
  dirBin: string,
  asig: string,
  doc: string,
  op: OpcionesExportacion,
  diagramas: Record<string, string>, // hash del código → PNG en base64 (data URL)
): Promise<Exportado> {
  const pandoc = rutaPandoc(dirBin);
  if (!existsSync(pandoc)) throw new ErrorUsuario('No se encuentra Pandoc. Reinstala la aplicación.');
  const asignatura = await almacen.obtenerAsignatura(asig);
  const documento = await almacen.obtenerDocumento(asig, doc);
  const dirDoc = almacen.dirDocumento(asig, doc);
  const dirTmp = path.join(dirDoc, '.exportacion');
  await fs.rm(dirTmp, { recursive: true, force: true });
  await fs.mkdir(dirTmp, { recursive: true });

  const lang = IDIOMAS[asignatura.idioma.trim().toLowerCase()] ?? 'es';
  const textos = TEXTOS[lang] ?? TEXTOS.es;

  try {
    // 1. Diagramas → PNG
    for (const [hash, dataUrl] of Object.entries(diagramas ?? {})) {
      if (!/^[a-z0-9]+$/.test(hash)) continue;
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      await fs.writeFile(path.join(dirTmp, `diagrama-${hash}.png`), Buffer.from(b64, 'base64'));
    }

    // 2. Unir las secciones
    let secciones = await almacen.textoCompleto(asig, doc);
    if (!op.autoevaluacion) secciones = secciones.filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo));
    if (!secciones.length) throw new ErrorUsuario('El documento no tiene secciones');
    const partes = secciones.map((s) =>
      s.texto.replace(PATRON_MERMAID, (_m, codigo: string, pie?: string) => {
        const archivo = `.exportacion/diagrama-${hashTexto(codigo.trim())}.png`;
        if (!existsSync(path.join(dirDoc, archivo))) return '\n*[Diagrama no disponible]*\n';
        const d = dimensiones(path.join(dirDoc, archivo));
        const ancho = d ? `{width=${anchoExportacion(d, 96 * ESCALA_DIAGRAMAS)}cm}` : '';
        return `\n![${(pie ?? '').trim()}](${archivo})${ancho}\n`;
      })
        // Resto de imágenes (fotos, imágenes generadas): tamaño acotado, salvo que el texto ya lo indique
        .replace(/(!\[[^\]]*\]\(([^)\s]+)\))(?!\{)/g, (todo, img: string, ruta: string) => {
          if (/^https?:/.test(ruta) || ruta.startsWith('.exportacion/')) return todo;
          const d = dimensiones(path.join(dirDoc, decodeURIComponent(ruta)));
          // Fotos e ilustraciones: se supone una resolución de 150 ppp
          return d ? `${img}{width=${anchoExportacion(d, 150)}cm}` : todo;
        }),
    );
    const salto = op.saltoSeccion ? SALTO[op.formato] : '';
    // Todas las imágenes, esquemas y tablas con pie (numerado en Word/ODT)
    let md = prepararPies(partes.map((p) => p.trim()).join(`\n\n${salto}\n\n`), op.formato, textos, op.pies !== false);
    if (op.formato === 'docx' || op.formato === 'odt') {
      // Índice ya relleno y numerado (el de Pandoc es un campo vacío hasta actualizarlo a mano)
      const r = prepararEncabezados(md, op.numerar);
      md = r.md;
      if (op.indice && r.entradas.length) {
        md = `${bloqueIndice(r.entradas, op.formato, textos.indice)}\n\n${saltoPagina(op.formato)}\n\n${md}`;
      }
    }
    const entrada = path.join(dirTmp, 'documento.md');
    await fs.writeFile(entrada, md, 'utf8');

    // 3. Pandoc
    const fecha = new Date().toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    const meta = [
      '-M', `title=${documento.titulo}`,
      '-M', `subtitle=${[asignatura.nombre, asignatura.nivel].filter(Boolean).join(' · ')}`,
      '-M', `date=${fecha}`,
      '-M', `lang=${lang}`,
      '-M', `toc-title=${textos.indice}`,
      '-M', `figureTitle=${textos.figura}`,
      '-M', `tableTitle=${textos.tabla}`,
    ];
    const comunes = [
      '-f', 'markdown+tex_math_dollars+raw_attribute',
      // Pies siempre debajo (Pandoc pone los de tabla encima por defecto en Word y ODT)
      '--table-caption-position=below',
      '--figure-caption-position=below',
      '--resource-path', dirDoc,
      ...meta,
      // En Word y ODT el índice lo genera prepararEncabezados(); en PDF, Typst
      ...(op.indice && op.formato === 'pdf' ? ['--toc', '--toc-depth=2'] : []),
      ...(op.numerar ? ['--number-sections'] : []),
    ];

    const base = slug(documento.titulo) || 'apuntes';
    const nombre = `${base}.${op.formato}`;
    const destino = almacen.rutaExportado(asig, doc, nombre);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const salidaTmp = path.join(dirTmp, nombre);

    if (op.formato === 'docx' || op.formato === 'odt') {
      const plantilla = almacen.rutaPlantilla(asig, op.formato);
      await ejecutarBinario(
        pandoc,
        [entrada, '-o', salidaTmp, ...comunes, ...(existsSync(plantilla) ? ['--reference-doc', plantilla] : [])],
        dirDoc,
      );
      await retocar(salidaTmp, op.formato, { portada: op.portada, indice: op.indice, color: asignatura.color, plantillaPropia: existsSync(plantilla) });
    } else {
      const typst = path.join(dirBin, process.platform === 'win32' ? 'typst.exe' : 'typst');
      if (!existsSync(typst)) throw new ErrorUsuario('No se encuentra Typst. Reinstala la aplicación.');
      await fs.writeFile(path.join(dirTmp, 'apuntes.typ'), plantillaTypst(asignatura.color, op), 'utf8');
      // El .typ va en la carpeta del documento para que las rutas de las imágenes funcionen
      const typ = path.join(dirDoc, '.exportacion-documento.typ');
      try {
        await ejecutarBinario(
          pandoc,
          [
            entrada,
            '-t', 'typst',
            '-s',
            '-o', typ,
            ...comunes,
            '-V', 'template=.exportacion/apuntes.typ',
            '-V', 'papersize=a4',
            '-V', 'page-numbering=1',
            ...(op.numerar ? ['-V', 'section-numbering=1.1.'] : []),
          ],
          dirDoc,
        );
        await ejecutarBinario(typst, ['compile', '--root', dirDoc, typ, salidaTmp], dirDoc, 300000);
      } finally {
        await fs.rm(typ, { force: true });
      }
    }

    try {
      await fs.copyFile(salidaTmp, destino);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EBUSY' || (e as NodeJS.ErrnoException).code === 'EPERM') {
        throw new ErrorUsuario(`«${nombre}» está abierto en otro programa. Ciérralo y vuelve a exportar.`);
      }
      throw e;
    }
    const st = await fs.stat(destino);
    return { nombre, formato: op.formato, tamano: st.size, modificado: st.mtime.toISOString() };
  } catch (e) {
    if (e instanceof ErrorUsuario) throw e;
    throw new ErrorUsuario(`No se pudo exportar: ${(e as Error).message}`, 500);
  } finally {
    await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Plantilla de Typst para Pandoc (la importa el template por defecto como `conf`). */
function plantillaTypst(color: string, op: OpcionesExportacion): string {
  const acento = /^#[0-9a-f]{6}$/i.test(color) ? color : '#6d4aff';
  return `
#let acento = rgb("${acento}")
#let sans = ("Segoe UI", "Helvetica Neue", "Inter", "Arial", "Libertinus Serif")

#let content-to-string(content) = {
  if content.has("text") { content.text }
  else if content.has("children") { content.children.map(content-to-string).join("") }
  else if content.has("body") { content-to-string(content.body) }
  else if content == [ ] { " " }
}

#let conf(
  title: none, subtitle: none, authors: (), keywords: (), date: none,
  abstract-title: none, abstract: none, thanks: none, cols: 1,
  margin: (x: 2.3cm, top: 2.5cm, bottom: 2.5cm), paper: "a4", lang: "es", region: none,
  font: none, fontsize: 11pt, mathfont: none, codefont: none, linestretch: 1,
  sectionnumbering: none, linkcolor: none, citecolor: none, filecolor: none,
  pagenumbering: "1", doc,
) = {
  set document(title: title, keywords: keywords)
  set text(lang: lang, size: fontsize, font: ("Libertinus Serif",))
  set par(justify: true, leading: 0.68em, spacing: 1.05em)
  show raw: set text(font: ("Cascadia Code", "Consolas", "DejaVu Sans Mono"))
  show link: set text(fill: acento)

  set page(
    paper: paper,
    margin: margin,
    header: [
      #set text(size: 8.5pt, fill: luma(120), font: sans)
      #if subtitle != none { subtitle } #h(1fr) #if title != none { title }
      #v(-0.5em)
      #line(length: 100%, stroke: 0.4pt + luma(210))
    ],
    footer: context [
      #set text(size: 9pt, fill: luma(110), font: sans)
      #h(1fr) #counter(page).display("1") #h(1fr)
    ],
  )

  set heading(numbering: sectionnumbering)
  show heading: set text(font: sans, hyphenate: false)
  show heading.where(level: 1): it => {
    ${op.saltoSeccion ? 'pagebreak(weak: true)' : 'v(0.8em)'}
    block(below: 1.1em)[
      #set text(size: 20pt, weight: "bold", fill: acento)
      #it
      #v(-0.35em)
      #line(length: 100%, stroke: 1.2pt + acento)
    ]
  }
  show heading.where(level: 2): it => block(above: 1.5em, below: 0.8em, text(size: 14pt, weight: "semibold", it))
  show heading.where(level: 3): it => block(above: 1.2em, below: 0.6em, text(size: 12pt, weight: "semibold", fill: luma(60), it))

  show figure.caption: set text(size: 9pt, fill: luma(90), style: "italic")
  show quote: it => block(
    fill: acento.lighten(92%), stroke: (left: 3pt + acento), inset: (x: 12pt, y: 9pt), radius: (right: 4pt), width: 100%, it.body,
  )
  set table(stroke: 0.5pt + luma(150), inset: 6pt, fill: (_, y) => if y == 0 { acento.lighten(88%) })
  // Figuras, tablas y sus pies, centrados
  show figure: set align(center)
  show table: it => align(center, it)
  show figure.where(kind: table): set figure.caption(position: bottom)
  show table.cell.where(y: 0): set text(weight: "bold")
  show outline: it => { it; pagebreak(weak: true) }
  show outline.entry.where(level: 1): set text(weight: "bold")

  ${
    op.portada
      ? `// Portada
  page(margin: 0pt, header: none, footer: none)[
    #place(top, rect(width: 100%, height: 38%, fill: acento))
    #place(top + left, dx: 2.5cm, dy: 3.2cm, block(width: 15.5cm)[
      #set text(fill: white, font: sans)
      #if subtitle != none { text(size: 13pt, weight: "medium", subtitle) }
      #v(0.6em)
      #text(size: 30pt, weight: "bold", hyphenate: false, title)
    ])
    #place(bottom + left, dx: 2.5cm, dy: -2.5cm, block[
      #set text(font: sans, fill: luma(90), size: 11pt)
      #if date != none { date }
    ])
  ]
  counter(page).update(1)`
      : `if title != none {
    block(below: 1.6em)[
      #set text(font: sans)
      #if subtitle != none { text(size: 10.5pt, fill: luma(100), subtitle); v(0.2em) }
      #text(size: 24pt, weight: "bold", fill: acento, title)
      #if date != none { v(0.1em); text(size: 9.5pt, fill: luma(120), date) }
    ]
  }`
  }

  doc
}
`;
}
