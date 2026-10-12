import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { separateImportedContent } from '../server/importContent';
import { actividadesAMarkdown, bloqueAMarkdown } from '../shared/actividades';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { Flujo } from '../server/flujo';

const sample = `# Fictional networking notes

## Concepts
Networks connect devices and exchange messages using protocols. This fictional introduction explains addresses, routes and communication, with enough text to exercise the import conversion and preserve the teaching material exactly as provided.

### Ejercicios de repaso
Follow the instructions carefully.

1. Describe the router.[^shared]
2. Interpret this image: ![Diagram](recursos/network.png)

| Device | Address |
|---|---|
| Router | 192.0.2.1 |

### Soluciones
1. It forwards packets.
2. The diagram represents a network.

## More concepts
These explanations stay in the notes.[^shared]

[^shared]: A preserved footnote.
`;

test('Mixed notes separate exercises and preserve solutions, images, tables and shared footnotes', () => {
  const result = separateImportedContent(sample);
  assert.match(result.notes, /Networks connect devices/);
  assert.match(result.notes, /More concepts/);
  assert.doesNotMatch(result.notes, /Describe the router|It forwards packets/);
  assert.equal(result.activities.length, 1);
  const activity = result.activities[0];
  assert.equal(activity.preguntas.length, 2);
  assert.match(activity.preguntas[0].enunciado, /Follow the instructions carefully/);
  assert.equal(activity.preguntas[0].explicacion, 'It forwards packets.');
  assert.match(activity.importedContent!.markdown, /network\.png|192\.0\.2\.1/);
  assert.match(result.notes, /\[\^shared\]: A preserved footnote/);
  assert.match(activity.importedContent!.markdown, /\[\^shared\]: A preserved footnote/);
  assert.match(bloqueAMarkdown(activity), /::: solucion\n1\. It forwards packets/);
  activity.opciones.soluciones = false;
  assert.doesNotMatch(bloqueAMarkdown(activity), /It forwards packets/);
  activity.incluir = false;
  assert.equal(actividadesAMarkdown([activity]), '');
});

test('Worked examples, FAQ, orphan solutions and code stay in the notes', () => {
  const source = '# Ejercicios resueltos\nA worked example.\n\n## Preguntas frecuentes\nA FAQ.\n\n## Soluciones\nOrphan answer.\n\n```md\n# Ejercicios\n1. Example only.\n```\n\n    **Ejercicios**\n';
  const result = separateImportedContent(source);
  assert.equal(result.activities.length, 0);
  assert.equal(result.notes.trim(), source.trim());
});

test('Inline exercise labels, Galician headings and weekly questions preserve content', () => {
  const source = '# Theory\nTeaching text.\n\n**Ejercicio 1:** Calculate 2 + 2.\n\n## New theory\nMore text.\n\n### Exercicios\n1. Describe un concepto.\n\n### Solucións\n1. Unha resposta.\n';
  const result = separateImportedContent(source);
  assert.equal(result.activities.length, 2);
  assert.match(result.activities[0].preguntas[0].enunciado, /Calculate 2 \+ 2/);
  assert.match(result.notes, /More text/);
  assert.equal(result.activities[1].preguntas[0].explicacion, 'Unha resposta.');
});

test('Numbered code in an exercise does not become additional questions', () => {
  const result = separateImportedContent('# Exercises\n1. Read this code:\n\n```txt\n2. This is code.\n```\n\n2. Answer the next question.\n');
  assert.equal(result.activities[0].preguntas.length, 2);
  assert.match(result.activities[0].preguntas[0].enunciado, /2\. This is code/);
});

test('Nested numbered exercise headings stay together with their matching solutions', () => {
  const result = separateImportedContent('# Notes\nText.\n\n## Ejercicios\n### Ejercicio 1: First question\nFirst details.\n\n### Ejercicio 2: Second question\nSecond details.\n\n## Soluciones\n1. First answer.\n2. Second answer.\n');
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].preguntas.length, 2);
  assert.equal(result.activities[0].preguntas[0].explicacion, 'First answer.');
  assert.equal(result.activities[0].preguntas[1].explicacion, 'Second answer.');
});

