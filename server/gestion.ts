// Gestión de asignaturas y documentos: papelera (con restaurar), duplicar, copias de seguridad en .zip
// y reunir en una carpeta lo exportado de varios documentos.
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Asignatura, Documento, ElementoPapelera } from '../shared/tipos';
import { Almacen, ErrorUsuario, nombreLibre, slug } from './store';

// ---------------------------------------------------------------------------
// Papelera: .papelera/<fecha>-<asignatura> o .papelera/<fecha>-<asignatura>--<documento>

const MARCA = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)$/;

const dirPapelera = (almacen: Almacen) => path.join(almacen.raiz, '.papelera');

function rutaEnPapelera(almacen: Almacen, id: string) {
  if (!id || id.includes('/') || id.includes('\\') || id.startsWith('.')) throw new ErrorUsuario('Elemento no válido');
  const ruta = path.join(dirPapelera(almacen), id);
  if (!existsSync(ruta)) throw new ErrorUsuario('Ya no está en la papelera', 404);
  return ruta;
}

async function leerJson<T>(archivo: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(archivo, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function listarPapelera(almacen: Almacen): Promise<ElementoPapelera[]> {
  const dir = dirPapelera(almacen);
  if (!existsSync(dir)) return [];
  const res: ElementoPapelera[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const m = e.isDirectory() && e.name.match(MARCA);
    if (!m) continue;
    const eliminado = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    const ruta = path.join(dir, e.name);
    const asig = await leerJson<Asignatura>(path.join(ruta, 'asignatura.json'));
    if (asig) {
      res.push({ id: e.name, tipo: 'asignatura', titulo: asig.nombre, asignatura: m[6], eliminado });
      continue;
    }
    const doc = await leerJson<Documento>(path.join(ruta, 'documento.json'));
    if (!doc) continue;
    const asignatura = m[6].split('--')[0];
    const nombreAsignatura = (await leerJson<Asignatura>(path.join(almacen.raiz, asignatura, 'asignatura.json')))?.nombre;
    res.push({ id: e.name, tipo: 'documento', titulo: doc.titulo, asignatura, nombreAsignatura, eliminado });
  }
  return res.sort((a, b) => b.eliminado.localeCompare(a.eliminado));
}

/** Devuelve un elemento de la papelera a su sitio (con otro nombre de carpeta si ya está ocupado). */
export async function restaurarDePapelera(almacen: Almacen, id: string): Promise<{ asignatura: string; documento?: string }> {
  const origen = rutaEnPapelera(almacen, id);
  const elemento = (await listarPapelera(almacen)).find((e) => e.id === id);
  if (!elemento) throw new ErrorUsuario('No se reconoce este elemento de la papelera');
  if (elemento.tipo === 'asignatura') {
    const nuevo = await nombreLibre(almacen.raiz, elemento.asignatura);
    await fs.rename(origen, path.join(almacen.raiz, nuevo));
    return { asignatura: nuevo };
  }
  if (!existsSync(path.join(almacen.raiz, elemento.asignatura, 'asignatura.json'))) {
    throw new ErrorUsuario('Su asignatura ya no existe: restaura antes la asignatura (o duplica el documento en otra cuando esté restaurado).');
  }
  const base = path.join(almacen.dirAsignatura(elemento.asignatura), 'documentos');
  await fs.mkdir(base, { recursive: true });
  const nuevo = await nombreLibre(base, id.match(MARCA)![6].split('--').slice(1).join('--') || slug(elemento.titulo));
  await fs.rename(origen, path.join(base, nuevo));
  return { asignatura: elemento.asignatura, documento: nuevo };
}

/** Borra definitivamente un elemento de la papelera, o toda ella. */
export async function borrarDePapelera(almacen: Almacen, id?: string) {
  if (id) await fs.rm(rutaEnPapelera(almacen, id), { recursive: true, force: true });
  else await fs.rm(dirPapelera(almacen), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Duplicar

/** Lo que no se copia al duplicar: trabajo interno de los agentes, historial y lo ya exportado. */
const NO_DUPLICAR = new Set(['.agentes', '.historial', 'exportados', '.indice', '.texto']);

const filtro = (raiz: string, excluir: Set<string>) => (origen: string) =>
  !path
    .relative(raiz, origen)
    .split(path.sep)
    .some((p) => excluir.has(p));

export async function duplicarDocumento(almacen: Almacen, asig: string, doc: string, op: { titulo?: string; destino?: string }): Promise<Documento> {
  const original = await almacen.obtenerDocumento(asig, doc);
  const destino = op.destino || asig;
  await almacen.obtenerAsignatura(destino); // que exista
  const titulo = op.titulo?.trim() || (destino === asig ? `${original.titulo} (copia)` : original.titulo);
  const base = path.join(almacen.dirAsignatura(destino), 'documentos');
  await fs.mkdir(base, { recursive: true });
  const id = await nombreLibre(base, slug(titulo));
  const origen = almacen.dirDocumento(asig, doc);
  const dir = path.join(base, id);
  await fs.cp(origen, dir, { recursive: true, filter: filtro(origen, NO_DUPLICAR) });
  await fs.mkdir(path.join(dir, 'exportados'), { recursive: true });
  const ahora = new Date().toISOString();
  const nuevo: Documento = { ...original, id, asignatura: destino, titulo, creado: ahora, actualizado: ahora };
  await fs.writeFile(path.join(dir, 'documento.json'), JSON.stringify(nuevo, null, 2) + '\n', 'utf8');
  return nuevo;
}

export async function duplicarAsignatura(almacen: Almacen, asig: string, nombre?: string): Promise<string> {
  const original = await almacen.obtenerAsignatura(asig);
  const nuevoNombre = nombre?.trim() || `${original.nombre} (copia)`;
  const id = await nombreLibre(almacen.raiz, slug(nuevoNombre));
  const origen = almacen.dirAsignatura(asig);
  const dir = path.join(almacen.raiz, id);
  await fs.cp(origen, dir, { recursive: true, filter: filtro(origen, NO_DUPLICAR) });
  const ahora = new Date().toISOString();
  const datos = (await leerJson<Asignatura>(path.join(dir, 'asignatura.json')))!;
  await fs.writeFile(path.join(dir, 'asignatura.json'), JSON.stringify({ ...datos, id, nombre: nuevoNombre, creado: ahora, actualizado: ahora }, null, 2) + '\n', 'utf8');
  // Los documentos copiados empiezan su vida ahora
  const docs = path.join(dir, 'documentos');
  if (existsSync(docs)) {
    for (const d of await fs.readdir(docs)) {
      const archivo = path.join(docs, d, 'documento.json');
      const doc = await leerJson<Documento>(archivo);
      if (doc) await fs.writeFile(archivo, JSON.stringify({ ...doc, asignatura: id, creado: ahora, actualizado: ahora }, null, 2) + '\n', 'utf8');
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// Copias de seguridad: un .zip con una carpeta por asignatura y un manifiesto

const MANIFIESTO = 'apuntes-ia.json';
/** Lo que no hace falta guardar: se regenera solo. */
const NO_COPIAR = new Set(['.agentes', '.indice', '.texto']);

async function anadirCarpeta(zip: JSZip, dir: string, prefijo: string) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (NO_COPIAR.has(e.name)) continue;
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) await anadirCarpeta(zip, ruta, `${prefijo}${e.name}/`);
    else if (e.isFile()) {
      // Los grandes, como flujo (no caben todos en memoria); los pequeños, leídos (un flujo abierto
      // por archivo agotaría los descriptores con miles de imágenes)
      const { size } = await fs.stat(ruta);
      zip.file(`${prefijo}${e.name}`, size > 4 * 1024 * 1024 ? createReadStream(ruta) : await fs.readFile(ruta));
    }
  }
}

/** Copia de seguridad de unas asignaturas (o de todas). Devuelve el zip como flujo de datos. */
export async function crearCopia(almacen: Almacen, asignaturas: string[] | undefined, version: string) {
  const ids = asignaturas?.length ? asignaturas : (await almacen.listarAsignaturas()).map((a) => a.id);
  if (!ids.length) throw new ErrorUsuario('No hay asignaturas que copiar');
  const zip = new JSZip();
  zip.file(MANIFIESTO, JSON.stringify({ app: 'Apuntes IA', version, fecha: new Date().toISOString(), asignaturas: ids }, null, 2));
  for (const id of ids) {
    await almacen.obtenerAsignatura(id); // que exista
    await anadirCarpeta(zip, almacen.dirAsignatura(id), `${id}/`);
  }
  return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Restaura una copia de seguridad: cada asignatura del .zip se añade como nueva (si ya existe una con
 * el mismo nombre de carpeta, la restaurada se guarda aparte y se indica en su nombre).
 */
export async function restaurarCopia(almacen: Almacen, archivo: string): Promise<{ id: string; nombre: string }[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.readFile(archivo));
  } catch {
    throw new ErrorUsuario('El archivo no es un .zip válido');
  }
  const nombres = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  // Raíces: carpetas de primer nivel con asignatura.json (o el zip entero, si la tiene en la raíz)
  const raices = nombres.filter((n) => /^[^/]+\/asignatura\.json$/.test(n)).map((n) => n.slice(0, n.indexOf('/') + 1));
  if (!raices.length && nombres.includes('asignatura.json')) raices.push('');
  if (!raices.length) throw new ErrorUsuario('El .zip no contiene ninguna asignatura de Apuntes IA');
  const res: { id: string; nombre: string }[] = [];
  for (const raiz of raices) {
    const datos = JSON.parse(await zip.file(`${raiz}asignatura.json`)!.async('string')) as Asignatura;
    const base = slug(raiz.replace(/\/$/, '') || datos.nombre || 'asignatura');
    const ocupado = existsSync(path.join(almacen.raiz, base));
    const id = await nombreLibre(almacen.raiz, base);
    const destino = path.join(almacen.raiz, id);
    for (const n of nombres) {
      if (!n.startsWith(raiz) || n === MANIFIESTO) continue;
      const rel = n.slice(raiz.length);
      const final = path.resolve(destino, rel);
      if (!rel || !final.startsWith(destino + path.sep)) continue; // rutas que se salen de la carpeta
      await fs.mkdir(path.dirname(final), { recursive: true });
      await fs.writeFile(final, await zip.file(n)!.async('nodebuffer'));
    }
    const nombre = ocupado ? `${datos.nombre} (restaurada)` : datos.nombre;
    await fs.writeFile(path.join(destino, 'asignatura.json'), JSON.stringify({ ...datos, id, nombre }, null, 2) + '\n', 'utf8');
    res.push({ id, nombre });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Exportar varios documentos

/** Copia lo exportado de varios documentos a una carpeta de la asignatura (exportados/<fecha>). */
export async function reunirExportados(almacen: Almacen, asig: string, archivos: { documento: string; nombre: string }[]): Promise<string> {
  const a = await almacen.obtenerAsignatura(asig);
  const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  const dir = path.join(almacen.dirAsignatura(asig), 'exportados', `${a.nombre.replace(/[\\/:*?"<>|]/g, '_')} ${fecha}`);
  await fs.mkdir(dir, { recursive: true });
  for (const f of archivos) {
    const origen = almacen.rutaExportado(asig, f.documento, f.nombre);
    if (!existsSync(origen)) continue;
    const ext = path.extname(f.nombre);
    let nombre = f.nombre;
    for (let i = 2; existsSync(path.join(dir, nombre)); i++) nombre = `${path.basename(f.nombre, ext)}-${i}${ext}`;
    await fs.copyFile(origen, path.join(dir, nombre));
  }
  return dir;
}
