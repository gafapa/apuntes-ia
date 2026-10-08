// Tamaño de las imágenes al exportar. Pandoc calcula el tamaño a partir de los píxeles
// suponiendo 96 ppp, así que una imagen de alta resolución sale enorme. Aquí se calcula
// un ancho razonable para cada imagen y se escribe de forma explícita ({width=…cm}).
import fs from 'node:fs';

/** Ancho y alto en píxeles de PNG, JPEG, GIF, WebP o SVG (sin dependencias). */
export function dimensiones(ruta: string): { ancho: number; alto: number } | undefined {
  let b: Buffer;
  try {
    b = fs.readFileSync(ruta);
  } catch {
    return undefined;
  }
  // PNG: cabecera IHDR
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
  // GIF
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { ancho: b.readUInt16LE(6), alto: b.readUInt16LE(8) };
  // WebP
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const tipo = b.toString('ascii', 12, 16);
    if (tipo === 'VP8 ') return { ancho: b.readUInt16LE(26) & 0x3fff, alto: b.readUInt16LE(28) & 0x3fff };
    if (tipo === 'VP8L') {
      const n = b.readUInt32LE(21);
      return { ancho: (n & 0x3fff) + 1, alto: ((n >> 14) & 0x3fff) + 1 };
    }
    if (tipo === 'VP8X') return { ancho: 1 + b.readUIntLE(24, 3), alto: 1 + b.readUIntLE(27, 3) };
  }
  // JPEG: buscar el marcador SOF
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marca = b[i + 1];
      const largo = b.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
      i += 2 + largo;
    }
  }
  // SVG: viewBox o width/height
  const texto = b.subarray(0, 4000).toString('utf8');
  if (/<svg/i.test(texto)) {
    const vb = texto.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (vb) return { ancho: Number(vb[1]), alto: Number(vb[2]) };
    const w = texto.match(/\swidth=["']([\d.]+)/i);
    const h = texto.match(/\sheight=["']([\d.]+)/i);
    if (w && h) return { ancho: Number(w[1]), alto: Number(h[1]) };
  }
  return undefined;
}

const CM_POR_PULGADA = 2.54;
export const ANCHO_MAX_CM = 16; // ancho útil de un A4 con los márgenes de la plantilla
const ALTO_MAX_CM = 11; // ninguna figura ocupa más de media página aprox.
const ANCHO_MIN_CM = 5;

/**
 * Ancho de exportación en cm.
 * - `ppp`: resolución con la que se generó la imagen (los diagramas se rasterizan a 2,5× de 96 ppp).
 */
export function anchoExportacion(d: { ancho: number; alto: number }, ppp: number): number {
  const natural = (d.ancho / ppp) * CM_POR_PULGADA;
  const porAlto = ALTO_MAX_CM * (d.ancho / d.alto);
  const ancho = Math.min(ANCHO_MAX_CM, porAlto, Math.max(natural, Math.min(ANCHO_MIN_CM, porAlto)));
  return Math.round(ancho * 10) / 10;
}
