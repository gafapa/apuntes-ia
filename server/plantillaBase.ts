// Plantilla base para Word y LibreOffice: un documento exportado igual que los apuntes (portada,
// índice, títulos, tablas, figuras…) con un ejemplo de cada elemento y el nombre de su estilo.
// El profesor lo descarga, cambia los estilos y lo sube como plantilla de la asignatura.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { Almacen, ErrorUsuario } from './store';
import { ejecutarBinario, rutaPandoc } from './conversion';
import { bloqueIndice, prepararEncabezados, retocar, saltoPagina } from './indiceDocumento';
import { prepararPies } from './pies';
import { ajustarAnchos } from './tablas';
import { idiomaExportacion } from './exportar';

/** Documento de muestra: un ejemplo de cada elemento, con el estilo que usa. */
function muestra(formato: 'docx' | 'odt') {
  const w = formato === 'docx';
  const estilo = (docx: string, odt: string) => `«${w ? docx : odt}»`;
  return `# Cómo usar esta plantilla

Este documento contiene un ejemplo de **cada elemento** que la aplicación genera al exportar. Para crear tu plantilla:

1. Cambia el aspecto de cada elemento **modificando su estilo** (${
    w
      ? 'en Word: pestaña Inicio › Estilos, clic derecho sobre el estilo › Modificar'
      : 'en LibreOffice: tecla F11 › clic derecho sobre el estilo › Editar estilo'
  }), no aplicando formato directo al texto: solo se aprovechan los estilos.
2. Ajusta también, si quieres, los márgenes, el tamaño de página y el encabezado y pie de página.
3. Guarda el archivo y súbelo en la pestaña **Plantillas** de la asignatura. El texto de este documento se ignora.

Cada párrafo indica entre comillas el nombre del estilo que usa.

## Párrafos y texto

Primer párrafo tras un título: estilo ${estilo('First Paragraph', 'First paragraph')}.

Resto de párrafos: estilo ${estilo('Body Text (Texto independiente)', 'Text body (Cuerpo de texto)')}. Dentro del texto puede haber **negrita**, *cursiva*, \`código en línea\` (estilo de carácter ${estilo('Verbatim Char', 'Source Text')}), un [enlace](https://es.wikipedia.org) (${estilo('Hyperlink (Hipervínculo)', 'Internet link')}) y una nota al pie.[^nota] También fórmulas: $E = m c^2$.

### Título de nivel 3

Los títulos de los apartados usan los estilos ${estilo('Heading 1 … Heading 4 (Título 1 … Título 4)', 'Heading 1 … Heading 4 (Título 1 … Título 4)')}. En la portada, el título de los apuntes usa ${estilo('Title (Título)', 'Title (Título)')}; la asignatura, ${estilo('Subtitle (Subtítulo)', 'Subtitle (Subtítulo)')}, y la fecha, ${estilo('Date', 'Date')}. El índice usa ${estilo('TOC Heading', 'Contents Heading')} para su título y ${estilo('TOC 1 y TOC 2 (TDC 1 y TDC 2)', 'Contents 1 y Contents 2')} para las entradas.

#### Título de nivel 4

Texto bajo un título de nivel 4.

## Listas

- Elemento de una lista con viñetas: estilo ${estilo('Compact', 'Compact')}.
- Segundo elemento.
    - Elemento anidado.

1. Elemento de una lista numerada.
2. Segundo elemento.

## Citas y notas destacadas

> Cita o nota destacada: estilo ${estilo('Block Text (Texto en bloque)', 'Quotations (Citas)')}.

## Código

\`\`\`bash
# Bloque de código: estilo ${w ? 'Source Code' : 'Preformatted Text (Texto preformateado)'}
ipconfig /renew
\`\`\`

## Ecuaciones

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Tablas

| Elemento | Estilo | Comentario |
|---|---|---|
| Cabecera | Primera fila de la tabla | En negrita y con fondo |
| Celdas | ${w ? 'Compact' : 'Table Contents'} | El texto de cada celda |
| Pie de tabla | ${w ? 'Table Caption' : 'Table'} | Debajo de la tabla y numerado |

Tabla: Pie de tabla: estilo ${estilo('Table Caption', 'Table')}

## Figuras

![Pie de figura: estilo ${estilo('Image Caption', 'Figure')}](figura-muestra.png){width=10cm}

[^nota]: Nota al pie: estilo ${estilo('Footnote Text (Texto nota pie)', 'Footnote')}.
`;
}

/** PNG de un solo color claro con marco (la figura de muestra). */
function pngMuestra(ancho: number, alto: number, color: string): Buffer {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? '4f6bed';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const claro = (c: number) => 255 - Math.round((255 - c) * 0.12);
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const marco = x < 6 || y < 6 || x >= ancho - 6 || y >= alto - 6;
      const o = y * (ancho * 3 + 1) + 1 + x * 3;
      filas[o] = marco ? r : claro(r);
      filas[o + 1] = marco ? g : claro(g);
      filas[o + 2] = marco ? b : claro(b);
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const trozo = (tipo: string, datos: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const cab = Buffer.alloc(4);
    cab.writeUInt32BE(datos.length);
    const fin = Buffer.alloc(4);
    fin.writeUInt32BE(crc(t));
    return Buffer.concat([cab, t, fin]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(filas)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

/** Genera la plantilla base. Si la asignatura ya tiene plantilla propia, se parte de ella. */
export async function plantillaBase(almacen: Almacen, dirBin: string, asig: string, formato: 'docx' | 'odt'): Promise<Buffer> {
  const pandoc = rutaPandoc(dirBin);
  if (!existsSync(pandoc)) throw new ErrorUsuario('No se encuentra Pandoc. Reinstala la aplicación.');
  const asignatura = await almacen.obtenerAsignatura(asig);
  const { lang, textos } = idiomaExportacion(asignatura.idioma);
  const dirTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-plantilla-'));
  try {
    await fs.writeFile(path.join(dirTmp, 'figura-muestra.png'), pngMuestra(800, 360, asignatura.color));
    const r = prepararEncabezados(prepararPies(ajustarAnchos(muestra(formato)), formato, textos), true);
    const md = `${bloqueIndice(r.entradas, formato, textos.indice)}\n\n${saltoPagina(formato)}\n\n${r.md}`;
    const entrada = path.join(dirTmp, 'plantilla.md');
    await fs.writeFile(entrada, md, 'utf8');
    const salida = path.join(dirTmp, `plantilla.${formato}`);
    const propia = almacen.rutaPlantilla(asig, formato);
    await ejecutarBinario(
      pandoc,
      [
        entrada,
        '-o', salida,
        '-f', 'markdown+tex_math_dollars+raw_attribute',
        '--table-caption-position=below',
        '--figure-caption-position=below',
        '--number-sections',
        '-M', 'title=Título de los apuntes',
        '-M', `subtitle=${[asignatura.nombre, asignatura.nivel].filter(Boolean).join(' · ')}`,
        '-M', `date=${new Date().toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })}`,
        '-M', `lang=${lang}`,
        ...(existsSync(propia) ? ['--reference-doc', propia] : []),
      ],
      dirTmp,
    );
    await retocar(salida, formato, { portada: true, indice: true, color: asignatura.color, plantillaPropia: existsSync(propia) });
    return await fs.readFile(salida);
  } finally {
    await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => {});
  }
}
