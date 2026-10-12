import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import WebSocket from 'ws';
import { Almacen } from '../server/store';
import { crearServidor } from '../server/index';
import { restaurarCopia } from '../server/gestion';
import { loadSafeArchive, readArchiveText, validateArchive } from '../server/safeArchives';
import { removeFileAtomic, writeFileAtomic } from '../server/atomicFiles';
import { isApplicationUrl, isLocalRequestAllowed } from '../server/localSecurity';
import { fetchPublicResource, isPublicAddress, readResponseLimited, resolvePublicResource } from '../server/remoteResources';
import { saveUpload } from '../server/uploads';
import { Contador } from '../server/tokens';
import { cargarAjustes } from '../server/ajustes';
// @ts-expect-error: build helper is JavaScript.
import { sha256, verifyAssetDigest } from '../scripts/asset-integrity.mjs';

async function temporaryDirectory(context: { after: (callback: () => Promise<void>) => void }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-security-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Local boundaries reject spoofed hosts, cross-site requests without Origin and null origins', () => {
  assert.equal(isLocalRequestAllowed('127.0.0.1:4317', undefined, 'cross-site'), false);
  assert.equal(isLocalRequestAllowed('localhost:4317', 'null'), false);
  assert.equal(isLocalRequestAllowed('localhost.evil.invalid:4317'), false);
  assert.equal(isLocalRequestAllowed('localhost:65536'), false);
  assert.equal(isLocalRequestAllowed('[::1]:4317', 'http://[::1]:4317'), true);
  assert.equal(isLocalRequestAllowed('localhost:4317', 'http://localhost:5173'), false);
  assert.equal(isLocalRequestAllowed('localhost:4317', 'http://localhost:5173', 'same-site', '5173'), true);
  assert.equal(isLocalRequestAllowed('localhost:4317'), true);
});

test('Electron navigation rejects prefix lookalikes, credentials and different origins', () => {
  assert.equal(isApplicationUrl('http://localhost:4317/path', 'http://localhost:4317'), true);
  assert.equal(isApplicationUrl('http://localhost:4317@evil.invalid', 'http://localhost:4317'), false);
  assert.equal(isApplicationUrl('http://localhost:4318', 'http://localhost:4317'), false);
  assert.equal(isApplicationUrl('javascript:alert(1)', 'http://localhost:4317'), false);
});

