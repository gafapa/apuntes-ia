import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { ErrorUsuario } from './store';

export const ARCHIVE_LIMITS = { files: 10000, fileBytes: 200 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 };
type Limits = typeof ARCHIVE_LIMITS;

export function validateArchive(zip: JSZip, limits: Limits = ARCHIVE_LIMITS): void {
  let total = 0;
  let count = 0;
  const names = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    const name = original.replace(/\/$/, '');
    const segments = name.split('/');
    if (!name || original !== entry.name || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.length > 1000 || segments.some(segment => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new ErrorUsuario('El ZIP contiene rutas no seguras o incompatibles');
    const permissions = Number(entry.unixPermissions ?? 0);
    if ((permissions & 0o170000) === 0o120000) throw new ErrorUsuario('El ZIP no puede contener enlaces simbólicos');
    if (entry.dir) continue;
    const folded = name.toLowerCase();
    if (names.has(folded)) throw new ErrorUsuario('El ZIP contiene nombres de archivo duplicados');
    names.add(folded);
    const size = (entry as any)._data?.uncompressedSize;
    if (typeof size === 'number') {
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) throw new ErrorUsuario('Un archivo del ZIP supera el tamaño admitido', 413);
      total += size;
    }
    if (++count > limits.files || total > limits.totalBytes) throw new ErrorUsuario('El ZIP supera el límite de archivos o tamaño descomprimido', 413);
  }
}

/** Check original entry names before JSZip's path normalization can hide a traversal. */
export async function loadSafeArchive(filename: string): Promise<JSZip> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await fs.readFile(filename)); }
  catch { throw new ErrorUsuario('El archivo no es un ZIP válido'); }
  validateArchive(zip);
  return zip;
}

export async function readArchiveText(entry: JSZip.JSZipObject, maxBytes = 10 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const collector = new Writable({ write(chunk, _encoding, callback) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) return callback(new ErrorUsuario('El texto del ZIP supera el tamaño admitido', 413));
    chunks.push(buffer);
    callback();
  } });
  await pipeline(entry.nodeStream('nodebuffer'), collector);
  return Buffer.concat(chunks).toString('utf8');
}

/** Bound actual decompressed bytes too, and never silently skip unsafe entries. */
export async function extractSafeArchive(zip: JSZip, destination: string): Promise<void> {
  const root = path.resolve(destination);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const filename = path.resolve(root, entry.name);
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ErrorUsuario('Ruta de ZIP fuera del destino');
    await fs.mkdir(path.dirname(filename), { recursive: true });
    let bytes = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      total += chunk.length;
      callback(bytes > ARCHIVE_LIMITS.fileBytes || total > ARCHIVE_LIMITS.totalBytes ? new ErrorUsuario('El ZIP supera el tamaño descomprimido admitido', 413) : null, chunk);
    } });
    await pipeline(entry.nodeStream('nodebuffer'), limiter, createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
  }
}
