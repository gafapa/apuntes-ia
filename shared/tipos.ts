// Tipos compartidos entre el servidor y la interfaz.

export type Motor = 'claude' | 'codex';

export interface Asignatura {
  id: string; // nombre de la carpeta
  nombre: string;
  nivel: string; // p. ej. "2º Bachillerato"
  destinatarios: string; // a quién van dirigidos los apuntes
  idioma: string;
  estilo: string; // tono y forma de escribir
  color: string;
  creado: string;
  actualizado: string;
}

export interface AsignaturaDetalle extends Asignatura {
  contexto: string; // contexto.md
  documentos: Documento[];
}

export interface Documento {
  id: string;
  asignatura: string;
  titulo: string;
  objetivo: string;
  destinatarios: string; // vacío = hereda de la asignatura
  extension: string; // p. ej. "10-15 páginas"
  creado: string;
  actualizado: string;
}

export interface Seccion {
  archivo: string; // 01-introduccion.md
  titulo: string;
  palabras: number;
}

export interface Fuente {
  nombre: string;
  tamano: number;
  modificado: string;
}

export type EstadoTrabajo = 'en-cola' | 'ejecutando' | 'ok' | 'error' | 'cancelado';

export interface EventoTrabajo {
  t: number; // marca de tiempo (ms)
  tipo: 'texto' | 'herramienta' | 'estado' | 'error' | 'usuario';
  texto: string;
}

export interface Trabajo {
  id: string;
  agente: string; // id del agente
  nombreAgente: string;
  motor: Motor;
  titulo: string; // resumen corto de la tarea
  asignatura: string;
  documento?: string;
  estado: EstadoTrabajo;
  creado: number;
  inicio?: number;
  fin?: number;
  resultado?: string;
  sesion?: string; // id de la sesión del motor, para poder continuar la conversación
  eventos: EventoTrabajo[];
}

export interface EstadoMotor {
  motor: Motor;
  instalado: boolean;
  ruta?: string;
  version?: string;
  sesion: boolean; // sesión iniciada
  detalle?: string;
}

export interface UsoSuscripcion {
  // Fracción de uso (0-1) de las ventanas de límite de Claude, si se conocen
  cincoHoras?: number;
  semanal?: number;
  reinicio?: number; // epoch (s) del reinicio de la ventana de 5 h
  actualizado: number;
}

export interface Ajustes {
  carpetaDatos: string;
  maxSimultaneos: number;
  motorPorDefecto: Motor;
  asistenteCompletado: boolean;
}

export type MensajeWS =
  | { tipo: 'trabajo'; trabajo: Trabajo }
  | { tipo: 'evento'; id: string; evento: EventoTrabajo }
  | { tipo: 'uso'; uso: UsoSuscripcion }
  | { tipo: 'archivos'; asignatura: string; documento?: string; ruta: string };
