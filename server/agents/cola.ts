// Cola de trabajos de los agentes: ejecuta Claude/Codex con un límite de simultaneidad
// y traduce su salida JSON a eventos legibles para la interfaz.
//
// Los agentes viven y mueren con la app: al cerrarla (o al reiniciarse el servidor en el
// modo «en vivo») se cierran. El estado de la cola se guarda en disco y, al volver a
// abrirla, los trabajos que quedaron a medias se relanzan solos: si el agente ya tenía
// sesión, continúa su conversación; si no, empieza de nuevo.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import type { EventoTrabajo, Motor, PasoFlujo, Tokens, Trabajo, UsoSuscripcion } from '../../shared/tipos';

type Traduccion = { mensaje?: string; resultado?: string; error?: string; final?: 'ok' | 'error'; tokens?: Tokens };
import { lanzar, rutaMotor } from './motores';

/**
 * Qué hacer con el resultado de un trabajo. Es un dato serializable (no una función)
 * para poder procesar el resultado aunque el servidor se haya reiniciado entre medias.
 */
export interface Postproceso {
  tipo: string;
  datos?: Record<string, unknown>;
}

export interface PeticionTrabajo {
  agente: string;
  nombreAgente: string;
  motor: Motor;
  titulo: string;
  asignatura: string;
  documento?: string;
  prompt: string;
  cwd: string;
  dirsExtra?: string[]; // carpetas adicionales accesibles (p. ej. la de la asignatura)
  reanudar?: string; // id de sesión del motor para continuar una conversación
  paso?: PasoFlujo;
  seccion?: string;
  ref?: string;
  post?: Postproceso;
  /** Instrucciones de sistema (en Claude sustituyen al prompt de sistema por defecto, mucho más largo). */
  sistema?: string;
  /** Si el agente necesita buscar en la web (si no, no se le cargan esas herramientas). */
  web?: boolean;
  esfuerzo?: 'low' | 'medium' | 'high';
  modelo?: string;
}

/** Funciones de Codex que los agentes de apuntes no usan y que añaden miles de tokens a cada petición. */
const CODEX_SIN_USAR = ['apps', 'browser_use', 'computer_use', 'memories', 'plugins', 'multi_agent', 'goals', 'hooks'];

export interface Manejadores {
  /**
   * Se ejecuta cuando el agente termina bien (también tras cada respuesta del usuario).
   * Si lanza un error, el trabajo se marca como fallido con ese mensaje y el usuario
   * puede responder al agente para que lo corrija.
   */
  alTerminar(t: Trabajo, post: Postproceso): Promise<string | void>;
  /** Se ejecuta si el trabajo falla o se cancela. */
  alFallar(t: Trabajo, post: Postproceso): Promise<void> | void;
}

/** Lo que se guarda en disco de cada trabajo. */
interface Registro {
  trabajo: Trabajo;
  peticion: Omit<PeticionTrabajo, 'prompt'>; // para poder responder después
  pid?: number;
  ejecucion: number; // nº de ejecución (cada respuesta del usuario es una nueva)
}

const MAX_EVENTOS = 400;
const CONTINUAR =
  'La aplicación se cerró mientras trabajabas y se ha vuelto a abrir. Continúa la tarea donde la dejaste y termínala (revisa qué archivos llegaste a escribir).';
const MAX_TRABAJOS = 200;
const DIAS_CONSERVAR = 7;

interface Seguimiento {
  proc: ChildProcess;
  pid: number;
  archivo: string;
  desplazamiento: number;
  resto: string;
  ultimoMensaje: string;
  errorReportado: boolean;
  final: 'ok' | 'error' | undefined; // evento de fin visto en la salida
  sondeo?: NodeJS.Timeout;
  cerrando?: boolean;
}

export class Cola extends EventEmitter {
  private registros = new Map<string, Registro>();
  private prompts = new Map<string, string>(); // prompt pendiente de los trabajos en cola
  private seguimientos = new Map<string, Seguimiento>();
  private guardadoPendiente = new Set<string>();
  private temporizadorGuardado?: NodeJS.Timeout;
  manejadores?: Manejadores;
  uso: UsoSuscripcion = { actualizado: 0 };

  constructor(
    public maxSimultaneos: number,
    private dir: string, // carpeta donde se guardan los trabajos
  ) {
    super();
    fs.mkdirSync(dir, { recursive: true });
  }