test('Archive validation rejects traversal, Windows alternate streams, case collisions and symbolic links', async context => {
  const directory = await temporaryDirectory(context);
  for (const [index, unsafe] of ['../escape.md', 'folder/../../escape.md', 'C:/escape.md', 'folder\\escape.md', 'file.md:payload', 'NUL.txt'].entries()) {
    const zip = new JSZip();
    zip.file(unsafe, 'Untrusted input.');
    const filename = path.join(directory, `unsafe-${index}.zip`);
    await fs.writeFile(filename, await zip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(loadSafeArchive(filename), /seguras|incompatibles/);
  }
  const duplicates = new JSZip(); duplicates.file('A.md', 'a'); duplicates.file('a.md', 'b');
  assert.throws(() => validateArchive(duplicates), /duplicados/);
  const symlink = new JSZip(); symlink.file('link', '/outside', { unixPermissions: 0o120777 });
  assert.throws(() => validateArchive(symlink), /simbólicos/);
});

test('Archive limits cover declared sizes and actual streamed text', async context => {
  const directory = await temporaryDirectory(context);
  const zip = new JSZip(); zip.file('notes.md', 'a'.repeat(100));
  const filename = path.join(directory, 'bounded.zip');
  await fs.writeFile(filename, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const loaded = await loadSafeArchive(filename);
  assert.throws(() => validateArchive(loaded, { files: 10, fileBytes: 50, totalBytes: 100 }), /tamaño/);
  await assert.rejects(readArchiveText(loaded.file('notes.md')!, 50), /tamaño/);
});

test('A broken later subject or document leaves no partial restored subjects', async context => {
  const directory = await temporaryDirectory(context);
  const store = new Almacen(path.join(directory, 'data')); await store.iniciar();
  await store.crearAsignatura({ nombre: 'Existing fictional subject' });
  for (const mode of ['subject', 'document']) {
    const zip = new JSZip();
    zip.file('valid/asignatura.json', JSON.stringify({ nombre: 'Valid fictional subject' }));
    zip.file('later/asignatura.json', mode === 'subject' ? '{broken' : JSON.stringify({ nombre: 'Later fictional subject' }));
    if (mode === 'document') zip.file('later/documentos/one/documento.json', '{broken');
    const filename = path.join(directory, `${mode}.zip`);
    await fs.writeFile(filename, await zip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(restaurarCopia(store, filename), /dañados/);
    assert.equal((await store.listarAsignaturas()).length, 1);
    assert.equal((await fs.readdir(store.raiz)).some(name => name.startsWith('.restore-')), false);
  }
});

test('Concurrent creations with identical titles do not overwrite each other', async context => {
  const directory = await temporaryDirectory(context);
  const store = new Almacen(directory); await store.iniciar();
  const subjects = await Promise.all(Array.from({ length: 10 }, () => store.crearAsignatura({ nombre: 'Same fictional subject' })));
  assert.equal(new Set(subjects.map(subject => subject.id)).size, 10);
  const documents = await Promise.all(Array.from({ length: 10 }, () => store.crearDocumento(subjects[0].id, { titulo: 'Same fictional document' })));
  assert.equal(new Set(documents.map(document => document.id)).size, 10);
  await assert.rejects(store.crearDocumento('missing', { titulo: 'Orphan' }), /no existe/);
});

test('Concurrent JSON saves are complete and failed replacement preserves the previous target', async context => {
  const directory = await temporaryDirectory(context);
  const filename = path.join(directory, 'data.json');
  const writes = Array.from({ length: 50 }, (_, version) => writeFileAtomic(filename, JSON.stringify({ version, body: 'x'.repeat(1000) })));
  await Promise.all(writes);
  assert.equal(JSON.parse(await fs.readFile(filename, 'utf8')).version, 49);
  await fs.mkdir(path.join(directory, 'occupied'));
  await assert.rejects(writeFileAtomic(path.join(directory, 'occupied'), 'replacement'));
  assert.ok((await fs.stat(path.join(directory, 'occupied'))).isDirectory());
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith('.tmp-')), false);
  const pendingWrite = writeFileAtomic(filename, 'last write');
  const removal = removeFileAtomic(filename);
  await Promise.all([pendingWrite, removal]);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
});

test('Corrupted document state is reported rather than silently replaced by defaults', async context => {
  const directory = await temporaryDirectory(context);
  const store = new Almacen(directory); await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Fictional subject' });
  const document = await store.crearDocumento(subject.id, { titulo: 'Fictional document' });
  await fs.writeFile(path.join(store.dirDocumento(subject.id, document.id), 'indice.json'), '{broken');
  await assert.rejects(store.leerJsonDoc(subject.id, document.id, 'indice.json', {}), /dañado/);
  assert.deepEqual(await store.leerJsonDoc(subject.id, document.id, 'missing.json', {}), {});
});

test('Truncated uploads cannot replace a valid template or leave temporary files', async context => {
  const directory = await temporaryDirectory(context);
  const filename = path.join(directory, 'template.docx');
  await fs.writeFile(filename, 'Original valid template.');
  const stream = Object.assign(Readable.from(['Truncated replacement']), { truncated: true });
  await assert.rejects(saveUpload(stream, filename, true), /tamaño/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'Original valid template.');
  assert.equal((await fs.readdir(directory)).length, 1);
});

test('Public downloads reject private IPs, mixed DNS answers and local credential URLs', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  await assert.rejects(resolvePublicResource('http://example.invalid', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /local/);
  await assert.rejects(fetchPublicResource('http://127.0.0.1:4317/api/ajustes'), /local/);
  await assert.rejects(resolvePublicResource('https://user:secret@example.invalid'), /credenciales/);
});

test('Streaming download limits cancel oversized bodies before fully buffering them', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readResponseLimited(response, 40), /tamaño/);
  assert.equal(cancelled, true);
  const short = new Response('short');
  assert.equal((await readResponseLimited(short, 40)).toString(), 'short');
});

