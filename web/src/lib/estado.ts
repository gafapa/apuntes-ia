// Estado global de la interfaz y conexión WebSocket con el servidor.
import { create } from 'zustand';
import type { Ajustes, EstadoMotor, MensajeWS, Trabajo, UsoSuscripcion } from '../../../shared/tipos';
import { api, type AsignaturaResumen } from './api';

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}

interface Seleccion {
  asignatura?: string;
  documento?: string;
}

interface Estado {
  asignaturas: AsignaturaResumen[];
  seleccion: Seleccion;
  trabajos: Record<string, Trabajo>;
  uso?: UsoSuscripcion;
  motores?: EstadoMotor[];
  ajustes?: Ajustes;
  /** Contador por "asignatura/documento" que aumenta cuando cambian sus archivos en disco. */
  versiones: Record<string, number>;
  ultimaRuta?: string;
  avisos: Aviso[];
  conectado: boolean;
  /** Sección abierta en el editor (se envía como contexto a los agentes). */
  seccionActiva?: string;

  cargarAsignaturas(): Promise<void>;
  seleccionar(s: Seleccion): void;
  cargarMotores(): Promise<EstadoMotor[]>;
  cargarAjustes(): Promise<void>;
  avisar(texto: string, tipo?: Aviso['tipo']): void;
  quitarAviso(id: number): void;
}

function leerHash(): Seleccion {
  const [a, d] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { asignatura: a || undefined, documento: d || undefined };
}

let idAviso = 0;

export const useEstado = create<Estado>((set, get) => ({
  asignaturas: [],
  seleccion: leerHash(),
  trabajos: {},
  versiones: {},
  avisos: [],
  conectado: false,

  async cargarAsignaturas() {
    try {
      set({ asignaturas: await api.asignaturas() });
    } catch (e) {
      get().avisar(String((e as Error).message), 'error');
    }
  },

  seleccionar(s) {
    const hash = s.asignatura ? `#/${encodeURIComponent(s.asignatura)}${s.documento ? '/' + encodeURIComponent(s.documento) : ''}` : '#/';
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ seleccion: s });
  },

  async cargarMotores() {
    const motores = await api.motores();
    set({ motores });
    return motores;
  },

  async cargarAjustes() {
    set({ ajustes: await api.ajustes() });
  },

  avisar(texto, tipo = 'info') {
    const id = ++idAviso;
    set({ avisos: [...get().avisos, { id, texto, tipo }] });
    setTimeout(() => get().quitarAviso(id), tipo === 'error' ? 7000 : 3500);
  },

  quitarAviso(id) {
    set({ avisos: get().avisos.filter((a) => a.id !== id) });
  },
}));

window.addEventListener('popstate', () => useEstado.setState({ seleccion: leerHash() }));

// ---------- WebSocket ----------

let recargaAsignaturas: ReturnType<typeof setTimeout> | undefined;

function conectar() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = async () => {
    useEstado.setState({ conectado: true });
    // Al (re)conectar se recupera todo: el servidor puede haberse reiniciado
    const e = useEstado.getState();
    e.cargarAsignaturas();
    e.cargarAjustes().catch(() => {});
    e.cargarMotores().catch(() => {});
    const lista = await api.trabajos().catch(() => [] as Trabajo[]);
    useEstado.setState({ trabajos: Object.fromEntries(lista.map((t) => [t.id, t])) });
  };
  ws.onclose = () => {
    useEstado.setState({ conectado: false });
    setTimeout(conectar, 1500);
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data) as MensajeWS;
    const { trabajos, versiones } = useEstado.getState();
    switch (msg.tipo) {
      case 'trabajo': {
        const previo = trabajos[msg.trabajo.id];
        const t = { ...msg.trabajo, eventos: previo?.eventos ?? [] };
        useEstado.setState({ trabajos: { ...trabajos, [t.id]: t } });
        if (previo && previo.estado === 'ejecutando' && t.estado === 'ok') {
          useEstado.getState().avisar(`${t.nombreAgente} ha terminado: ${t.titulo}`, 'ok');
        } else if (previo && t.estado === 'error' && previo.estado !== 'error') {
          useEstado.getState().avisar(`${t.nombreAgente} ha fallado: ${t.titulo}`, 'error');
        }
        break;
      }
      case 'evento': {
        const t = trabajos[msg.id];
        if (!t) break;
        useEstado.setState({ trabajos: { ...trabajos, [t.id]: { ...t, eventos: [...t.eventos, msg.evento] } } });
        break;
      }
      case 'uso':
        useEstado.setState({ uso: msg.uso });
        break;
      case 'archivos': {
        const clave = `${msg.asignatura}/${msg.documento ?? ''}`;
        useEstado.setState({ versiones: { ...versiones, [clave]: (versiones[clave] ?? 0) + 1 }, ultimaRuta: msg.ruta });
        clearTimeout(recargaAsignaturas);
        recargaAsignaturas = setTimeout(() => useEstado.getState().cargarAsignaturas(), 600);
        break;
      }
    }
  };
}

conectar();
