// Importar apuntes de Word conservando su formato y volver a exportarlos con el original de plantilla.
// Necesita Pandoc en resources-bin/<sistema> (npm run fetch-bin); si no está, se saltan.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { aMarkdown, limpiar, partirEnSecciones } from '../server/importar';
import { anchoCm } from '../server/formatoImportado';
import { exportar } from '../server/exportar';
import { Almacen } from '../server/store';

const dirBin = path.join(import.meta.dirname, '..', 'resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux');
const sinPandoc = !fs.existsSync(path.join(dirBin, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc')) && 'Falta Pandoc (npm run fetch-bin)';
const fixture = (n: string) => path.join(import.meta.dirname, 'fixtures', n);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-importar-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('Word con estilos propios y una tabla con celdas combinadas', { skip: sinPandoc }, async () => {
  const r = await aMarkdown(fixture('estilos-y-tablas.docx'), 'estilos-y-tablas.docx', dirBin, path.join(tmp, 'rec1'));
  assert.equal(r.titulo, 'LA CÉLULA');
  assert.equal(r.estiloTabla, 'TableGrid');
  // La tabla no se pierde: se aplana con todo su contenido
  assert.doesNotMatch(r.texto, /\[TABLE\]/);
  assert.match(r.texto, /\| Tamaño +\| Variable \(celda combinada\) +\| +\|/);
  assert.match(r.texto, /Ribosomas · Pared celular/);
  assert.equal(r.avisos.length, 1);
  // Estilos propios, subrayado y resaltado
  assert.match(r.texto, /::: \{custom-style="Definicion"\}\nDefinición:/);
  assert.match(r.texto, /\[célula\]\{custom-style="Termino"\}/);
  assert.match(r.texto, /\[palabras subrayadas\]\{\.underline\}/);
  assert.match(r.texto, /\[resaltadas\]\{\.mark\}/);
  // Los estilos estándar (listas numeradas) no se marcan
  assert.doesNotMatch(r.texto, /List Number/);
  const p = partirEnSecciones(r.texto, 'x');
  assert.deepEqual(
    p.secciones.map((s) => s.titulo),
    ['La teoría celular', 'Tipos de células'],
  );
});

test('notas al pie en su sección e imágenes con su ancho', { skip: sinPandoc }, async () => {
  const r = await aMarkdown(fixture('notas-e-imagen.docx'), 'notas-e-imagen.docx', dirBin, path.join(tmp, 'rec2'));
  assert.equal(r.imagenes, 1);
  assert.match(r.texto, /!\[Una foto\]\(recursos\/importada-[^)]+\.png\)\{width=4cm\}/);
  const [uno, dos] = partirEnSecciones(r.texto, 'x').secciones;
  assert.match(uno.texto, /\[\^1\]: +Primera nota/);
  assert.doesNotMatch(uno.texto, /\[\^2\]:/);
  assert.match(dos.texto, /\[\^2\]: +Segunda nota/);
});

test('limpiar quita lo que la app pone al exportar', () => {
  const t = limpiar('# 1.2 Título\n\n![Figura 3. Una célula](a.png)\n\n: Tabla 2: Datos\n\n\\newpage\n');
  assert.equal(t, '# Título\n\n![Una célula](a.png)\n\n: Datos\n');
});

test('anchos de imagen a cm', () => {
  assert.equal(anchoCm('2in'), '5.1cm');
  assert.equal(anchoCm('96px'), '2.5cm');
  assert.equal(anchoCm('50%'), '50%');
  assert.equal(anchoCm('auto'), undefined);
});

test('exportar a Word con el original de plantilla recupera sus estilos', { skip: sinPandoc }, async () => {
  const almacen = new Almacen(path.join(tmp, 'datos'));
  await almacen.iniciar();
  const asig = (await almacen.crearAsignatura({ nombre: 'Biología' })).id;
  const r = await aMarkdown(fixture('estilos-y-tablas.docx'), 'estilos-y-tablas.docx', dirBin, path.join(tmp, 'rec3'));
  const doc = (
    await almacen.crearDocumento(asig, {
      titulo: 'La célula',
      importado: { archivo: 'estilos-y-tablas.docx', formato: 'docx', modo: 'conservador', fecha: new Date().toISOString(), estiloOriginal: true, estiloTabla: r.estiloTabla },
    })
  ).id;
  fs.copyFileSync(fixture('estilos-y-tablas.docx'), path.join(almacen.dirDocumento(asig, doc), 'plantilla.docx'));
  for (const [i, s] of partirEnSecciones(r.texto, 'x').secciones.entries()) await almacen.guardarSeccion(asig, doc, `0${i + 1}-s.md`, s.texto);

  const e = await exportar(almacen, dirBin, asig, doc, { formato: 'docx', portada: true, indice: true, numerar: true, autoevaluacion: false, saltoSeccion: false }, {});
  const zip = await JSZip.loadAsync(fs.readFileSync(almacen.rutaExportado(asig, doc, e.nombre)));
  const xml = await zip.file('word/document.xml')!.async('string');
  for (const estilo of ['Definicion', 'Ejemplo', 'Normal']) assert.match(xml, new RegExp(`<w:pStyle w:val="${estilo}"`));
  assert.match(xml, /<w:rStyle w:val="Termino"/);
  assert.match(xml, /<w:tblStyle w:val="TableGrid"/);
  assert.match(xml, /<w:u w:val="single"/);
  assert.match(xml, /<w:highlight /);
  // La cabecera del original
  const cabeceras = Object.keys(zip.files).filter((n) => /word\/header\d*\.xml/.test(n));
  const textos = await Promise.all(cabeceras.map((n) => zip.file(n)!.async('string')));
  assert.ok(textos.some((t) => t.includes('IES Ejemplo')));
});
