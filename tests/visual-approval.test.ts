import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { FlujoVisuales } from '../server/fases/visuales';
import type { PropuestaVisual, Trabajo } from '../shared/tipos';
import { pdfImageToPng } from '../server/pdfImages';

class VisualTestFlow extends FlujoVisuales {
  finishDiagram(job: Trabajo, data: Record<string, unknown>) { return this.postDiagrama(job, data); }
  finishImage(job: Trabajo, data: Record<string, unknown>) { return this.postImagenIa(job, data); }
  finishMolecule(job: Trabajo, data: Record<string, unknown>) { return this.postMolecula(job, data); }
}

async function fixture(context: { after: (callback: () => Promise<void>) => void }, type: PropuestaVisual['tipo'] = 'diagrama') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-visual-approval-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(directory); await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Fictional visual QA' });
  const document = await store.crearDocumento(subject.id, { titulo: 'Fictional notes' });
  const section = '01-fixture.md';
  const original = '# Fictional notes\n\nA fictional anchor paragraph.\n\nFinal paragraph.\n';
  await store.guardarSeccion(subject.id, document.id, section, original);
  const proposal: PropuestaVisual = { id: 'fixture', seccion: section, ancla: 'A fictional anchor paragraph.', tipo: type, titulo: 'Fictional visual', descripcion: 'Fictional preview', estado: 'generando', creado: new Date().toISOString() };
  await store.escribirJsonDoc(subject.id, document.id, 'visuales.json', [proposal]);
  const flow = new VisualTestFlow({ almacen: () => store, cola: new Cola(1, path.join(directory, '.jobs')), ajustes: () => ({ carpetaDatos: directory, maxSimultaneos: 1, motorPorDefecto: 'claude', agentes: {} }), motoresListos: () => new Set(), moleculas: { resolver: async () => ({ smiles: 'CCO' }) } as any });
  const job = { asignatura: subject.id, documento: document.id } as Trabajo;
  const proposalState = async () => (await store.leerJsonDoc<PropuestaVisual[]>(subject.id, document.id, 'visuales.json', []))[0];
  const text = () => store.leerSeccion(subject.id, document.id, section);
  const writeOutput = async (content: string) => { await fs.writeFile(path.join(store.dirDocumento(subject.id, document.id), 'output.md'), content); };
  return { store, subject, document, section, original, proposal, flow, job, proposalState, text, writeOutput };
}

test('Generated diagrams stay in a durable preview; concurrent approvals insert exactly once', async context => {
  const f = await fixture(context);
  await f.writeOutput('```mermaid\nflowchart LR\n A --> B\n```');
  await f.flow.finishDiagram(f.job, { salida: 'output.md', id: 'fixture' });
  assert.equal(await f.text(), f.original);
  assert.equal((await f.proposalState()).estado, 'generada');
  assert.match((await f.proposalState()).markdown!, /flowchart LR/);
  await f.flow.limpiarVisuales(f.subject.id, f.document.id);
  assert.equal((await f.proposalState()).estado, 'generada');
  await Promise.all(Array.from({ length: 5 }, () => f.flow.approveVisual(f.subject.id, f.document.id, 'fixture')));
  assert.equal((await f.text()).split('```mermaid').length - 1, 1);
  assert.equal((await f.proposalState()).estado, 'insertada');
});

test('Discarding, editing and regenerating a preview leave the document unchanged', async context => {
  const f = await fixture(context);
  await f.writeOutput('```mermaid\nflowchart LR\n A --> B\n```');
  await f.flow.finishDiagram(f.job, { salida: 'output.md', id: 'fixture' });
  await f.flow.editarPropuesta(f.subject.id, f.document.id, 'fixture', { titulo: 'Changed fixture' });
  await assert.rejects(f.flow.approveVisual(f.subject.id, f.document.id, 'fixture'));
  await f.flow.finishDiagram(f.job, { salida: 'output.md', id: 'fixture' });
  await f.flow.editarPropuesta(f.subject.id, f.document.id, 'fixture', { estado: 'descartada' });
  await assert.rejects(f.flow.approveVisual(f.subject.id, f.document.id, 'fixture'));
  assert.equal(await f.text(), f.original);
});

test('Image and molecule generation require approval, including the direct molecule path', async context => {
  const f = await fixture(context, 'imagen-ia');
  const resource = 'recursos/fixture.png';
  await fs.mkdir(path.join(f.store.dirDocumento(f.subject.id, f.document.id), 'recursos'), { recursive: true });
  await fs.writeFile(path.join(f.store.dirDocumento(f.subject.id, f.document.id), resource), pdfImageToPng({ width: 1, height: 1, kind: 2, data: new Uint8Array([255, 0, 0]) }));
  await f.flow.finishImage(f.job, { rel: resource, id: 'fixture' });
  assert.equal(await f.text(), f.original);
  assert.match((await f.proposalState()).markdown!, /fixture.png/);
  await f.flow.approveVisual(f.subject.id, f.document.id, 'fixture');
  assert.match(await f.text(), /fixture.png/);
  await f.store.guardarSeccion(f.subject.id, f.document.id, f.section, f.original);
  await f.store.escribirJsonDoc(f.subject.id, f.document.id, 'visuales.json', [{ ...f.proposal, tipo: 'molecula', estado: 'propuesta', molecula: 'ethanol' }]);
  await f.flow.generarVisual(f.subject.id, f.document.id, 'fixture');
  assert.equal(await f.text(), f.original);
  assert.equal((await f.proposalState()).estado, 'generada');
  await f.flow.approveVisual(f.subject.id, f.document.id, 'fixture');
  assert.match(await f.text(), /```molecula\nethanol/);
});
