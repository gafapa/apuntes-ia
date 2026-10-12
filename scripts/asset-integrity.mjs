import { createHash } from 'node:crypto';

export function sha256(data) { return createHash('sha256').update(data).digest('hex'); }

export function verifyAssetDigest(data, digest) {
  const expected = /^sha256:([0-9a-f]{64})$/i.exec(digest ?? '')?.[1].toLowerCase();
  if (!expected) throw new Error('The release asset has no supported SHA-256 digest');
  if (sha256(data) !== expected) throw new Error('The downloaded release asset failed SHA-256 verification');
  return expected;
}