  private ruta(id: string, ext: string) {
    return path.join(this.dir, `${id}.${ext}`);
  }

  // ---------------------------------------------------------------------------
  // Persistencia

  /** Recupera los trabajos guardados y relanza los que quedaron a medias al cerrar la app. */
  async cargar() {
    const limite = Date.now() - DIAS_CONSERVAR * 86400_000;
    for (const f of await fsp.readdir(this.dir)) {
      if (!f.endsWith('.json') || f === 'servidor.json') continue;
      const archivo = path.join(this.dir, f);
      let r: Registro;
      try {
        r = JSON.parse(await fsp.readFile(archivo, 'utf8'));
      } catch {
        continue;
      }
      const t = r.trabajo;
      if (!t?.id) continue;
      if (t.fin && t.fin < limite) {
        this.borrarArchivos(t.id);
        continue;
      }
      this.registros.set(t.id, r);
      if (t.estado !== 'ejecutando' && t.estado !== 'en-cola') continue;

      // Por si el proceso de la sesión anterior siguiera vivo: se cierra antes de relanzar
      if (r.pid && vivo(r.pid)) await new Promise<void>((ok) => treeKill(r.pid!, () => ok()));
      r.pid = undefined;
      let prompt: string | undefined;
      if (t.estado === 'ejecutando' && t.sesion) {
        // Ya había empezado: que continúe su propia conversación
        r.peticion = { ...r.peticion, reanudar: t.sesion };
        prompt = CONTINUAR;
      } else {
        prompt = await fsp.readFile(this.ruta(t.id, 'prompt.txt'), 'utf8').catch(() => undefined);
      }
      if (prompt === undefined) {
        this.terminar(t, 'error', 'No se pudo retomar la tarea al abrir la aplicación');
        continue;
      }
      if (t.estado === 'ejecutando') this.evento(t, 'estado', 'Relanzado al volver a abrir la aplicación');
      t.estado = 'en-cola';
      t.inicio = undefined;
      this.prompts.set(t.id, prompt);
      this.guardar(t.id);
    }
    this.siguiente();
  }

  private guardar(id: string) {
    this.guardadoPendiente.add(id);
    if (this.temporizadorGuardado) return;
    this.temporizadorGuardado = setTimeout(() => {
      this.temporizadorGuardado = undefined;
      for (const i of this.guardadoPendiente) {
        const r = this.registros.get(i);
        if (r) fs.writeFile(this.ruta(i, 'json'), JSON.stringify(r), () => {});
      }
      this.guardadoPendiente.clear();
    }, 400);
  }

  private borrarArchivos(id: string) {
    for (const ext of ['json', 'prompt.txt', 'entrada.txt', 'sistema.txt', 'salida.jsonl', 'err.log']) fs.rm(this.ruta(id, ext), { force: true }, () => {});
  }

  // ---------------------------------------------------------------------------
  // API pública

  listar(): Trabajo[] {
    return [...this.registros.values()].map((r) => r.trabajo).sort((a, b) => b.creado - a.creado);
  }

  obtener(id: string) {
    return this.registros.get(id)?.trabajo;
  }

  encolar(p: PeticionTrabajo): Trabajo {
    const t: Trabajo = {
      id: randomUUID(),
      agente: p.agente,
      nombreAgente: p.nombreAgente,
      motor: p.motor,
      titulo: p.titulo,
      asignatura: p.asignatura,
      documento: p.documento,
      paso: p.paso,
      seccion: p.seccion,
      ref: p.ref,
      estado: 'en-cola',
      creado: Date.now(),
      eventos: [],
    };
    const { prompt, ...peticion } = p;
    this.registros.set(t.id, { trabajo: t, peticion, ejecucion: 0 });
    this.prompts.set(t.id, prompt);
    fs.writeFileSync(this.ruta(t.id, 'prompt.txt'), prompt, 'utf8');
    this.podar();
    this.emitir(t);
    this.siguiente();
    return t;
  }

