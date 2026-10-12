import { deflateSync } from 'node:zlib';

/** Small, self-contained fixture with RGB, odd-width grayscale and soft-mask images. */
export function createPdfWithImages(): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body)); };
  const stream = (dictionary: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
  const text = 'Fictional educational notes explain networks, addresses, routers and communication protocols. This fixture contains enough readable text for the importer and no personal information. Review the figures and compare their colors and transparency.';
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [8 0 R 10 0 R] /Count 2 >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add(stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', deflateSync(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))));
  add(stream('/Type /XObject /Subtype /Image /Width 9 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode', deflateSync(Buffer.from([0x80, 0x80, 0x7f, 0x00]))));
  add(stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R /Filter /FlateDecode', deflateSync(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))));
  add(stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', deflateSync(Buffer.from([255, 0, 128, 255]))));
  const resources = '/Resources << /Font << /F1 3 0 R >> /XObject << /RGB 4 0 R /BW 5 0 R /ALPHA 6 0 R >> >>';
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 450] ${resources} /Contents 9 0 R >>`);
  add(stream('', Buffer.from(`BT /F1 10 Tf 20 420 Td (${text.slice(0, 100)}) Tj 0 -16 Td (${text.slice(100, 190)}) Tj 0 -16 Td (${text.slice(190)}) Tj ET\nq 100 0 0 100 40 220 cm /RGB Do Q\nq 180 0 0 100 210 220 cm /BW Do Q\nq 100 0 0 100 460 220 cm /ALPHA Do Q`)));
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 450] ${resources} /Contents 11 0 R >>`);
  add(stream('', Buffer.from(`BT /F1 10 Tf 20 420 Td (${text.slice(0, 100)}) Tj 0 -16 Td (${text.slice(100, 190)}) Tj 0 -16 Td (${text.slice(190)}) Tj ET\nq 100 0 0 100 40 220 cm /RGB Do Q`)));
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    length += chunk.length;
  }
  const crossReference = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(crossReference));
  return Buffer.concat(chunks);
}
