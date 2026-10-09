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
import type { Ajustes, EstadoMotor, HerramientasChat, PerfilGasto, SeleccionTexto, Trabajo, Indice, MensajeWS, MezclaVisuales, Motor, OpcionesExportacion, PropuestaVisual, TipoBusqueda, TipoRevision } from '../shared/tipos';
import { Almacen, ErrorUsuario } from './store';
import { Cola } from './agents/cola';
import { AGENTES } from './agents/agentes';
import { abrirArchivo, abrirCarpeta, abrirTerminal, comandoInstalacion, comandoSesion, comprobarMotor } from './agents/motores';
import { cargarAjustes, guardarAjustes } from './ajustes';
import { Flujo } from './flujo';
import { exportar } from './exportar';
import { Contador } from './tokens';
import { plantillaBase } from './plantillaBase';
import { Moleculas } from './moleculas';
import { Arasaac } from './arasaac';
import { ESFUERZOS, PERFILES, modelosDisponibles, preset } from './agents/modelos';
import { buscarImagenes, miniatura, type ResultadoImagen } from './imagenesWeb';
import { buscar as buscarRag, indexar } from './rag';

export interface OpcionesServidor {
  archivoAjustes: string; // dónde se guardan los ajustes (fuera de la carpeta de datos)
  carpetaDatosPorDefecto: string;
  dirEstatico?: string; // interfaz compilada (en desarrollo la sirve Vite)
  dirBin?: string; // Pandoc y Typst
  version?: string;
  dirTrabajos?: string; // dónde se guardan los trabajos de los agentes (por defecto, junto a los ajustes)
  /** Cómo lanzar el servidor MCP de búsqueda en las fuentes (dist/mcp-fuentes.cjs). */
  mcpFuentes?: { comando: string; args: string[]; env?: Record<string, string> };
  /** Reinicia la app instalando la actualización descargada (solo en la app empaquetada). */
  instalarActualizacion?: () => void;
  puerto?: number;
  host?: string;
}

