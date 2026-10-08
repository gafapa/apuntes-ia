// Almacenamiento en disco: una carpeta por asignatura y una subcarpeta por documento.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Asignatura, AsignaturaDetalle, Documento, Exportado, Fuente, Permisos, Recurso, Seccion } from '../shared/tipos';
import { PERMISOS } from '../shared/tipos';

const COLORES = ['#7c5cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6'];

export class ErrorUsuario extends Error {
  constructor(msg: string, public status = 400) {
    super(msg);
  }
}

export function slug(texto: string): string {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'sin-titulo';
}

/** Valida que un nombre sea un único componente de ruta seguro. */
function nombreSeguro(nombre: string): string {
  if (!nombre || nombre.startsWith('.') || /[\\/:*?"<>|]/.test(nombre) || nombre.length > 200) {
    throw new ErrorUsuario(`Nombre no válido: ${nombre}`);
  }
  return nombre;
}

async function leerJson<T>(archivo: string): Promise<T> {
  return JSON.parse(await fs.readFile(archivo, 'utf8')) as T;
}

async function escribirJson(archivo: string, datos: unknown) {
  await fs.writeFile(archivo, JSON.stringify(datos, null, 2) + '\n', 'utf8');
}

async function leerTexto(archivo: string): Promise<string> {
  try {
    return await fs.readFile(archivo, 'utf8');
  } catch {
    return '';
  }
}

async function nombreLibre(dir: string, base: string): Promise<string> {
  let nombre = base;
  for (let i = 2; existsSync(path.join(dir, nombre)); i++) nombre = `${base}-${i}`;
  return nombre;
}

function ahora() {
  return new Date().toISOString();
}

export class Almacen {
  constructor(public raiz: string) {}

  async iniciar() {
    await fs.mkdir(this.raiz, { recursive: true });
  }

  dirAsignatura(id: string) {
    return path.join(this.raiz, nombreSeguro(id));
  }

  dirDocumento(asig: string, doc: string) {
    return path.join(this.dirAsignatura(asig), 'documentos', nombreSeguro(doc));
  }

  // ---------- Asignaturas ----------

  async listarAsignaturas(): Promise<(Asignatura & { documentos: Documento[] })[]> {
    const entradas = await fs.readdir(this.raiz, { withFileTypes: true });
    const res: (Asignatura & { documentos: Documento[] })[] = [];
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const archivo = path.join(this.raiz, e.name, 'asignatura.json');
      if (!existsSync(archivo)) continue;
      const a = await leerJson<Asignatura>(archivo);
      res.push({ ...a, id: e.name, documentos: await this.listarDocumentos(e.name) });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async obtenerAsignatura(id: string): Promise<AsignaturaDetalle> {
    const dir = this.dirAsignatura(id);
    const archivo = path.join(dir, 'asignatura.json');
    if (!existsSync(archivo)) throw new ErrorUsuario('La asignatura no existe', 404);
    const a = await leerJson<Asignatura>(archivo);
    return {
      ...a,
      id,
      contexto: await leerTexto(path.join(dir, 'contexto.md')),
      documentos: await this.listarDocumentos(id),
    };
  }

  async crearAsignatura(datos: Partial<AsignaturaDetalle>): Promise<AsignaturaDetalle> {
    const nombre = (datos.nombre ?? '').trim();
    if (!nombre) throw new ErrorUsuario('La asignatura necesita un nombre');
    const id = await nombreLibre(this.raiz, slug(nombre));
    const dir = path.join(this.raiz, id);
    await fs.mkdir(path.join(dir, 'fuentes'), { recursive: true });
    await fs.mkdir(path.join(dir, 'documentos'), { recursive: true });
    const n = (await fs.readdir(this.raiz)).length;
    const a: Asignatura = {
      id,
      nombre,
      nivel: datos.nivel ?? '',
      etapa: datos.etapa,
      curso: datos.curso,
      modalidad: datos.modalidad,
      familia: datos.familia,
      titulo: datos.titulo,
      destinatarios: datos.destinatarios ?? '',
      idioma: datos.idioma || 'Castellano',
      estilo: datos.estilo ?? '',
      color: datos.color || COLORES[n % COLORES.length],
      creado: ahora(),
      actualizado: ahora(),
    };
    await escribirJson(path.join(dir, 'asignatura.json'), a);
    await fs.writeFile(path.join(dir, 'contexto.md'), datos.contexto ?? '', 'utf8');
    await fs.writeFile(path.join(dir, 'glosario.md'), '# Glosario\n', 'utf8');
    return this.obtenerAsignatura(id);
  }

  async actualizarAsignatura(id: string, datos: Partial<AsignaturaDetalle>): Promise<AsignaturaDetalle> {
    const dir = this.dirAsignatura(id);
    const actual = await leerJson<Asignatura>(path.join(dir, 'asignatura.json'));
    const campos = ['nombre', 'nivel', 'destinatarios', 'idioma', 'estilo', 'color', 'etapa', 'curso', 'modalidad', 'familia', 'titulo'] as const;
    const nuevo: Asignatura = { ...actual, id, actualizado: ahora() };
    for (const c of campos) if (typeof datos[c] === 'string') nuevo[c] = datos[c]!;
    if (datos.permisos && typeof datos.permisos === 'object') nuevo.permisos = limpiarPermisos(datos.permisos);
    await escribirJson(path.join(dir, 'asignatura.json'), nuevo);
    if (typeof datos.contexto === 'string') {
      await fs.writeFile(path.join(dir, 'contexto.md'), datos.contexto, 'utf8');
    }
    return this.obtenerAsignatura(id);
  }

  /** No borra: mueve a la papelera dentro de la carpeta de datos. */
  async eliminarAsignatura(id: string) {
    await this.aPapelera(this.dirAsignatura(id), id);
  }

  private async aPapelera(origen: string, nombre: string) {
    const papelera = path.join(this.raiz, '.papelera');
    await fs.mkdir(papelera, { recursive: true });
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.rename(origen, path.join(papelera, `${marca}-${nombre}`));
  }

  // ---------- Documentos ----------

  async listarDocumentos(asig: string): Promise<Documento[]> {
    const dir = path.join(this.dirAsignatura(asig), 'documentos');
    if (!existsSync(dir)) return [];
    const res: Documento[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const archivo = path.join(dir, e.name, 'documento.json');
      if (!e.isDirectory() || !existsSync(archivo)) continue;
      res.push({ ...(await leerJson<Documento>(archivo)), id: e.name, asignatura: asig });
    }
    return res.sort((a, b) => a.creado.localeCompare(b.creado));
  }

  async obtenerDocumento(asig: string, id: string): Promise<Documento> {
    const archivo = path.join(this.dirDocumento(asig, id), 'documento.json');
    if (!existsSync(archivo)) throw new ErrorUsuario('El documento no existe', 404);
    return { ...(await leerJson<Documento>(archivo)), id, asignatura: asig };
  }

  async crearDocumento(asig: string, datos: Partial<Documento>): Promise<Documento> {
    const titulo = (datos.titulo ?? '').trim();
    if (!titulo) throw new ErrorUsuario('El documento necesita un título');
    const base = path.join(this.dirAsignatura(asig), 'documentos');
    await fs.mkdir(base, { recursive: true });
    const id = await nombreLibre(base, slug(titulo));
    const dir = path.join(base, id);
    for (const sub of ['secciones', 'fuentes', 'recursos', 'exportados']) {
      await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
    const doc: Documento = {
      id,
      asignatura: asig,
      titulo,
      objetivo: datos.objetivo ?? '',
      destinatarios: datos.destinatarios ?? '',
      extension: datos.extension ?? '',
      creado: ahora(),
      actualizado: ahora(),
    };
    await escribirJson(path.join(dir, 'documento.json'), doc);
    return doc;
  }

  async actualizarDocumento(asig: string, id: string, datos: Partial<Documento>): Promise<Documento> {
    const actual = await this.obtenerDocumento(asig, id);
    const campos = ['titulo', 'objetivo', 'destinatarios', 'extension'] as const;
    const nuevo: Documento = { ...actual, actualizado: ahora() };
    for (const c of campos) if (typeof datos[c] === 'string') nuevo[c] = datos[c]!;
    if (datos.permisos && typeof datos.permisos === 'object') nuevo.permisos = limpiarPermisos(datos.permisos);
    await escribirJson(path.join(this.dirDocumento(asig, id), 'documento.json'), nuevo);
    return nuevo;
  }

  async eliminarDocumento(asig: string, id: string) {
    await this.aPapelera(this.dirDocumento(asig, id), `${asig}--${id}`);
  }

  // ---------- Secciones ----------

  private dirSecciones(asig: string, doc: string) {
    return path.join(this.dirDocumento(asig, doc), 'secciones');
  }

  async listarSecciones(asig: string, doc: string): Promise<Seccion[]> {
    const dir = this.dirSecciones(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const archivos = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    const res: Seccion[] = [];
    for (const archivo of archivos) {
      const texto = await leerTexto(path.join(dir, archivo));
      const h = texto.match(/^#{1,3}\s+(.+)$/m);
      res.push({
        archivo,
        titulo: h ? h[1].trim() : archivo.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' '),
        palabras: texto.split(/\s+/).filter(Boolean).length,
      });
    }
    return res;
  }

  async leerSeccion(asig: string, doc: string, archivo: string): Promise<string> {
    return fs.readFile(path.join(this.dirSecciones(asig, doc), nombreSeguro(archivo)), 'utf8');
  }

  async guardarSeccion(asig: string, doc: string, archivo: string, contenido: string) {
    await fs.writeFile(path.join(this.dirSecciones(asig, doc), nombreSeguro(archivo)), contenido, 'utf8');
  }

  async crearSeccion(asig: string, doc: string, titulo: string): Promise<Seccion> {
    const t = titulo.trim() || 'Nueva sección';
    const existentes = await this.listarSecciones(asig, doc);
    const num = String(existentes.length + 1).padStart(2, '0');
    const archivo = `${num}-${slug(t)}.md`;
    await this.guardarSeccion(asig, doc, archivo, `# ${t}\n\n`);
    return { archivo, titulo: t, palabras: 0 };
  }

  async eliminarSeccion(asig: string, doc: string, archivo: string) {
    const dir = this.dirSecciones(asig, doc);
    await fs.rm(path.join(dir, nombreSeguro(archivo)));
    await this.renumerar(asig, doc, (await this.listarSecciones(asig, doc)).map((s) => s.archivo));
  }

  /** Renombra las secciones con prefijo numérico según el orden indicado. */
  async renumerar(asig: string, doc: string, orden: string[]): Promise<Seccion[]> {
    const dir = this.dirSecciones(asig, doc);
    const actuales = new Set((await fs.readdir(dir)).filter((f) => f.endsWith('.md')));
    if (orden.length !== actuales.size || orden.some((a) => !actuales.has(nombreSeguro(a)))) {
      throw new ErrorUsuario('El orden no coincide con las secciones existentes');
    }
    // Dos pasos para evitar colisiones de nombres
    const temporales = await Promise.all(
      orden.map(async (a, i) => {
        const tmp = `.tmp-${i}-${a}`;
        await fs.rename(path.join(dir, a), path.join(dir, tmp));
        return { tmp, base: a.replace(/^\d+-/, ''), i };
      }),
    );
    for (const { tmp, base, i } of temporales) {
      await fs.rename(path.join(dir, tmp), path.join(dir, `${String(i + 1).padStart(2, '0')}-${base}`));
    }
    return this.listarSecciones(asig, doc);
  }

  // ---------- Fuentes (material aportado) ----------

  dirFuentes(asig: string, doc?: string) {
    return doc ? path.join(this.dirDocumento(asig, doc), 'fuentes') : path.join(this.dirAsignatura(asig), 'fuentes');
  }

  async listarFuentes(asig: string, doc?: string): Promise<Fuente[]> {
    const dir = this.dirFuentes(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const res: Fuente[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async rutaNuevaFuente(asig: string, nombre: string, doc?: string): Promise<string> {
    const dir = this.dirFuentes(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const limpio = path.basename(nombre).replace(/[\\/:*?"<>|]/g, '_');
    const ext = path.extname(limpio);
    let final = limpio;
    for (let i = 2; existsSync(path.join(dir, final)); i++) final = `${path.basename(limpio, ext)} (${i})${ext}`;
    return path.join(dir, final);
  }

  async eliminarFuente(asig: string, nombre: string, doc?: string) {
    await fs.rm(path.join(this.dirFuentes(asig, doc), nombreSeguro(nombre)));
  }

  // ---------- Archivos auxiliares del documento ----------

  /** Archivos de la raíz del documento que se pueden leer y editar desde la interfaz. */
  static ARCHIVOS_EDITABLES = ['investigacion.md'];

  async leerJsonDoc<T>(asig: string, doc: string, nombre: string, defecto: T): Promise<T> {
    try {
      return await leerJson<T>(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
    } catch {
      return defecto;
    }
  }

  /** Escritura atómica (archivo temporal + renombrado) para no dejar JSON a medias. */
  async escribirJsonDoc(asig: string, doc: string, nombre: string, datos: unknown) {
    const destino = path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre));
    const tmp = path.join(path.dirname(destino), `.tmp-${Date.now()}-${nombre}`);
    await escribirJson(tmp, datos);
    await fs.rename(tmp, destino);
  }

  async leerArchivoDoc(asig: string, doc: string, nombre: string): Promise<string> {
    return leerTexto(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
  }

  async guardarArchivoDoc(asig: string, doc: string, nombre: string, contenido: string) {
    if (!Almacen.ARCHIVOS_EDITABLES.includes(nombre)) throw new ErrorUsuario('Archivo no editable');
    await fs.writeFile(path.join(this.dirDocumento(asig, doc), nombre), contenido, 'utf8');
  }

  async infoArchivoDoc(asig: string, doc: string, nombre: string) {
    try {
      const st = await fs.stat(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
      return { modificado: st.mtime.toISOString(), tamano: st.size };
    } catch {
      return undefined;
    }
  }

  /** Texto de todas las secciones, en orden. */
  async textoCompleto(asig: string, doc: string): Promise<{ archivo: string; texto: string }[]> {
    const secciones = await this.listarSecciones(asig, doc);
    return Promise.all(secciones.map(async (s) => ({ archivo: s.archivo, texto: await this.leerSeccion(asig, doc, s.archivo) })));
  }

  async listarRecursos(asig: string, doc: string): Promise<Recurso[]> {
    const dir = path.join(this.dirDocumento(asig, doc), 'recursos');
    await fs.mkdir(dir, { recursive: true });
    const textos = (await this.textoCompleto(asig, doc)).map((t) => t.texto).join('\n');
    const res: Recurso[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, tamano: st.size, modificado: st.mtime.toISOString(), usado: textos.includes(`recursos/${e.name}`) });
    }
    return res.sort((a, b) => b.modificado.localeCompare(a.modificado));
  }

  async eliminarRecurso(asig: string, doc: string, nombre: string) {
    await fs.rm(path.join(this.dirDocumento(asig, doc), 'recursos', nombreSeguro(nombre)));
  }

  async listarExportados(asig: string, doc: string): Promise<Exportado[]> {
    const dir = path.join(this.dirDocumento(asig, doc), 'exportados');
    await fs.mkdir(dir, { recursive: true });
    const res: Exportado[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, formato: path.extname(e.name).slice(1), tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return res.sort((a, b) => b.modificado.localeCompare(a.modificado));
  }

  rutaExportado(asig: string, doc: string, nombre: string) {
    return path.join(this.dirDocumento(asig, doc), 'exportados', nombreSeguro(nombre));
  }

  // ---------- Glosario y plantillas de la asignatura ----------

  async leerGlosario(asig: string) {
    return leerTexto(path.join(this.dirAsignatura(asig), 'glosario.md'));
  }

  async guardarGlosario(asig: string, texto: string) {
    await fs.writeFile(path.join(this.dirAsignatura(asig), 'glosario.md'), texto, 'utf8');
  }

  /** Plantilla de Word/LibreOffice propia de la asignatura (plantilla.docx / plantilla.odt). */
  rutaPlantilla(asig: string, formato: 'docx' | 'odt') {
    return path.join(this.dirAsignatura(asig), `plantilla.${formato}`);
  }

  async plantillas(asig: string) {
    return {
      docx: existsSync(this.rutaPlantilla(asig, 'docx')),
      odt: existsSync(this.rutaPlantilla(asig, 'odt')),
    };
  }
}

/** Solo los permisos conocidos y con valor sí/no (lo que falta se hereda o está permitido). */
function limpiarPermisos(p: Permisos): Permisos {
  const r: Permisos = {};
  for (const { id } of PERMISOS) if (typeof p[id] === 'boolean') r[id] = p[id];
  return r;
}