test('Empty headings and unreferenced footnotes are retained', () => {
  const result = separateImportedContent('# Notes\nText.\n\n## Ejercicios\n\n[^unused]: Unused but preserved.\n');
  assert.equal(result.activities.length, 0);
  assert.match(result.notes, /## Ejercicios/);
  assert.match(result.notes, /Unused but preserved/);
});

test('Import-only mode creates sections and activity blocks without starting generation', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-import-content-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const assignment = await store.crearAsignatura({ nombre: 'Fictional networking' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const flow = new Flujo({ almacen: () => store, cola: queue, ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  const filename = path.join(directory, 'notes.md');
  await fs.writeFile(filename, sample);
  const result = await flow.importar(assignment.id, { ruta: filename, nombre: 'notes.md' }, { importOnly: true, modo: 'reescribir', diagnosticar: false });
  assert.equal(result.documento.importado!.modo, 'conservador');
  assert.equal(result.secciones, 2);
  assert.equal(result.actividades, 1);
  assert.equal(queue.listar().length, 0);
  const state = await flow.estado(assignment.id, result.documento.id);
  assert.equal(state.imported, true);
  assert.equal(state.indice!.aprobado, true);
  assert.equal(state.actividades.length, 1);
  assert.doesNotMatch((await store.textoCompleto(assignment.id, result.documento.id)).map(section => section.texto).join('\n'), /Describe the router/);
  assert.match(await fs.readFile(path.join(store.dirDocumento(assignment.id, result.documento.id), 'original', 'contenido.md'), 'utf8'), /Describe the router/);
  assert.equal(await fs.readFile(path.join(store.dirDocumento(assignment.id, result.documento.id), 'original', 'notes.md'), 'utf8'), sample);
  // PDF post-processing uses the same distribution rather than creating exercise sections.
  const transcription = path.join(store.dirDocumento(assignment.id, result.documento.id), '.agentes', 'transcription.md');
  await fs.mkdir(path.dirname(transcription), { recursive: true });
  await fs.writeFile(transcription, sample);
  await (flow as any).postTranscripcion({ asignatura: assignment.id, documento: result.documento.id }, { salida: '.agentes/transcription.md', nombre: 'notes.pdf', diagnosticar: false });
  const transcribed = await flow.estado(assignment.id, result.documento.id);
  assert.equal(transcribed.actividades.length, 1);
  assert.equal(transcribed.secciones.length, 2);
  const diagnosisPath = path.join(store.dirDocumento(assignment.id, result.documento.id), '.agentes', 'diagnosis.json');
  await fs.writeFile(diagnosisPath, JSON.stringify({ resumen: 'Fictional import review', problemas: [{ area: 'formato', descripcion: 'Fix the fictional table format.', gravedad: 'media' }], puntosFuertes: [], recomendacion: 'conservador' }));
  await (flow as any).postDiagnostico({ asignatura: assignment.id, documento: result.documento.id }, { salida: '.agentes/diagnosis.json' });
  const reviewed = await flow.estado(assignment.id, result.documento.id);
  assert.equal(reviewed.diagnostico!.problemas[0].accion, 'calidad');
});

test('Activity-only documents do not fabricate theory sections', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-exercises-only-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const assignment = await store.crearAsignatura({ nombre: 'Fictional exercises' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const flow = new Flujo({ almacen: () => store, cola: queue, ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  const filename = path.join(directory, 'exercises.md');
  await fs.writeFile(filename, '# Exercises\n1. Describe how a fictional network works and explain its components, their responsibilities, the addressing scheme and the information exchanged. Compare the result with another possible arrangement and justify the differences.\n');
  const result = await flow.importar(assignment.id, { ruta: filename, nombre: 'exercises.md' }, { importOnly: true, diagnosticar: true });
  assert.equal(result.secciones, 0);
  assert.equal(result.actividades, 1);
  assert.equal(queue.listar().length, 0);
});