  /** Continúa la conversación de un trabajo terminado con una respuesta del usuario. */
  responder(id: string, texto: string) {
    const r = this.registros.get(id);
    if (!r) throw new Error('Trabajo no encontrado');
    const t = r.trabajo;
    if (t.estado === 'en-cola' || t.estado === 'ejecutando') throw new Error('El agente todavía está trabajando');
    if (!t.sesion) throw new Error('Este trabajo no se puede continuar');
    r.peticion = { ...r.peticion, reanudar: t.sesion };
    r.pid = undefined;
    this.prompts.set(id, texto);
    fs.writeFileSync(this.ruta(id, 'prompt.txt'), texto, 'utf8');
    t.estado = 'en-cola';
    t.fin = undefined;
    t.inicio = undefined;
    t.resultado = undefined;
    t.creado = Date.now();
    this.evento(t, 'usuario', texto);
    this.emitir(t);
    this.siguiente();
    return t;
  }

  cancelar(id: string) {
    const t = this.obtener(id);
    if (!t) return;
    if (t.estado === 'en-cola') {
      this.terminar(t, 'cancelado', 'Cancelado antes de empezar');
    } else if (t.estado === 'ejecutando') {
      const s = this.seguimientos.get(id);
      t.estado = 'cancelado'; // se marca antes para que el cierre del proceso no lo pise
      if (s?.pid) treeKill(s.pid);
      this.terminar(t, 'cancelado', 'Cancelado por el usuario');
    }
  }

  /** Elimina de la lista los trabajos terminados. */
  limpiar() {
    for (const [id, r] of this.registros) {
      if (r.trabajo.estado !== 'en-cola' && r.trabajo.estado !== 'ejecutando') {
        this.registros.delete(id);
        this.borrarArchivos(id);
      }
    }
  }

  /** Cancela todo lo pendiente (al cerrar la app de forma ordenada). */
  detenerTodo() {
    for (const t of this.listar()) if (t.estado === 'ejecutando' || t.estado === 'en-cola') this.cancelar(t.id);
  }

  /**
   * Cierre de la app: cierra los agentes en marcha pero los deja anotados para relanzarlos
   * al volver a abrirla. Se guarda de forma síncrona porque el proceso va a terminar.
   */
  pausarTodo() {
    for (const [id, sg] of this.seguimientos) {
      sg.cerrando = true;
      clearInterval(sg.sondeo);
      sg.proc.removeAllListeners();
      if (sg.pid) treeKill(sg.pid);
      const r = this.registros.get(id);
      if (r) r.pid = undefined;
    }
    this.seguimientos.clear();
    for (const [id, r] of this.registros) {
      try {
        fs.writeFileSync(this.ruta(id, 'json'), JSON.stringify(r));
      } catch {}
    }
  }

  // ---------------------------------------------------------------------------

  private podar() {
    if (this.registros.size <= MAX_TRABAJOS) return;
    const terminados = this.listar().filter((t) => t.fin).reverse();
    for (const t of terminados.slice(0, this.registros.size - MAX_TRABAJOS)) {
      this.registros.delete(t.id);
      this.borrarArchivos(t.id);
    }
  }

  private emitir(t: Trabajo) {
    this.guardar(t.id);
    this.emit('trabajo', t);
  }

  private evento(t: Trabajo, tipo: EventoTrabajo['tipo'], texto: string, silencioso = false) {
    const ev: EventoTrabajo = { t: Date.now(), tipo, texto };
    t.eventos.push(ev);
    if (t.eventos.length > MAX_EVENTOS) t.eventos.splice(0, t.eventos.length - MAX_EVENTOS);
    this.guardar(t.id);
    if (!silencioso) this.emit('evento', t.id, ev);
  }

  private terminar(t: Trabajo, estado: Trabajo['estado'], texto?: string) {
    if (t.fin) return;
    t.estado = estado;
    t.fin = Date.now();
    if (texto) this.evento(t, estado === 'error' ? 'error' : 'estado', texto);
    const s = this.seguimientos.get(t.id);
    if (s) clearInterval(s.sondeo);
    this.seguimientos.delete(t.id);
    this.prompts.delete(t.id);
    const r = this.registros.get(t.id);
    if (r) r.pid = undefined;
    if (estado !== 'ok' && r?.peticion.post && this.manejadores) {
      Promise.resolve(this.manejadores.alFallar(t, r.peticion.post)).catch((e) => console.error(e));
    }
    this.emitir(t);
    this.emit('terminado', t);
    this.siguiente();
  }

