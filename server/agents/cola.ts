// Cola de trabajos de los agentes: ejecuta Claude/Codex con un límite de simultaneidad
// y traduce su salida JSON a eventos legibles para la interfaz.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import type { EventoTrabajo, Motor, Trabajo, UsoSuscripcion } from '../../shared/tipos';
import { lanzar, rutaMotor } from './motores';

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
}

const MAX_EVENTOS = 400;
const MAX_TRABAJOS = 200;

export class Cola extends EventEmitter {
  private trabajos = new Map<string, Trabajo>();
  private peticiones = new Map<string, PeticionTrabajo>();
  private procesos = new Map<string, ChildProcess>();
  private bases = new Map<string, PeticionTrabajo>(); // petición original, para poder responder después
  uso: UsoSuscripcion = { actualizado: 0 };

  constructor(public maxSimultaneos = 3) {
    super();
  }

  listar(): Trabajo[] {
    return [...this.trabajos.values()].sort((a, b) => b.creado - a.creado);
  }

  obtener(id: string) {
    return this.trabajos.get(id);
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
      estado: 'en-cola',
      creado: Date.now(),
      eventos: [],
    };
    this.trabajos.set(t.id, t);
    this.peticiones.set(t.id, p);
    this.bases.set(t.id, p);
    this.podar();
    this.emitir(t);
    this.siguiente();
    return t;
  }

  cancelar(id: string) {
    const t = this.trabajos.get(id);
    if (!t) return;
    if (t.estado === 'en-cola') {
      this.terminar(t, 'cancelado', 'Cancelado antes de empezar');
    } else if (t.estado === 'ejecutando') {
      const proc = this.procesos.get(id);
      t.estado = 'cancelado'; // se marca antes para que el cierre del proceso no lo pise
      if (proc?.pid) treeKill(proc.pid);
      this.terminar(t, 'cancelado', 'Cancelado por el usuario');
    }
  }

  /** Continúa la conversación de un trabajo terminado con una respuesta del usuario. */
  responder(id: string, texto: string) {
    const t = this.trabajos.get(id);
    if (!t) throw new Error('Trabajo no encontrado');
    if (t.estado === 'en-cola' || t.estado === 'ejecutando') throw new Error('El agente todavía está trabajando');
    if (!t.sesion) throw new Error('Este trabajo no se puede continuar');
    const base = this.bases.get(id)!;
    this.peticiones.set(id, { ...base, prompt: texto, reanudar: t.sesion });
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

  /** Elimina de la lista los trabajos terminados. */
  limpiar() {
    for (const [id, t] of this.trabajos) {
      if (t.estado !== 'en-cola' && t.estado !== 'ejecutando') {
        this.trabajos.delete(id);
        this.bases.delete(id);
      }
    }
  }

  private podar() {
    if (this.trabajos.size <= MAX_TRABAJOS) return;
    const terminados = this.listar().filter((t) => t.fin).reverse();
    for (const t of terminados.slice(0, this.trabajos.size - MAX_TRABAJOS)) {
      this.trabajos.delete(t.id);
      this.bases.delete(t.id);
    }
  }

  private emitir(t: Trabajo) {
    this.emit('trabajo', t);
  }

  private evento(t: Trabajo, tipo: EventoTrabajo['tipo'], texto: string) {
    const ev: EventoTrabajo = { t: Date.now(), tipo, texto };
    t.eventos.push(ev);
    if (t.eventos.length > MAX_EVENTOS) t.eventos.splice(0, t.eventos.length - MAX_EVENTOS);
    this.emit('evento', t.id, ev);
  }

  private terminar(t: Trabajo, estado: Trabajo['estado'], texto?: string) {
    if (t.fin) return;
    t.estado = estado;
    t.fin = Date.now();
    if (texto) this.evento(t, estado === 'error' ? 'error' : 'estado', texto);
    this.procesos.delete(t.id);
    this.peticiones.delete(t.id);
    this.emitir(t);
    this.emit('terminado', t);
    this.siguiente();
  }

  private siguiente() {
    const enCurso = [...this.trabajos.values()].filter((t) => t.estado === 'ejecutando').length;
    if (enCurso >= this.maxSimultaneos) return;
    const pendiente = [...this.trabajos.values()]
      .filter((t) => t.estado === 'en-cola')
      .sort((a, b) => a.creado - b.creado)[0];
    if (!pendiente) return;
    this.ejecutar(pendiente);
    this.siguiente();
  }

  private ejecutar(t: Trabajo) {
    const p = this.peticiones.get(t.id)!;
    const ruta = rutaMotor(p.motor);
    t.estado = 'ejecutando';
    t.inicio = Date.now();
    this.emitir(t);
    if (!ruta) {
      this.terminar(t, 'error', `No se encuentra ${p.motor === 'claude' ? 'Claude Code' : 'Codex'} en este equipo`);
      return;
    }

    const args =
      p.motor === 'claude'
        ? [
            '-p',
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', 'acceptEdits',
            '--allowedTools', 'Read,Write,Edit,MultiEdit,Glob,Grep,WebSearch,WebFetch,TodoWrite',
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['--resume', p.reanudar] : []),
          ]
        : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '-s', 'workspace-write',
            '-C', p.cwd,
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['resume', p.reanudar] : []),
            '-',
          ];

    let proc: ChildProcess;
    try {
      proc = lanzar(ruta, args, { cwd: p.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.terminar(t, 'error', `No se pudo iniciar: ${e}`);
      return;
    }
    this.procesos.set(t.id, proc);
    this.evento(t, 'estado', `Iniciando ${p.motor === 'claude' ? 'Claude Code' : 'Codex'}…`);

    proc.stdin?.end(p.prompt, 'utf8');

    let resto = '';
    let stderr = '';
    let ultimoMensaje = '';
    let errorReportado = false;

    const procesarLinea = (linea: string) => {
      if (!linea.trim()) return;
      let ev: any;
      try {
        ev = JSON.parse(linea);
      } catch {
        return;
      }
      const r = p.motor === 'claude' ? this.traducirClaude(t, ev) : this.traducirCodex(t, ev);
      if (r?.mensaje) ultimoMensaje = r.mensaje;
      if (r?.resultado !== undefined) t.resultado = r.resultado;
      if (r?.error) {
        errorReportado = true;
        this.evento(t, 'error', r.error);
      }
    };

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (d: string) => {
      resto += d;
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      lineas.forEach(procesarLinea);
    });
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000);
    });
    proc.on('error', (e) => this.terminar(t, 'error', `Error al ejecutar: ${e.message}`));
    proc.on('close', (codigo) => {
      if (resto) procesarLinea(resto);
      if (t.estado === 'cancelado') return;
      if (t.resultado === undefined && ultimoMensaje) t.resultado = ultimoMensaje;
      if (codigo === 0 && !errorReportado) {
        this.terminar(t, 'ok', 'Terminado');
      } else {
        const detalle = stderr.trim().split(/\r?\n/).filter((l) => !/Reading additional input/i.test(l)).slice(-3).join('\n');
        this.terminar(t, 'error', `Ha terminado con errores${detalle ? `:\n${detalle}` : ` (código ${codigo})`}`);
      }
    });
  }

  private traducirClaude(t: Trabajo, ev: any): { mensaje?: string; resultado?: string; error?: string } | void {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) t.sesion = ev.session_id;
          this.evento(t, 'estado', `Conectado (${ev.model ?? 'Claude'})`);
        }
        return;
      case 'assistant': {
        let mensaje: string | undefined;
        for (const c of ev.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) {
            this.evento(t, 'texto', c.text.trim());
            mensaje = c.text.trim();
          } else if (c.type === 'tool_use') {
            this.evento(t, 'herramienta', describirHerramienta(c.name, c.input ?? {}));
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
        this.emit('uso', this.uso);
        return;
      }
      case 'result':
        if (ev.is_error) return { error: String(ev.result ?? 'Error del agente') };
        return { resultado: typeof ev.result === 'string' ? ev.result : undefined };
    }
  }

  private traducirCodex(t: Trabajo, ev: any): { mensaje?: string; resultado?: string; error?: string } | void {
    const item = ev.item;
    switch (ev.type) {
      case 'thread.started':
        if (ev.thread_id) t.sesion = ev.thread_id;
        this.evento(t, 'estado', 'Conectado (Codex)');
        return;
      case 'item.started':
        if (item?.type === 'command_execution') this.evento(t, 'herramienta', `Ejecutando: ${recortar(item.command, 120)}`);
        else if (item?.type === 'web_search') this.evento(t, 'herramienta', `Buscando en la web: ${item.query ?? ''}`);
        return;
      case 'item.completed':
        if (item?.type === 'agent_message' && item.text?.trim()) {
          this.evento(t, 'texto', item.text.trim());
          return { mensaje: item.text.trim() };
        }
        if (item?.type === 'file_change') {
          const archivos = (item.changes ?? []).map((c: any) => nombreCorto(c.path)).join(', ');
          this.evento(t, 'herramienta', `Modificando: ${archivos || 'archivos'}`);
        } else if (item?.type === 'image_generation' || /image/i.test(item?.type ?? '')) {
          this.evento(t, 'herramienta', 'Imagen generada');
        } else if (item?.type === 'error') {
          return { error: item.message ?? 'Error de Codex' };
        }
        return;
      case 'turn.failed':
      case 'error':
        return { error: ev.error?.message ?? ev.message ?? 'Error de Codex' };
    }
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
    case 'Bash':
      return `Ejecutando: ${recortar(input.command, 100)}`;
    default:
      return `Usando ${nombre}`;
  }
}
