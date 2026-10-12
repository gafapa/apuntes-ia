import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ErrorUsuario } from './store';

/** Stage the upload first so truncated input cannot replace an existing template or be imported. */
export async function saveUpload(stream: Readable & { truncated?: boolean }, destination: string, replace = false): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.tmp-upload-${randomUUID()}`);
  try {
    await pipeline(stream, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (stream.truncated) throw new ErrorUsuario('El archivo supera el tamaño de subida admitido', 413);
    if (replace) await fs.rename(temporary, destination);
    else await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