  private siguiente() {
    const enCurso = this.listar().filter((t) => t.estado === 'ejecutando').length;
    if (enCurso >= this.maxSimultaneos) return;
    const pendiente = this.listar()
      .filter((t) => t.estado === 'en-cola' && this.prompts.has(t.id))
      .sort((a, b) => a.creado - b.creado)[0];
    if (!pendiente) return;
    this.ejecutar(pendiente);
    this.siguiente();
  }

  private ejecutar(t: Trabajo) {
    const r = this.registros.get(t.id)!;
    const p = r.peticion;
    const prompt = this.prompts.get(t.id) ?? '';
    this.prompts.delete(t.id);
    const ruta = rutaMotor(p.motor);
    t.estado = 'ejecutando';
    t.inicio = Date.now();
    r.ejecucion++;
    this.emitir(t);
    if (!ruta) {
      this.terminar(t, 'error', `No se encuentra ${p.motor === 'claude' ? 'Claude Code' : 'Codex'} en este equipo`);
      return;
    }

    // Ahorro de tokens: solo las herramientas necesarias, sin servidores MCP, sin los ajustes,
    // hooks y skills globales del usuario y con un prompt de sistema propio y corto
    // (medido: un «hola» pasa de ~21.000 a ~6.500 tokens de entrada con Claude).
    const herramientas = ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...(p.web ? ['WebSearch', 'WebFetch'] : [])].join(',');
    const archivoSistema = this.ruta(t.id, 'sistema.txt');
    if (p.motor === 'claude' && p.sistema) fs.writeFileSync(archivoSistema, p.sistema, 'utf8');
    const args =
      p.motor === 'claude'
        ? [
            '-p',
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', 'acceptEdits',
            '--tools', herramientas,
            '--allowedTools', herramientas,
            '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--setting-sources', 'project,local',
            '--disable-slash-commands',
            '--no-chrome',
            ...(p.sistema ? ['--system-prompt-file', archivoSistema] : []),
            ...(p.esfuerzo ? ['--effort', p.esfuerzo] : []),
            ...(p.modelo ? ['--model', p.modelo] : []),
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['--resume', p.reanudar] : []),
          ]
        : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '-s', 'workspace-write',
            '-C', p.cwd,
            ...CODEX_SIN_USAR.flatMap((f) => ['--disable', f]),
            ...(p.esfuerzo ? ['-c', `model_reasoning_effort=${p.esfuerzo}`] : []),
            ...(p.modelo ? ['-m', p.modelo] : []),
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['resume', p.reanudar] : []),
            '-',
          ];

    // Codex no permite sustituir su prompt de sistema: las instrucciones van al principio del prompt
    const promptFinal = p.motor === 'codex' && p.sistema && !p.reanudar ? `${p.sistema}

${prompt}` : prompt;

    // El prompt entra por un archivo y la salida va a otro (prompt.txt guarda el original, para relanzar)
    const archivoPrompt = this.ruta(t.id, 'entrada.txt');
    const archivoSalida = this.ruta(t.id, 'salida.jsonl');
    fs.writeFileSync(archivoPrompt, promptFinal, 'utf8');
    fs.writeFileSync(archivoSalida, '');
    let proc: ChildProcess;
    const fds: number[] = [];
    try {
      fds.push(fs.openSync(archivoPrompt, 'r'), fs.openSync(archivoSalida, 'a'), fs.openSync(this.ruta(t.id, 'err.log'), 'w'));
      proc = lanzar(ruta, args, { cwd: p.cwd, stdio: [fds[0], fds[1], fds[2]] });
    } catch (e) {
      this.terminar(t, 'error', `No se pudo iniciar: ${e}`);
      return;
    } finally {
      for (const fd of fds) fs.close(fd, () => {});
    }
    if (!proc.pid) {
      this.terminar(t, 'error', 'No se pudo iniciar el agente');
      return;
    }
    r.pid = proc.pid;
    this.evento(t, 'estado', `Iniciando ${p.motor === 'claude' ? 'Claude Code' : 'Codex'}…`);
    this.seguir(t.id, proc.pid, proc);
  }

  /** Lee la salida del agente a medida que la escribe. */
  private seguir(id: string, pid: number, proc: ChildProcess) {
    const t = this.obtener(id)!;
    const s: Seguimiento = {
      proc,
      pid,
      archivo: this.ruta(id, 'salida.jsonl'),
      desplazamiento: 0,
      resto: '',
      ultimoMensaje: '',
      errorReportado: false,
      final: undefined,
    };
    this.seguimientos.set(id, s);
    proc.on('error', (e) => this.terminar(t, 'error', `Error al ejecutar: ${e.message}`));
    proc.on('exit', (codigo) => setTimeout(() => this.alSalir(id, codigo), 150));
    s.sondeo = setInterval(() => this.leer(id), 400);
  }

  private leer(id: string, silencioso = false) {
    const s = this.seguimientos.get(id);
    const t = this.obtener(id);
    if (!s || !t) return;
    let tam: number;
    try {
      tam = fs.statSync(s.archivo).size;
    } catch {
      return;
    }
    if (tam <= s.desplazamiento) return;
    const fd = fs.openSync(s.archivo, 'r');
    const buf = Buffer.alloc(tam - s.desplazamiento);
    fs.readSync(fd, buf, 0, buf.length, s.desplazamiento);
    fs.closeSync(fd);
    s.desplazamiento = tam;
    s.resto += buf.toString('utf8');
    const lineas = s.resto.split('\n');
    s.resto = lineas.pop() ?? '';
    for (const l of lineas) this.procesarLinea(t, s, l, silencioso);
  }

  private procesarLinea(t: Trabajo, s: Seguimiento, linea: string, silencioso: boolean) {
    if (!linea.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(linea);
    } catch {
      return;
    }
    const motor = this.registros.get(t.id)!.peticion.motor;
    const r = motor === 'claude' ? this.traducirClaude(t, ev, silencioso) : this.traducirCodex(t, ev, silencioso);
    if (r?.mensaje) s.ultimoMensaje = r.mensaje;
    if (r?.resultado !== undefined) t.resultado = r.resultado;
    if (r?.final) s.final = r.final;
    if (r?.tokens && (r.tokens.entrada || r.tokens.salida)) {
      const previo = t.tokens ?? { entrada: 0, salida: 0, cache: 0 };
      t.tokens = { entrada: previo.entrada + r.tokens.entrada, salida: previo.salida + r.tokens.salida, cache: previo.cache + r.tokens.cache };
      this.emit('tokens', motor, r.tokens);
      this.emitir(t);
    }
    if (r?.error) {
      s.errorReportado = true;
      this.evento(t, 'error', r.error, silencioso);
    }
  }

  /** El proceso ha terminado. */
  private alSalir(id: string, codigo: number | null) {
    const s = this.seguimientos.get(id);
    const t = this.obtener(id);
    if (!s || !t || s.cerrando) return;
    s.cerrando = true;
    clearInterval(s.sondeo);
    this.leer(id);
    if (s.resto) this.procesarLinea(t, s, s.resto, false);
    if (t.estado === 'cancelado') return;
    if (t.resultado === undefined && s.ultimoMensaje) t.resultado = s.ultimoMensaje;
    const bien = codigo === 0;
    if (bien && !s.errorReportado) return this.finalizarBien(t);
    let detalle = '';
    try {
      detalle = fs
        .readFileSync(this.ruta(id, 'err.log'), 'utf8')
        .slice(-4000)
        .trim()
        .split(/\r?\n/)
        .filter((l) => !/Reading additional input/i.test(l))
        .slice(-3)
        .join('\n');
    } catch {}
    this.terminar(
      t,
      'error',
      `Ha terminado con errores${detalle ? `:\n${detalle}` : codigo !== null ? ` (código ${codigo})` : ''}`,
    );
  }

  private finalizarBien(t: Trabajo) {
    const post = this.registros.get(t.id)?.peticion.post;
    if (!post || !this.manejadores) return this.terminar(t, 'ok', 'Terminado');
    this.evento(t, 'estado', 'Procesando el resultado…');
    this.manejadores
      .alTerminar(t, post)
      .then((msg) => this.terminar(t, 'ok', msg || 'Terminado'))
      .catch((e) => this.terminar(t, 'error', String(e?.message ?? e)));
  }

  // ---------------------------------------------------------------------------
  // Traducción de la salida de cada motor

  private traducirClaude(t: Trabajo, ev: any, sil: boolean): Traduccion | void {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) t.sesion = ev.session_id;
          this.evento(t, 'estado', `Conectado (${ev.model ?? 'Claude'})`, sil);
        }
        return;
      case 'assistant': {
        let mensaje: string | undefined;
        for (const c of ev.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) {
            this.evento(t, 'texto', c.text.trim(), sil);
            mensaje = c.text.trim();
          } else if (c.type === 'tool_use') {
            this.evento(t, 'herramienta', describirHerramienta(c.name, c.input ?? {}), sil);
          }
        }
        return { mensaje };
      }
      case 'rate_limit_event': {
        const w = ev.rate_limit_info?.unifiedWindows ?? {};
        this.uso = {
          cincoHoras: w.five_hour?.utilization,
          semanal: w.seven_day?.utilization,
          reinicio: w.five_hour?.resetsAt ?? ev.rate_limit_info?.resetsAt,
          actualizado: Date.now(),
        };
        if (!sil) this.emit('uso', this.uso);
        return;
      }
      case 'result': {
        const u = ev.usage ?? {};
        const cache = Number(u.cache_read_input_tokens ?? 0);
        const tokens: Tokens = {
          entrada: Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + cache,
          salida: Number(u.output_tokens ?? 0),
          cache,
        };
        if (ev.is_error) return { error: String(ev.result ?? 'Error del agente'), final: 'error', tokens };
        return { resultado: typeof ev.result === 'string' ? ev.result : undefined, final: 'ok', tokens };
      }
    }
  }

  private traducirCodex(t: Trabajo, ev: any, sil: boolean): Traduccion | void {
    const item = ev.item;
    switch (ev.type) {
      case 'thread.started':
        if (ev.thread_id) t.sesion = ev.thread_id;
        this.evento(t, 'estado', 'Conectado (Codex)', sil);
        return;
      case 'item.started':
        if (item?.type === 'command_execution') this.evento(t, 'herramienta', `Ejecutando: ${recortar(item.command, 120)}`, sil);
        else if (item?.type === 'web_search') this.evento(t, 'herramienta', `Buscando en la web: ${item.query ?? ''}`, sil);
        return;
      case 'item.completed':
        if (item?.type === 'agent_message' && item.text?.trim()) {
          this.evento(t, 'texto', item.text.trim(), sil);
          return { mensaje: item.text.trim() };
        }
        if (item?.type === 'file_change') {
          const archivos = (item.changes ?? []).map((c: any) => nombreCorto(c.path)).join(', ');
          this.evento(t, 'herramienta', `Modificando: ${archivos || 'archivos'}`, sil);
        } else if (item?.type === 'image_generation' || /image/i.test(item?.type ?? '')) {
          this.evento(t, 'herramienta', 'Imagen generada', sil);
        } else if (item?.type === 'error') {
          return { error: item.message ?? 'Error de Codex' };
        }
        return;
      case 'turn.completed': {
        // En Codex, input_tokens ya incluye los leídos de caché (cached_input_tokens)
        const u = ev.usage ?? {};
        return {
          final: 'ok',
          tokens: { entrada: Number(u.input_tokens ?? 0), salida: Number(u.output_tokens ?? 0), cache: Number(u.cached_input_tokens ?? 0) },
        };
      }
      case 'turn.failed':
      case 'error':
        return { error: ev.error?.message ?? ev.message ?? 'Error de Codex', final: 'error' };
    }
  }
}

/** ¿Sigue vivo el proceso? */
function vivo(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function recortar(s: string, n: number) {
  s = String(s ?? '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function nombreCorto(ruta: string) {
  return String(ruta ?? '').split(/[\\/]/).slice(-2).join('/');
}

function describirHerramienta(nombre: string, input: any): string {
  switch (nombre) {
    case 'Read':
      return `Leyendo ${nombreCorto(input.file_path)}`;
    case 'Write':
      return `Escribiendo ${nombreCorto(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editando ${nombreCorto(input.file_path)}`;
    case 'Glob':
    case 'Grep':
      return `Buscando archivos: ${recortar(input.pattern, 60)}`;
    case 'WebSearch':
      return `Buscando en la web: ${recortar(input.query, 100)}`;
    case 'WebFetch':
      return `Consultando ${recortar(input.url, 100)}`;
    case 'TodoWrite':
      return 'Planificando tareas';
    default:
      return `Usando ${nombre}`;
  }
}
