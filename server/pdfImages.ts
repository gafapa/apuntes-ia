import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export interface ImportedPdfImage {
  page: number;
  file: string;
  width: number;
  height: number;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngChunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of payload) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, checksum]);
}

/** Encode PDF.js decoded pixels without an additional native runtime dependency. */
export function pdfImageToPng(image: { width: number; height: number; kind: number; data: Uint8Array }): Buffer {
  const { width, height, kind, data } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 20000000) throw new Error('La imagen del PDF supera el tamaño admitido');
  const rowBytes = kind === 1 ? Math.ceil(width / 8) : width * (kind === 2 ? 3 : 4);
  if (![1, 2, 3].includes(kind) || !data || data.length < rowBytes * height) throw new Error('No se han podido decodificar los píxeles de una imagen del PDF');
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destination = y * (width * 4 + 1) + 1 + x * 4;
      if (kind === 1) {
        const value = data[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
        rows.fill(value, destination, destination + 3);
        rows[destination + 3] = 255;
      } else {
        const source = y * rowBytes + x * (kind === 2 ? 3 : 4);
        rows[destination] = data[source];
        rows[destination + 1] = data[source + 1];
        rows[destination + 2] = data[source + 2];
        rows[destination + 3] = kind === 3 ? data[source + 3] : 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Extract embedded raster images and inline images; PDF vector artwork is not an image object. */
export async function extractPdfImages(document: any, pdfjs: any, directory: string): Promise<{ images: ImportedPdfImage[]; warnings: string[] }> {
  await fs.mkdir(directory, { recursive: true });
  const images: ImportedPdfImage[] = [];
  const files = new Set<string>();
  let totalPixels = 0;
  let masks = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const operators = await page.getOperatorList();
    for (let index = 0; index < operators.fnArray.length; index++) {
      const operation = operators.fnArray[index];
      const args = operators.argsArray[index];
      let image: any;
      if (operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintImageXObjectRepeat) {
        const objects = String(args[0]).startsWith('g_') ? page.commonObjs : page.objs;
        image = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No se ha podido cargar una imagen del PDF')), 10000);
          objects.get(args[0], (value: unknown) => { clearTimeout(timer); resolve(value); });
        });
      } else if (operation === pdfjs.OPS.paintInlineImageXObject || operation === pdfjs.OPS.paintInlineImageXObjectGroup) {
        image = args[0];
      } else if ([pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup, pdfjs.OPS.paintImageMaskXObjectRepeat].includes(operation)) {
        masks++;
      }
      if (!image) continue;
      totalPixels += image.width * image.height;
      if (totalPixels > 100000000 || images.length >= 1000) throw new Error('El PDF supera el límite de imágenes para la importación');
      const png = pdfImageToPng(image);
      const hash = createHash('sha256').update(png).digest('hex').slice(0, 20);
      const filename = `pdf-imagen-${hash}.png`;
      if (!files.has(filename)) { await fs.writeFile(path.join(directory, filename), png, { flag: 'wx' }); files.add(filename); }
      images.push({ page: pageNumber, file: `recursos/${filename}`, width: image.width, height: image.height });
    }
  }
  return { images, warnings: masks ? ['El PDF contiene máscaras gráficas que requieren revisión; se han extraído sus imágenes rasterizadas normales.'] : [] };
}

/** Do not mark a transcription complete if the agent silently omitted an extracted image. */
export function missingPdfImages(markdown: string, images: ImportedPdfImage[]): ImportedPdfImage[] {
  const references = new Set([...markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)].map(match => match[1].replace(/^\.\//, '')));
  return images.filter((image, index) => images.findIndex(other => other.file === image.file) === index && !references.has(image.file));
}
