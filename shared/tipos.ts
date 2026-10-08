// Tipos compartidos entre el servidor y la interfaz.

export type Motor = 'claude' | 'codex';

export interface Asignatura {
  id: string; // nombre de la carpeta
  nombre: string;
  nivel: string; // descripción legible, p. ej. "2º de Bachillerato · Ciencias y Tecnología"
  // Enseñanza según el catálogo oficial (shared/catalogo/educacion.ts)
  etapa?: string; // primaria | eso | bachillerato | fp-basica | fp-medio | fp-superior | libre
  curso?: string;
  modalidad?: string; // Bachillerato
  familia?: string; // FP: familia profesional
  titulo?: string; // FP: título del ciclo
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

export const ARCHIVO_AUTOEVALUACION = /autoevaluacion\.md$/;

export interface Fuente {
  nombre: string;
  tamano: number;
  modificado: string;
}

/** Tokens consumidos. `entrada` incluye los leídos de caché (`cache`), que cuestan menos. */
export interface Tokens {
  entrada: number;
  salida: number;
  cache: number;
}

export interface ContadorTokens {
  desde: string; // fecha desde la que se cuenta (o desde que se puso a cero)
  total: Record<Motor, Tokens>;
  hoy: { fecha: string; porMotor: Record<Motor, Tokens> };
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
  paso?: PasoFlujo; // fase del flujo a la que pertenece
  seccion?: string; // sección sobre la que trabaja (archivo)
  ref?: string; // elemento relacionado (p. ej. id de una propuesta visual)
  sesion?: string; // id de la sesión del motor, para poder continuar la conversación
  tokens?: Tokens; // consumo acumulado (incluidas las respuestas del usuario)
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
  /** Personalización por agente: motor e instrucciones propias. */
  agentes: Record<string, { motor?: Motor; instrucciones?: string }>;
}

export interface InfoAgente {
  id: string;
  nombre: string;
  descripcion: string;
  motor: Motor; // motor por defecto del agente
  soloMotor?: Motor; // si solo puede funcionar con un motor
  instrucciones: string; // instrucciones por defecto
}

// ---------- Flujo de trabajo de un documento ----------

export type PasoFlujo =
  | 'chat'
  | 'investigacion'
  | 'indice'
  | 'redaccion'
  | 'revision'
  | 'visuales'
  | 'autoevaluacion'
  | 'glosario';

/** Apartado o subapartado de una sección del índice. */
export interface Apartado {
  id: string;
  titulo: string;
  apartados: Apartado[]; // subapartados (solo con profundidad 3)
}

/** Niveles del índice: 1 = solo secciones; 2 = con apartados; 3 = con apartados y subapartados. */
export type Profundidad = 1 | 2 | 3;

export interface EntradaIndice {
  id: string;
  titulo: string;
  objetivo: string;
  contenidos: string[];
  apartados: Apartado[];
  extension: string; // p. ej. "600-800 palabras"
  visuales: string; // ideas de apoyo visual
  archivo?: string; // sección creada a partir de esta entrada
}

export interface Indice {
  profundidad: Profundidad;
  entradas: EntradaIndice[];
  notas: string;
  aprobado: boolean;
  actualizado: string;
}

export type TipoRevision = 'estilo' | 'calidad' | 'fuentes';

export interface Sugerencia {
  id: string;
  tipo: TipoRevision;
  seccion: string;
  original: string; // texto exacto a sustituir
  propuesta: string;
  motivo: string;
  gravedad: 'baja' | 'media' | 'alta';
  estado: 'pendiente' | 'aceptada' | 'rechazada' | 'fallida';
  trabajo: string;
  creado: string;
}

export type TipoVisual = 'diagrama' | 'imagen-ia' | 'imagen-web';

export interface PropuestaVisual {
  id: string;
  seccion: string;
  ancla: string; // párrafo tras el que se inserta
  tipo: TipoVisual;
  titulo: string;
  descripcion: string;
  estado: 'propuesta' | 'generando' | 'insertada' | 'descartada' | 'error';
  archivo?: string; // recurso generado
  credito?: string; // autoría/licencia de imágenes de internet
  error?: string;
  creado: string;
}

export interface Exportado {
  nombre: string;
  formato: string;
  tamano: number;
  modificado: string;
}

export interface Recurso {
  nombre: string;
  tamano: number;
  modificado: string;
  usado: boolean; // aparece en alguna sección
}

/** Pregunta que el usuario quiere que responda la investigación. */
export interface PreguntaInvestigacion {
  id: string;
  texto: string;
  estado: 'pendiente' | 'investigando' | 'respondida';
  creado: string;
  respuesta?: string; // extraída del dossier al consultar el estado
}

export interface EstadoFlujo {
  investigacion?: { palabras: number; actualizado: string };
  preguntas: PreguntaInvestigacion[];
  indice?: Indice;
  secciones: Seccion[];
  sugerencias: Sugerencia[];
  visuales: PropuestaVisual[];
  autoevaluacion?: string; // archivo de la sección de autoevaluación
  exportados: Exportado[];
}

export interface OpcionesExportacion {
  formato: 'docx' | 'odt' | 'pdf';
  portada: boolean;
  indice: boolean;
  numerar: boolean;
  autoevaluacion: boolean;
  saltoSeccion: boolean; // cada sección empieza en página nueva
}

export type MensajeWS =
  | { tipo: 'trabajo'; trabajo: Trabajo }
  | { tipo: 'evento'; id: string; evento: EventoTrabajo }
  | { tipo: 'uso'; uso: UsoSuscripcion }
  | { tipo: 'archivos'; asignatura: string; documento?: string; ruta: string }
  | { tipo: 'actualizacion'; estado: 'disponible' | 'descargada'; version: string }
  | { tipo: 'tokens'; contador: ContadorTokens };