export async function crearServidor(op: OpcionesServidor) {
  let ajustes = await cargarAjustes(op.archivoAjustes, op.carpetaDatosPorDefecto);
  let almacen = new Almacen(ajustes.carpetaDatos);
  await almacen.iniciar();
  // Los trabajos se guardan junto a los ajustes, para sobrevivir a reinicios del servidor
  const dirTrabajos = op.dirTrabajos ?? path.join(path.dirname(op.archivoAjustes), 'trabajos');
  bloquear(dirTrabajos);
  const cola = new Cola(ajustes.maxSimultaneos, dirTrabajos);
  const contador = new Contador(path.join(path.dirname(op.archivoAjustes), 'tokens.json'));
  const dirBin = op.dirBin ?? '';

  // Estado de los motores (se refresca al consultarlo desde la interfaz)
  let motores: EstadoMotor[] = [];
  const refrescarMotores = async () => (motores = await Promise.all([comprobarMotor('claude'), comprobarMotor('codex')]));
  refrescarMotores().catch(() => {});
  const motoresListos = () => new Set(motores.filter((m) => m.instalado && m.sesion).map((m) => m.motor));

  const moleculas = new Moleculas(path.join(path.dirname(op.archivoAjustes), 'moleculas.json'));
  const arasaac = new Arasaac(path.join(path.dirname(op.archivoAjustes), 'arasaac'));
  const flujo = new Flujo({ almacen: () => almacen, cola, ajustes: () => ajustes, motoresListos, dirBin, mcpFuentes: op.mcpFuentes, moleculas });
  await cola.cargar(); // retoma los trabajos que seguían en marcha
  contador.sembrar(cola.listar());
  cola.on('terminado', (t: Trabajo) => contador.llamada(t.agente));

  const app = Fastify({ logger: false, bodyLimit: 80 * 1024 * 1024 });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // ---------- Seguridad: solo peticiones desde la propia app ----------
  // Una web cualquiera abierta en el navegador podría intentar llamar a localhost.
  app.addHook('onRequest', async (req, rep) => {
    const origen = req.headers.origin;
    if (!origen) return;
    const host = req.headers.host ?? '';
    const web = process.env.APUNTES_PUERTO_WEB ?? '5173'; // interfaz de Vite en desarrollo
    const permitido = [`http://${host}`, `http://localhost:${web}`, `http://127.0.0.1:${web}`];
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
  cola.on('tokens', (motor, tokens, t) => {
    contador.sumar(motor, tokens, t?.asignatura, t?.documento, t?.agente);
    difundir({ tipo: 'tokens', contador: contador.leer() });
  });

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
        if (ruta.split('/').some((p) => p.startsWith('.'))) return; // temporales, .agentes, .texto…
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
    if (b.agentes && typeof b.agentes === 'object') {
      nuevo.agentes = {};
      for (const [id, c] of Object.entries(b.agentes)) {
        if (!AGENTES[id] || !c) continue;
        const motor = c.motor === 'claude' || c.motor === 'codex' ? c.motor : undefined;
        const instrucciones = typeof c.instrucciones === 'string' && c.instrucciones.trim() ? c.instrucciones : undefined;
        const esfuerzo = c.esfuerzo === 'low' || c.esfuerzo === 'medium' || c.esfuerzo === 'high' ? c.esfuerzo : undefined;
        const modelo = typeof c.modelo === 'string' && /^[\w.-]{1,60}$/.test(c.modelo.trim()) ? c.modelo.trim() : undefined;
        if (motor || instrucciones || esfuerzo || modelo) nuevo.agentes[id] = { motor, instrucciones, esfuerzo, modelo };
      }
    }
    if (b.modoMotor === 'claude' || b.modoMotor === 'codex' || b.modoMotor === 'ambos') nuevo.modoMotor = b.modoMotor;
    if (typeof b.perfil === 'string' && b.perfil in PERFILES) nuevo.perfil = b.perfil;
    if (b.modelos && typeof b.modelos === 'object') {
      const modelos: NonNullable<Ajustes['modelos']> = {};
      for (const m of ['claude', 'codex'] as const) {
        const tabla = b.modelos[m];
        if (!tabla || typeof tabla !== 'object') continue;
        modelos[m] = {};
        for (const [agente, c] of Object.entries(tabla)) {
          if (!AGENTES[agente] || !c || typeof c.modelo !== 'string' || !/^[\w.:-]{1,80}$/.test(c.modelo)) continue;
          modelos[m]![agente] = { modelo: c.modelo, esfuerzo: c.esfuerzo && ESFUERZOS.includes(c.esfuerzo) ? c.esfuerzo : undefined };
        }
      }
      nuevo.modelos = modelos;
    }
    if (b.claves && typeof b.claves === 'object') {
      const clave = (v: unknown) => (typeof v === 'string' && /^[\w-]{3,100}$/.test(v.trim()) ? v.trim() : undefined);
      nuevo.claves = { europeana: clave(b.claves.europeana), smithsonian: clave(b.claves.smithsonian) };
    }
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

  app.get('/api/motores', async () => refrescarMotores());
  app.get('/api/version', async () => ({ version: op.version ?? 'desarrollo', actualizacion }));
  let actualizacion: { estado: 'disponible' | 'descargada'; version: string } | undefined;
  app.post('/api/actualizacion/instalar', async () => {
    if (!op.instalarActualizacion || actualizacion?.estado !== 'descargada') throw new ErrorUsuario('No hay ninguna actualización lista');
    setTimeout(() => op.instalarActualizacion!(), 300);
    return { ok: true };
  });
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
    if (!path.resolve(dir).startsWith(path.resolve(almacen.raiz))) throw new ErrorUsuario('Ruta no válida');
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
      flujo.prepararFuentes(a, d).catch(() => {}); // extraer texto e indexar
      return { guardados };
    });
    app.delete(`${base}/:nombre`, async (req) => {
      const { a, d, nombre } = req.params as Partial<PD> & PA & { nombre: string };
      await almacen.eliminarFuente(a, nombre, d);
      flujo.prepararFuentes(a, d).catch(() => {});
      return { ok: true };
    });
  }

  // ---------- Agentes ----------
  app.get('/api/agentes', async () => Object.values(AGENTES));
  // Modelos de cada motor y, para cada agente, el modelo y esfuerzo que le da el perfil vigente
  app.get('/api/modelos', async () => ({
    ...modelosDisponibles(),
    predeterminados: { claude: preset('claude', ajustes.perfil), codex: preset('codex', ajustes.perfil) },
  }));
  // Un perfil de gasto rellena modelo y esfuerzo de todos los agentes en los dos motores
  app.post('/api/ajustes/perfil/:perfil', async (req) => {
    const perfil = (req.params as { perfil: string }).perfil as PerfilGasto;
    if (!(perfil in PERFILES)) throw new ErrorUsuario('Perfil no válido');
    ajustes = { ...ajustes, perfil, modelos: { claude: preset('claude', perfil), codex: preset('codex', perfil) } };
    await guardarAjustes(op.archivoAjustes, ajustes);
    return ajustes;
  });
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
    const b = req.body as { motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string; herramientas?: HerramientasChat; seleccionTexto?: SeleccionTexto };
    return flujo.chat(b.asignatura, b.documento, b.tarea ?? '', b.motor, b.seccion, b.herramientas, b.seleccionTexto);
  });

  app.get('/api/uso', async () => cola.uso);
  app.get('/api/tokens', async () => contador.leer());
  // Imágenes con licencia libre de museos, bibliotecas y archivos
  app.get('/api/imagenes-web/miniatura', async (req, reply) => {
    try {
      const m = await miniatura(String((req.query as { url?: string }).url ?? ''));
      reply.header('Content-Type', m.tipo).header('Cache-Control', 'max-age=86400');
      return m.datos;
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  app.get('/api/imagenes-web', async (req) => {
    const { q, local } = req.query as { q?: string; local?: string };
    if (!q?.trim()) throw new ErrorUsuario('Escribe qué buscar');
    return buscarImagenes(q, { consultaLocal: local, claves: ajustes.claves });
  });
  // Pictograma de ARASAAC de una palabra, para los bloques ```pictogramas
  app.get('/api/arasaac', async (req, reply) => {
    const { palabra, idioma } = req.query as { palabra?: string; idioma?: string };
    try {
      const png = await arasaac.pictograma(String(palabra ?? ''), String(idioma ?? 'es'));
      reply.header('Content-Type', 'image/png').header('Cache-Control', 'max-age=604800');
      return png;
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  // Estructura de una molécula (nombre o SMILES) para los bloques ```molecula
  app.get('/api/molecula', async (req) => {
    try {
      return await moleculas.resolver(String((req.query as { q?: string }).q ?? ''));
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  app.delete('/api/tokens', async () => {
    contador.reiniciar();
    const c = contador.leer();
    difundir({ tipo: 'tokens', contador: c });
    return c;
  });

  // ---------- Flujo de trabajo del documento ----------
  const D = '/api/asignaturas/:a/documentos/:d';
  type Cuerpo = { indicaciones?: string; archivos?: string[]; tipos?: TipoRevision[]; ids?: string[] };
  const params = (req: FastifyRequest) => req.params as PD;
  const cuerpo = (req: FastifyRequest) => (req.body ?? {}) as Cuerpo;

  app.get(`${D}/flujo`, async (req) => flujo.estado(params(req).a, params(req).d));
  app.post(`${D}/flujo/investigar`, async (req) =>
    flujo.investigar(params(req).a, params(req).d, cuerpo(req).indicaciones, !!(req.body as { soloPreguntas?: boolean })?.soloPreguntas),
  );
  app.post(`${D}/flujo/preguntas`, async (req) =>
    flujo.anadirPregunta(params(req).a, params(req).d, String((req.body as { texto?: string })?.texto ?? '')),
  );
  app.delete(`${D}/flujo/preguntas/:id`, async (req) => {
    await flujo.eliminarPregunta(params(req).a, params(req).d, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.post(`${D}/flujo/indice`, async (req) => {
    const b = (req.body ?? {}) as { indicaciones?: string; profundidad?: number; soloApartados?: boolean };
    return flujo.proponerIndice(params(req).a, params(req).d, b.indicaciones, b.profundidad, !!b.soloApartados);
  });
  app.put(`${D}/flujo/indice`, async (req) => flujo.guardarIndice(params(req).a, params(req).d, req.body as Indice));
  app.post(`${D}/flujo/indice/aprobar`, async (req) => flujo.aprobarIndice(params(req).a, params(req).d));
  app.post(`${D}/flujo/redactar`, async (req) =>
    flujo.redactar(params(req).a, params(req).d, cuerpo(req).archivos ?? [], cuerpo(req).indicaciones),
  );
  app.post(`${D}/flujo/revisar`, async (req) => {
    const tipos = (cuerpo(req).tipos ?? []).filter((t) => ['estilo', 'calidad', 'fuentes', 'curriculo'].includes(t));
    if (!tipos.length) throw new ErrorUsuario('Elige al menos un tipo de revisión');
    return flujo.revisar(params(req).a, params(req).d, tipos, cuerpo(req).archivos, cuerpo(req).indicaciones);
  });
  app.post(`${D}/flujo/sugerencias/:decision`, async (req) => {
    const { decision } = req.params as { decision: string };
    if (decision !== 'aceptar' && decision !== 'rechazar') throw new ErrorUsuario('Decisión no válida');
    const b = req.body as { ids: string[]; propuesta?: string };
    return flujo.decidirSugerencias(params(req).a, params(req).d, b.ids ?? [], decision, b.propuesta);
  });
  app.delete(`${D}/flujo/sugerencias`, async (req) => {
    await flujo.limpiarSugerencias(params(req).a, params(req).d);
    return { ok: true };
  });
  app.post(`${D}/flujo/visuales`, async (req) =>
    flujo.proponerVisuales(params(req).a, params(req).d, cuerpo(req).archivos, cuerpo(req).indicaciones, (req.body as { mezcla?: MezclaVisuales })?.mezcla),
  );
  app.put(`${D}/flujo/visuales/:id`, async (req) =>
    flujo.editarPropuesta(params(req).a, params(req).d, (req.params as { id: string }).id, req.body as Partial<PropuestaVisual>),
  );
  app.post(`${D}/flujo/visuales/:id/generar`, async (req) =>
    flujo.generarVisual(params(req).a, params(req).d, (req.params as { id: string }).id, cuerpo(req).indicaciones),
  );
  app.delete(`${D}/flujo/visuales`, async (req) => {
    await flujo.limpiarVisuales(params(req).a, params(req).d);
    return { ok: true };
  });
  app.get(`${D}/pies`, async (req) => flujo.sinPie(params(req).a, params(req).d));
  app.post(`${D}/imagenes-web`, async (req) => {
    const b = req.body as { resultado: ResultadoImagen; seccion?: string; pie?: string };
    return flujo.guardarImagenWeb(params(req).a, params(req).d, b.resultado, b.seccion, b.pie);
  });
  app.get(`${D}/imagenes-faltan`, async (req) => flujo.imagenesQueFaltan(params(req).a, params(req).d));
  app.post(`${D}/imagenes-faltan`, async (req) => flujo.repararImagenes(params(req).a, params(req).d));
  app.post(`${D}/pies`, async (req) => flujo.anadirPies(params(req).a, params(req).d));
  app.post(`${D}/flujo/autoevaluacion`, async (req) => flujo.autoevaluacion(params(req).a, params(req).d, cuerpo(req).indicaciones));


  // Índice de las fuentes (RAG): estado y búsqueda para el usuario
  for (const base of ['/api/asignaturas/:a/fuentes-indice', '/api/asignaturas/:a/documentos/:d/fuentes-indice']) {
    type P = { a: string; d?: string };
    app.get(base, async (req) => {
      const { a, d } = req.params as P;
      await flujo.prepararFuentes(a, d);
      return indexar(almacen.dirFuentes(a, d));
    });
    app.post(`${base}/buscar`, async (req) => {
      const { a, d } = req.params as P;
      const consulta = String((req.body as { consulta?: string })?.consulta ?? '');
      return buscarRag(flujo.carpetasFuentes(a, d), consulta, 10);
    });
  }

  // Buscador de fuentes (asignatura o documento)
  for (const base of ['/api/asignaturas/:a/busqueda-fuentes', '/api/asignaturas/:a/documentos/:d/busqueda-fuentes']) {
    type P = { a: string; d?: string; id?: string };
    app.get(base, async (req) => flujo.resultadosBusqueda((req.params as P).a, (req.params as P).d));
    app.post(base, async (req) => {
      const b = (req.body ?? {}) as { consulta?: string; tipo?: TipoBusqueda };
      return flujo.buscarFuentes((req.params as P).a, (req.params as P).d, String(b.consulta ?? ''), b.tipo);
    });
    app.delete(base, async (req) => {
      await flujo.limpiarBusqueda((req.params as P).a, (req.params as P).d);
      return { ok: true };
    });
    app.post(`${base}/:id/anadir`, async (req) => flujo.anadirFuente((req.params as P).a, (req.params as P).d, (req.params as P).id!));
    app.post(`${base}/:id/descartar`, async (req) => flujo.descartarResultado((req.params as P).a, (req.params as P).d, (req.params as P).id!));
  }

  // Glosario de la asignatura
  // Currículo oficial de la asignatura
  app.get('/api/asignaturas/:a/curriculo', async (req) => ({ contenido: await almacen.leerCurriculo((req.params as PA).a) }));
  app.put('/api/asignaturas/:a/curriculo', async (req) => {
    await almacen.guardarCurriculo((req.params as PA).a, String((req.body as { contenido?: string })?.contenido ?? ''));
    return { ok: true };
  });
  app.post('/api/asignaturas/:a/curriculo/buscar', async (req) => flujo.buscarCurriculo((req.params as PA).a, cuerpo(req).indicaciones));
  app.post('/api/asignaturas/:a/glosario/actualizar', async (req) => flujo.glosario((req.params as PA).a, cuerpo(req).indicaciones));
  app.get('/api/asignaturas/:a/glosario', async (req) => ({ contenido: await almacen.leerGlosario((req.params as PA).a) }));
  app.put('/api/asignaturas/:a/glosario', async (req) => {
    await almacen.guardarGlosario((req.params as PA).a, String((req.body as { contenido?: string }).contenido ?? ''));
    return { ok: true };
  });

  // Archivos editables de la raíz del documento (dossier de investigación)
  app.get(`${D}/archivo/:nombre`, async (req) => {
    const { nombre } = req.params as { nombre: string };
    if (!Almacen.ARCHIVOS_EDITABLES.includes(nombre)) throw new ErrorUsuario('Archivo no disponible', 404);
    return { contenido: await almacen.leerArchivoDoc(params(req).a, params(req).d, nombre) };
  });
  app.put(`${D}/archivo/:nombre`, async (req) => {
    const { nombre } = req.params as { nombre: string };
    await almacen.guardarArchivoDoc(params(req).a, params(req).d, nombre, String((req.body as { contenido?: string }).contenido ?? ''));
    return { ok: true };
  });

  // Recursos (imágenes)
  app.get(`${D}/recursos`, async (req) => almacen.listarRecursos(params(req).a, params(req).d));
  app.delete(`${D}/recursos/:nombre`, async (req) => {
    await almacen.eliminarRecurso(params(req).a, params(req).d, (req.params as { nombre: string }).nombre);
    return { ok: true };
  });

  // Exportación
  app.post(`${D}/exportar/moodle`, async (req) => flujo.exportarMoodle(params(req).a, params(req).d));
  app.post(`${D}/exportar`, async (req) => {
    const b = req.body as { opciones: OpcionesExportacion; diagramas?: Record<string, string> };
    if (!['docx', 'odt', 'pdf'].includes(b?.opciones?.formato)) throw new ErrorUsuario('Formato no válido');
    if (!dirBin) throw new ErrorUsuario('La exportación no está disponible en este modo');
    return exportar(almacen, dirBin, params(req).a, params(req).d, b.opciones, b.diagramas ?? {});
  });
  app.post(`${D}/exportados/:nombre/abrir`, async (req) => {
    const ruta = almacen.rutaExportado(params(req).a, params(req).d, (req.params as { nombre: string }).nombre);
    if (!fs.existsSync(ruta)) throw new ErrorUsuario('El archivo ya no existe', 404);
    abrirArchivo(ruta);
    return { ok: true };
  });

  // Plantillas de Word / LibreOffice de la asignatura
  app.get('/api/asignaturas/:a/plantillas', async (req) => almacen.plantillas((req.params as PA).a));
  app.post('/api/asignaturas/:a/plantillas', async (req) => {
    const { a } = req.params as PA;
    for await (const parte of req.files()) {
      const ext = path.extname(parte.filename).toLowerCase();
      if (ext !== '.docx' && ext !== '.odt') {
        parte.file.resume();
        throw new ErrorUsuario('La plantilla debe ser un .docx o un .odt');
      }
      await pipeline(parte.file, fs.createWriteStream(almacen.rutaPlantilla(a, ext.slice(1) as 'docx' | 'odt')));
    }
    return almacen.plantillas(a);
  });
  // Documento de base con todos los elementos, para crear la plantilla a partir de él
  app.get('/api/asignaturas/:a/plantillas/base/:formato', async (req, reply) => {
    const { a, formato } = req.params as PA & { formato: string };
    if (formato !== 'docx' && formato !== 'odt') throw new ErrorUsuario('Formato no válido');
    if (!dirBin) throw new ErrorUsuario('No está disponible en este modo');
    const datos = await plantillaBase(almacen, dirBin, a, formato);
    const nombre = `plantilla-base-${a}.${formato}`;
    reply
      .header('Content-Type', formato === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.oasis.opendocument.text')
      .header('Content-Disposition', `attachment; filename="${nombre}"`);
    return datos;
  });
  app.delete('/api/asignaturas/:a/plantillas/:formato', async (req) => {
    const { a, formato } = req.params as PA & { formato: string };
    if (formato !== 'docx' && formato !== 'odt') throw new ErrorUsuario('Formato no válido');
    await fsp.rm(almacen.rutaPlantilla(a, formato), { force: true });
    return almacen.plantillas(a);
  });

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
    avisarActualizacion(estado: 'disponible' | 'descargada', version: string) {
      actualizacion = { estado, version };
      difundir({ tipo: 'actualizacion', estado, version });
    },
    /** Cierra los agentes en marcha; se relanzarán al volver a abrir la app. */
    async cerrar() {
      cola.pausarTodo();
      vigilante?.close();
      await app.close();
    },
  };
}

/**
 * Solo un servidor a la vez puede gestionar la cola de agentes (p. ej. la app instalada
 * y el modo «en vivo» comparten datos). Un servidor que se reinicia no choca consigo mismo
 * porque el proceso anterior ya ha terminado.
 */
function bloquear(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const candado = path.join(dir, 'servidor.pid');
  try {
    const pid = Number(fs.readFileSync(candado, 'utf8'));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0); // lanza si el proceso ya no existe
      throw new Error('Apuntes IA ya está abierta (la versión instalada o el modo en vivo). Ciérrala antes de abrir otra.');
    }
  } catch (e) {
    if ((e as Error).message.startsWith('Apuntes IA')) throw e;
  }
  fs.writeFileSync(candado, String(process.pid));
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
