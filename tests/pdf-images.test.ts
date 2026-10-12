import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { leerPdf, partirEnSecciones } from '../server/importar';
import { missingPdfImages, pdfImageToPng } from '../server/pdfImages';
import { createPdfWithImages } from './fixtures/pdf-with-images';
import { Almacen } from '../server/store';
import { Cola, PedirAlAgente } from '../server/agents/cola';
import { Flujo } from '../server/flujo';

test('Actual PDF image extraction preserves colors, grayscale padding and transparency; repeated images share a file', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-pdf-images-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'fixture.pdf');
  await fs.writeFile(filename, createPdfWithImages());
  const result = await leerPdf(filename, path.join(directory, 'recursos'));
  assert.equal(result.paginas, 2);
  assert.equal(result.images.length, 4);
  assert.equal(new Set(result.images.map(image => image.file)).size, 3);
  assert.equal(result.images[0].file, result.images[3].file);
  assert.deepEqual(result.images.map(image => image.page), [1, 1, 1, 2]);
  const decode = async (relative: string) => {
    const image = await loadImage(path.join(directory, relative));
    const canvas = createCanvas(image.width, image.height);
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, 0, 0);
    return drawing.getImageData(0, 0, image.width, image.height).data;
  };
  const rgb = await decode(result.images[0].file);
  assert.deepEqual(Array.from(rgb.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(rgb.slice(4, 8)), [0, 255, 0, 255]);
  const grayscale = await decode(result.images[1].file);
  assert.equal(grayscale[0], 255);
  assert.equal(grayscale[4], 0);
  assert.equal(grayscale[8 * 4], 255);
  assert.equal(grayscale[9 * 4], 0);
  assert.equal(grayscale[10 * 4], 255);
  const alpha = await decode(result.images[2].file);
  assert.equal(alpha[3], 255);
  assert.equal(alpha[7], 0);
  assert.equal(alpha[11], 128);
  assert.deepEqual(result.warnings, []);
});

test('PNG encoder rejects invalid pixel lengths and oversized images', () => {
  assert.throws(() => pdfImageToPng({ width: 2, height: 2, kind: 2, data: new Uint8Array(1) }), /decodificar/);
  assert.throws(() => pdfImageToPng({ width: 100000, height: 100000, kind: 3, data: new Uint8Array() }), /tamaño/);
});

test('Transcription requires Markdown image references, rather than filenames mentioned in prose', () => {
  const images = [{ page: 1, file: 'recursos/pdf-image.png', width: 2, height: 2 }];
  assert.equal(missingPdfImages('The file recursos/pdf-image.png was extracted.', images).length, 1);
  assert.equal(missingPdfImages('![Figure](./recursos/pdf-image.png)', images).length, 0);
});

test('A PDF image in a short introduction survives section distribution', () => {
  const result = partirEnSecciones('# Notes\n\n![Introduction](recursos/intro.png)\n\n## First topic\nFirst topic text.\n\n## Second topic\nSecond topic text.\n', 'Notes');
  assert.match(result.secciones[0].texto, /recursos\/intro\.png/);
});

test('PDF import extracts resources before launching the agent and blocks an incomplete transcription', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-pdf-flow-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const assignment = await store.crearAsignatura({ nombre: 'Fictional PDF subject' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const flow = new Flujo({ almacen: () => store, cola: queue, ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  let captured: any;
  (flow as any).lanzar = async (input: any) => { captured = input; return {}; };
  const filename = path.join(directory, 'fixture.pdf');
  await fs.writeFile(filename, createPdfWithImages());
  const imported = await flow.importar(assignment.id, { ruta: filename, nombre: 'fixture.pdf' }, { importOnly: true, diagnosticar: false });
  assert.equal(imported.imagenes, 3);
  assert.equal(imported.trabajos, 1);
  assert.match(captured.tarea, /Página 1:.*recursos\/pdf-imagen-/);
  const documentDirectory = store.dirDocumento(assignment.id, imported.documento.id);
  const images = await store.leerJsonDoc<any[]>(assignment.id, imported.documento.id, 'pdf-images.json', []);
  for (const image of images) assert.ok((await fs.stat(path.join(documentDirectory, image.file))).size > 30);
  const output = String(captured.post.datos.salida);
  const text = '# Fictional notes\n\nThese teaching materials explain fictional networks, addresses, routers and protocols. The import should retain all embedded figures and their descriptions, without silently omitting them when the transcription finishes.\n';
  await fs.writeFile(path.join(documentDirectory, output), text);
  const job = { asignatura: assignment.id, documento: imported.documento.id };
  await assert.rejects((flow as any).postTranscripcion(job, captured.post.datos), PedirAlAgente);
  await fs.writeFile(path.join(documentDirectory, output), text + [...new Set(images.map(image => image.file))].map(file => `\n![Figure](${file})`).join('\n'));
  await (flow as any).postTranscripcion(job, captured.post.datos);
  const notes = (await store.textoCompleto(assignment.id, imported.documento.id)).map(section => section.texto).join('\n');
  assert.equal(missingPdfImages(notes, images).length, 0);
});