test('Token counts are flushed before the debounce interval or application shutdown', async context => {
  const directory = await temporaryDirectory(context);
  const filename = path.join(directory, 'tokens.json');
  const counter = new Contador(filename);
  counter.sumar('claude', { entrada: 20, salida: 10, cache: 5 }, 'fictional');
  await counter.flush();
  const saved = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.equal(saved.total.claude.entrada, 20);
  assert.equal(saved.total.claude.salida, 10);
});

test('Prototype-like subject, document and agent identifiers do not corrupt token totals', async context => {
  const directory = await temporaryDirectory(context);
  const counter = new Contador(path.join(directory, 'tokens.json'));
  counter.sumar('codex', { entrada: 12, salida: 4, cache: 0 }, 'constructor', '__proto__', 'constructor');
  counter.llamada('constructor');
  await counter.flush();
  assert.equal(counter.leer().porAsignatura!.constructor.documentos.__proto__.codex.entrada, 12);
  assert.equal(counter.leer().porAgente!.constructor.llamadas, 1);
  assert.equal(Object.getPrototypeOf(counter.leer().porAsignatura), Object.prototype);
});

test('Corrupt settings and usage files fail explicitly instead of silently resetting data', async context => {
  const directory = await temporaryDirectory(context);
  const filename = path.join(directory, 'broken.json');
  await fs.writeFile(filename, '{broken');
  await assert.rejects(cargarAjustes(filename, directory), /configuración/);
  assert.throws(() => new Contador(filename), /dañado/);
  assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
});

test('Downloaded executable assets require a matching SHA-256 release digest', () => {
  const data = Buffer.from('Fictional binary fixture');
  assert.equal(verifyAssetDigest(data, `sha256:${sha256(data)}`), sha256(data));
  assert.throws(() => verifyAssetDigest(data, undefined), /digest/);
  assert.throws(() => verifyAssetDigest(data, `sha256:${'0'.repeat(64)}`), /verification/);
});

test('The production HTTP and WebSocket server enforce boundaries and security headers', async context => {
  const directory = await temporaryDirectory(context);
  const staticDirectory = path.join(directory, 'static'); await fs.mkdir(staticDirectory);
  await fs.writeFile(path.join(staticDirectory, 'index.html'), '<!doctype html><title>Fictional QA</title>');
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), dirEstatico: staticDirectory, codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  try {
    const normal = await fetch(`${server.url}/api/version`);
    assert.equal(normal.status, 200);
    assert.equal(normal.headers.get('x-content-type-options'), 'nosniff');
    assert.match(normal.headers.get('content-security-policy')!, /script-src 'self';/);
    assert.equal((await fetch(`${server.url}/api/ajustes`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${server.url}/api/ajustes`, { headers: { Origin: 'http://localhost:5173' } })).status, 403);
    assert.equal((await fetch(`${server.url}/api/ajustes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
    const rejected = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/ws`, { origin: 'https://evil.invalid' });
      socket.on('unexpected-response', (_request, response) => { resolve(response.statusCode!); socket.terminate(); });
      socket.on('error', () => {});
      socket.on('open', () => { socket.close(); reject(new Error('Unexpected cross-site WebSocket accepted')); });
    });
    assert.equal(rejected, 403);
    const store = new Almacen(path.join(directory, 'data'));
    await store.crearAsignatura({ nombre: 'Fictional backup fixture' });
    const backup = await (await fetch(`${server.url}/api/copia`)).arrayBuffer();
    const form = new FormData();
    form.append('file', new Blob([backup], { type: 'application/zip' }), 'fixture.zip');
    const restored = await fetch(`${server.url}/api/copia`, { method: 'POST', body: form });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json() as unknown[]).length, 1);
    const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'fixture.txt'), 'Fictional private fixture');
    await fs.symlink(outside, path.join(store.raiz, 'linked'), 'junction');
    assert.equal((await fetch(`${server.url}/datos/linked/fixture.txt`)).status, 403);
  } finally { await server.cerrar(); }
});
