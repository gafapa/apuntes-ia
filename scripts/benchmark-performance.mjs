// Compare local synthetic workloads; no application documents or model calls are used.
// Run with node --import tsx scripts/benchmark-performance.mjs [baseline checkout path].
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const root = path.resolve(import.meta.dirname, '..');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-performance-'));
async function timed(operation, repetitions = 9) {
  const start = performance.now(); await operation(); const first = performance.now() - start;
  const samples = [];
  for (let index = 0; index < repetitions; index++) { const begin = performance.now(); await operation(); samples.push(performance.now() - begin); }
  samples.sort((a,b) => a-b);
  return { firstMs: Number(first.toFixed(2)), medianWarmMs: Number(samples[Math.floor(samples.length/2)].toFixed(2)) };
}
try {
  const sections = path.join(fixture, 'fictional', 'documentos', 'notes', 'secciones'); await fs.mkdir(sections, { recursive:true });
  const paragraph = 'Fictional networking explanation about routers, protocols, switches and addresses. '.repeat(700);
  for (let index=0;index<80;index++) await fs.writeFile(path.join(sections,`${String(index).padStart(3,'0')}-fixture.md`), `# Fictional section ${index}\n\n${paragraph}`);
  const sources = path.join(fixture,'sources'); await fs.mkdir(sources);
  await fs.writeFile(path.join(sources,'fictional.md'), Array.from({length:1200},(_,index)=>`## Fictional topic ${index}\n\n${'Fictional explanation about the networking protocol and its addressing scheme. '.repeat(12)}`).join('\n\n'));
  const roots = process.argv[2] ? [path.resolve(process.argv[2]), root] : [root];
  for (const checkout of roots) {
    const { Almacen } = await import(pathToFileURL(path.join(checkout,'server/store.ts')).href);
    const rag = await import(pathToFileURL(path.join(checkout,'server/rag.ts')).href);
    const store = new Almacen(fixture);
    const sectionListing = await timed(()=>store.listarSecciones('fictional','notes'));
    await rag.indexar(sources);
    const sourceSearch = await timed(()=>rag.buscar({documento:sources},'networking protocol addressing',6),5);
    console.log(JSON.stringify({checkout,sectionCount:80,sourceParagraphs:1200,sectionListing,sourceSearch}));
  }
} finally {
  const relative = path.relative(os.tmpdir(),fixture);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(fixture).startsWith('apuntes-performance-')) throw new Error('Unsafe benchmark cleanup path');
  await fs.rm(fixture,{recursive:true,force:true});
}
