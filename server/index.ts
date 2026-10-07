// Servidor local: API REST, WebSocket de eventos y archivos estáticos de la interfaz.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { WebSocket } from 'ws';
import type { Ajustes, MensajeWS, Motor } from '../shared/tipos';
import { Almacen, ErrorUsuario } from './store';
import { Cola } from './agents/cola';
import { AGENTES, construirPrompt } from './agents/agentes';
import { abrirCarpeta, abrirTerminal, comandoInstalacion, comandoSesion, comprobarMotor } from './agents/motores';
import { cargarAjustes, guardarAjustes } from './ajustes';

export interface OpcionesServidor {
  archivoAjustes: string; // dónde se guardan los ajustes (fuera de la carpeta de datos)
  carpetaDatosPorDefecto: string;
  dirEstatico?: string; // interfaz compilada (en desarrollo la sirve Vite)
  puerto?: number;
  host?: string;
}

export async function crearServidor(op: OpcionesServidor) {
  let ajustes = await cargarAjustes(op.archivoAjustes, op.carpetaDatosPorDefecto);
  let almacen = new Almacen(ajustes.carpetaDatos);
  await almacen.iniciar();
  const cola = new Cola(ajustes.maxSimultaneos);

  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // ---------- Seguridad: solo peticiones desde la propia app ----------
  // Una web cualquiera abierta en el navegador podría intentar llamar a localhost.
  app.addHook('onRequest', async (req, rep) => {
    const origen = req.headers.origin;
    if (!origen) return;
    const host = req.headers.host ?? '';
    const permitido = [`http://${host}`, 'http://localhost:5173', 'http://127.0.0.1:5173'];
    if (!permitido.includes(origen)) {
      return rep.code(403).send({ error: 'Origen no permitido' });
    }
  });

  app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, _req, rep) => {
    const status = err instanceof ErrorUsuario ? err.status : err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    const msg = err.message || 'Error inesperado';
    rep.code(status).send({ error: err instanceof ErrorUsuario ? msg : status === 404 ? 'No encontrado' : msg });
  });

  // ---------- WebSocket ----------
  const clientes = new Set<WebSocket>();
  const difundir = (m: MensajeWS) => {
    const s = JSON.stringify(m);
    for (const c of clientes) if (c.readyState === 1) c.send(s);
  };
  cola.on('trabajo', (trabajo) => difundir({ tipo: 'trabajo', trabajo: { ...trabajo, eventos: [] } }));
  cola.on('evento', (id, evento) => difundir({ tipo: 'evento', id, evento }));
  cola.on('uso', (uso) => difundir({ tipo: 'uso', uso }));

  app.get('/ws', { websocket: true }, (socket) => {
    clientes.add(socket);
    socket.on('close', () => clientes.delete(socket));
    if (cola.uso.actualizado) socket.send(JSON.stringify({ tipo: 'uso', uso: cola.uso } satisfies MensajeWS));
  });

  // ---------- Vigilancia de archivos (para refrescar cuando un agente escribe) ----------
  let vigilante: fs.FSWatcher | undefined;
  const pendientes = new Map<string, NodeJS.Timeout>();
  const vigilar = () => {
    vigilante?.close();
    try {
      vigilante = fs.watch(almacen.raiz, { recursive: true }, (_ev, archivo) => {
        if (!archivo) return;
        const ruta = String(archivo).replace(/\\/g, '/');
        if (ruta.startsWith('.') || ruta.includes('/.tmp-')) return;
        clearTimeout(pendientes.get(ruta));
        pendientes.set(
          ruta,
          setTimeout(() => {
            pendientes.delete(ruta);
            const [asignatura, sub, documento] = ruta.split('/');
            difundir({ tipo: 'archivos', asignatura, documento: sub === 'documentos' ? documento : undefined, ruta });
          }, 250),
        );
      });
    } catch (e) {
      console.warn('No se pueden vigilar los archivos:', e);
    }
  };
  vigilar();

  // ---------- Ajustes y motores ----------
  app.get('/api/ajustes', async () => ajustes);
  app.put('/api/ajustes', async (req) => {
    const b = req.body as Partial<Ajustes>;
    const nuevo: Ajustes = { ...ajustes };
    if (typeof b.maxSimultaneos === 'number') nuevo.maxSimultaneos = Math.min(8, Math.max(1, Math.round(b.maxSimultaneos)));
    if (b.motorPorDefecto === 'claude' || b.motorPorDefecto === 'codex') nuevo.motorPorDefecto = b.motorPorDefecto;
    if (typeof b.asistenteCompletado === 'boolean') nuevo.asistenteCompletado = b.asistenteCompletado;
    if (typeof b.carpetaDatos === 'string' && b.carpetaDatos.trim() && b.carpetaDatos !== ajustes.carpetaDatos) {
      const dir = path.resolve(b.carpetaDatos.trim());
      await fsp.mkdir(dir, { recursive: true });
      nuevo.carpetaDatos = dir;
      almacen = new Almacen(dir);
      await almacen.iniciar();
      vigilar();
    }
    ajustes = nuevo;
    cola.maxSimultaneos = ajustes.maxSimultaneos;
    await guardarAjustes(op.archivoAjustes, ajustes);
    return ajustes;
  });

  app.get('/api/motores', async () => Promise.all([comprobarMotor('claude'), comprobarMotor('codex')]));
  app.post('/api/motores/:motor/:accion', async (req) => {
    const { motor, accion } = req.params as { motor: Motor; accion: string };
    if (motor !== 'claude' && motor !== 'codex') throw new ErrorUsuario('Motor desconocido');
    if (accion === 'instalar') abrirTerminal(comandoInstalacion(motor));
    else if (accion === 'sesion') abrirTerminal(comandoSesion(motor));
    else throw new ErrorUsuario('Acción desconocida');
    return { ok: true };
  });
  app.get('/api/motores/:motor/comandos', async (req) => {
    const { motor } = req.params as { motor: Motor };
    return { instalar: comandoInstalacion(motor), sesion: comandoSesion(motor) };
  });

  app.post('/api/abrir-carpeta', async (req) => {
    const { asignatura, documento, sub } = (req.body ?? {}) as { asignatura?: string; documento?: string; sub?: string };
    let dir = almacen.raiz;
    if (asignatura) dir = documento ? almacen.dirDocumento(asignatura, documento) : almacen.dirAsignatura(asignatura);
    if (sub && ['fuentes', 'recursos', 'exportados', 'secciones'].includes(sub)) dir = path.join(dir, sub);
    await fsp.mkdir(dir, { recursive: true });
    abrirCarpeta(dir);
    return { ok: true };
  });

  // ---------- Asignaturas ----------
  type PA = { a: string };
  type PD = { a: string; d: string };
  type PS = PD & { s: string };

  app.get('/api/asignaturas', async () => almacen.listarAsignaturas());
  app.post('/api/asignaturas', async (req) => almacen.crearAsignatura(req.body as object));
  app.get('/api/asignaturas/:a', async (req) => almacen.obtenerAsignatura((req.params as PA).a));
  app.put('/api/asignaturas/:a', async (req) => almacen.actualizarAsignatura((req.params as PA).a, req.body as object));
  app.delete('/api/asignaturas/:a', async (req) => {
    await almacen.eliminarAsignatura((req.params as PA).a);
    return { ok: true };
  });

  // ---------- Documentos ----------
  app.post('/api/asignaturas/:a/documentos', async (req) => almacen.crearDocumento((req.params as PA).a, req.body as object));
  app.get('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.obtenerDocumento(a, d);
  });
  app.put('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.actualizarDocumento(a, d, req.body as object);
  });
  app.delete('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    await almacen.eliminarDocumento(a, d);
    return { ok: true };
  });

  // ---------- Secciones ----------
  app.get('/api/asignaturas/:a/documentos/:d/secciones', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.listarSecciones(a, d);
  });
  app.post('/api/asignaturas/:a/documentos/:d/secciones', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.crearSeccion(a, d, String((req.body as { titulo?: string })?.titulo ?? ''));
  });
  app.put('/api/asignaturas/:a/documentos/:d/secciones/orden', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.renumerar(a, d, (req.body as { orden: string[] }).orden);
  });
  app.get('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    return { contenido: await almacen.leerSeccion(a, d, s) };
  });
  app.put('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    await almacen.guardarSeccion(a, d, s, String((req.body as { contenido: string }).contenido ?? ''));
    return { ok: true };
  });
  app.delete('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    await almacen.eliminarSeccion(a, d, s);
    return { ok: true };
  });

  // ---------- Fuentes (asignatura o documento) ----------
  const rutasFuentes = ['/api/asignaturas/:a/fuentes', '/api/asignaturas/:a/documentos/:d/fuentes'];
  for (const base of rutasFuentes) {
    app.get(base, async (req) => {
      const { a, d } = req.params as Partial<PD> & PA;
      return almacen.listarFuentes(a, d);
    });
    app.post(base, async (req) => {
      const { a, d } = req.params as Partial<PD> & PA;
      const guardados: string[] = [];
      for await (const parte of req.files()) {
        const destino = await almacen.rutaNuevaFuente(a, parte.filename, d);
        await pipeline(parte.file, fs.createWriteStream(destino));
        guardados.push(path.basename(destino));
      }
      return { guardados };
    });
    app.delete(`${base}/:nombre`, async (req) => {
      const { a, d, nombre } = req.params as Partial<PD> & PA & { nombre: string };
      await almacen.eliminarFuente(a, nombre, d);
      return { ok: true };
    });
  }

  // ---------- Agentes ----------
  app.get('/api/agentes', async () =>
    Object.values(AGENTES).map(({ id, nombre, descripcion, motor }) => ({ id, nombre, descripcion, motor })),
  );
  app.get('/api/trabajos', async () => cola.listar());
  app.get('/api/trabajos/:id', async (req) => {
    const t = cola.obtener((req.params as { id: string }).id);
    if (!t) throw new ErrorUsuario('Trabajo no encontrado', 404);
    return t;
  });
  app.post('/api/trabajos/:id/cancelar', async (req) => {
    cola.cancelar((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/trabajos/:id/responder', async (req) => {
    const texto = String((req.body as { texto?: string })?.texto ?? '').trim();
    if (!texto) throw new ErrorUsuario('Escribe una respuesta');
    try {
      return cola.responder((req.params as { id: string }).id, texto);
    } catch (e) {
      throw new ErrorUsuario((e as Error).message);
    }
  });
  app.post('/api/trabajos/limpiar', async () => {
    cola.limpiar();
    return cola.listar();
  });

  app.post('/api/trabajos', async (req) => {
    const b = req.body as { agente?: string; motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string };
    const agente = AGENTES[b.agente ?? 'asistente'];
    if (!agente) throw new ErrorUsuario('Agente desconocido');
    if (!b.tarea?.trim()) throw new ErrorUsuario('Escribe qué quieres que haga');
    const asignatura = await almacen.obtenerAsignatura(b.asignatura);
    const documento = b.documento ? await almacen.obtenerDocumento(b.asignatura, b.documento) : undefined;
    const secciones = documento ? await almacen.listarSecciones(b.asignatura, documento.id) : undefined;
    const motor: Motor = b.motor === 'claude' || b.motor === 'codex' ? b.motor : ajustes.motorPorDefecto;
    const dirAsig = almacen.dirAsignatura(asignatura.id);
    const cwd = documento ? almacen.dirDocumento(asignatura.id, documento.id) : dirAsig;
    return cola.encolar({
      agente: agente.id,
      nombreAgente: agente.nombre,
      motor,
      titulo: b.tarea.trim().split(/\r?\n/)[0].slice(0, 120),
      asignatura: asignatura.id,
      documento: documento?.id,
      prompt: construirPrompt(agente, { asignatura, documento, secciones, seccionActiva: b.seccion }, b.tarea),
      cwd,
      dirsExtra: documento ? [dirAsig] : [],
    });
  });

  app.get('/api/uso', async () => cola.uso);

  // ---------- Archivos de datos (imágenes de los apuntes) ----------
  app.get('/datos/*', async (req: FastifyRequest, rep: FastifyReply) => {
    const rel = (req.params as { '*': string })['*'];
    const abs = path.resolve(almacen.raiz, rel);
    if (!abs.startsWith(path.resolve(almacen.raiz) + path.sep)) return rep.code(403).send();
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return rep.code(404).send();
    return rep
      .type(tipoMime(abs))
      .header('Cache-Control', 'no-cache')
      // Un SVG descargado de internet no debe poder ejecutar scripts en la app
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
      .send(fs.createReadStream(abs));
  });

  // ---------- Interfaz ----------
  if (op.dirEstatico && fs.existsSync(op.dirEstatico)) {
    await app.register(fastifyStatic, { root: op.dirEstatico, wildcard: false });
    app.setNotFoundHandler((req, rep) => {
      if (req.url.startsWith('/api/')) return rep.code(404).send({ error: 'No encontrado' });
      return rep.sendFile('index.html');
    });
  }

  const direccion = await app.listen({ port: op.puerto ?? 0, host: op.host ?? '127.0.0.1' });
  return {
    url: direccion.replace('[::1]', 'localhost'),
    async cerrar() {
      for (const t of cola.listar()) if (t.estado === 'ejecutando' || t.estado === 'en-cola') cola.cancelar(t.id);
      vigilante?.close();
      await app.close();
    },
  };
}

function tipoMime(archivo: string): string {
  const ext = path.extname(archivo).toLowerCase();
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.md': 'text/markdown; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    }[ext] ?? 'application/octet-stream'
  );
}
