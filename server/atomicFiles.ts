import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pending = new Map<string, Promise<void>>();

/** Serialize complete-file replacement so readers never see truncated JSON or Markdown. */
export function writeFileAtomic(filename: string, contents: string | Uint8Array): Promise<void> {
  const key = path.resolve(filename);
  const previous = pending.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const temporary = path.join(path.dirname(key), `.tmp-${randomUUID()}`);
    try {
      await fs.writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, key);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  });
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}

/** Serialize deletion after already scheduled writes, preventing removed records from reappearing. */
export function removeFileAtomic(filename: string): Promise<void> {
  const key = path.resolve(filename);
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => fs.rm(key, { force: true }));
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}
