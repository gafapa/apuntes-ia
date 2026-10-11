// Duplicar, papelera y copias de seguridad sobre una carpeta de datos temporal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Almacen } from '../server/store';
import { borrarDePapelera, crearCopia, duplicarAsignatura, duplicarDocumento, listarPapelera, restaurarCopia, restaurarDePapelera } from '../server/gestion';

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-gestion-'));
const almacen = new Almacen(path.join(raiz, 'datos'));
let asig = '';
let doc = '';

before(async () => {
  await almacen.iniciar();
  asig = (await almacen.crearAsignatura({ nombre: 'Biología 3º' })).id;
  doc = (await almacen.crearDocumento(asig, { titulo: 'La célula' })).id;
  await almacen.guardarSeccion(asig, doc, '01-intro.md', '# Introducción\n\nTexto.\n');
  const dir = almacen.dirDocumento(asig, doc);
  fs.mkdirSync(path.join(dir, '.historial'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.historial', 'x.md'), 'viejo');
  fs.writeFileSync(path.join(dir, 'exportados', 'la-celula.pdf'), 'pdf');
  fs.writeFileSync(path.join(dir, 'recursos', 'foto.png'), Buffer.alloc(5 * 1024 * 1024, 1)); // grande: va como flujo
});

after(() => fs.rmSync(raiz, { recursive: true, force: true }));

test('duplicar un documento en la misma asignatura y en otra', async () => {
  const copia = await duplicarDocumento(almacen, asig, doc, {});
  assert.equal(copia.titulo, 'La célula (copia)');
  assert.notEqual(copia.id, doc);
  assert.equal(await almacen.leerSeccion(asig, copia.id, '01-intro.md'), '# Introducción\n\nTexto.\n');
  const dir = almacen.dirDocumento(asig, copia.id);
  assert.equal(fs.existsSync(path.join(dir, '.historial')), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'exportados')), []);

  const otra = (await almacen.crearAsignatura({ nombre: 'Biología 4º' })).id;
  const enOtra = await duplicarDocumento(almacen, asig, doc, { destino: otra });
  assert.equal(enOtra.titulo, 'La célula');
  assert.equal((await almacen.obtenerDocumento(otra, enOtra.id)).asignatura, otra);
});

test('duplicar una asignatura', async () => {
  const id = await duplicarAsignatura(almacen, asig, 'Biología 3º (curso 27-28)');
  const a = await almacen.obtenerAsignatura(id);
  assert.equal(a.nombre, 'Biología 3º (curso 27-28)');
  assert.ok(a.documentos.length >= 2);
  assert.ok(a.documentos.every((d) => d.asignatura === id));
});

test('papelera: eliminar, listar, restaurar y vaciar', async () => {
  const d = (await almacen.crearDocumento(asig, { titulo: 'Para borrar' })).id;
  await almacen.eliminarDocumento(asig, d);
  let lista = await listarPapelera(almacen);
  const e = lista.find((x) => x.titulo === 'Para borrar')!;
  assert.equal(e.tipo, 'documento');
  assert.equal(e.asignatura, asig);
  assert.equal(e.nombreAsignatura, 'Biología 3º');
  assert.ok(!Number.isNaN(Date.parse(e.eliminado)));
  const r = await restaurarDePapelera(almacen, e.id);
  assert.equal(r.documento, d);
  assert.equal((await almacen.obtenerDocumento(asig, d)).titulo, 'Para borrar');

  // Un documento cuya asignatura está en la papelera no se puede restaurar antes que ella
  const tmp = (await almacen.crearAsignatura({ nombre: 'Temporal' })).id;
  const dt = (await almacen.crearDocumento(tmp, { titulo: 'Huérfano' })).id;
  await almacen.eliminarDocumento(tmp, dt);
  await almacen.eliminarAsignatura(tmp);
  lista = await listarPapelera(almacen);
  const huerfano = lista.find((x) => x.titulo === 'Huérfano')!;
  await assert.rejects(restaurarDePapelera(almacen, huerfano.id), /restaura antes la asignatura/);
  await restaurarDePapelera(almacen, lista.find((x) => x.titulo === 'Temporal')!.id);
  await restaurarDePapelera(almacen, huerfano.id);

  await almacen.eliminarDocumento(asig, d);
  await borrarDePapelera(almacen);
  assert.deepEqual(await listarPapelera(almacen), []);
});

test('tope de tokens del documento: se guarda y se quita con 0', async () => {
  assert.equal((await almacen.actualizarDocumento(asig, doc, { presupuesto: 5_000_000 })).presupuesto, 5_000_000);
  assert.equal((await almacen.actualizarDocumento(asig, doc, { titulo: 'La célula' })).presupuesto, 5_000_000);
  assert.equal((await almacen.actualizarDocumento(asig, doc, { presupuesto: 0 })).presupuesto, undefined);
});

test('copia de seguridad y restauración', async () => {
  const zip = path.join(raiz, 'copia.zip');
  await pipeline(await crearCopia(almacen, [asig], 'prueba'), fs.createWriteStream(zip));
  const restauradas = await restaurarCopia(almacen, zip);
  assert.equal(restauradas.length, 1);
  assert.equal(restauradas[0].nombre, 'Biología 3º (restaurada)');
  const a = await almacen.obtenerAsignatura(restauradas[0].id);
  const original = await almacen.obtenerAsignatura(asig);
  assert.equal(a.documentos.length, original.documentos.length);
  const d = a.documentos.find((x) => x.id === doc)!;
  assert.equal(await almacen.leerSeccion(a.id, d.id, '01-intro.md'), '# Introducción\n\nTexto.\n');
  assert.equal(fs.statSync(path.join(almacen.dirDocumento(a.id, d.id), 'recursos', 'foto.png')).size, 5 * 1024 * 1024);
});
