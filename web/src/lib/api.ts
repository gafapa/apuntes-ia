import type {
  HerramientasChat,
  MezclaVisuales,
  BusquedaImagenes,
  ResultadoImagen,
  ImagenFallida,
  Ajustes,
  ContadorTokens,
  EstadoFlujo,
  Exportado,
  Indice,
  InfoAgente,
  OpcionesExportacion,
  PropuestaVisual,
  Recurso,
  ResultadoBusqueda,
  TipoBusqueda,
  TipoRevision,
  Asignatura,
  AsignaturaDetalle,
  Documento,
  EstadoMotor,
  Fuente,
  Motor,
  Seccion,
  Trabajo,
  UsoSuscripcion,
} from '../../../shared/tipos';

async function pedir<T>(metodo: string, url: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((datos as { error?: string }).error ?? `Error ${r.status}`), { status: r.status });
  return datos as T;
}

const e = encodeURIComponent;
const asig = (a: string) => `/api/asignaturas/${e(a)}`;
const doc = (a: string, d: string) => `${asig(a)}/documentos/${e(d)}`;

/** Molécula de un bloque ```molecula (estructura tomada de PubChem). */
export interface Molecula {
  consulta: string;
  smiles: string;
  nombre?: string;
  iupac?: string;
  formula?: string;
  cid?: number;
  verificada: boolean;
}

export type AsignaturaResumen = Asignatura & { documentos: Documento[] };

export const api = {
  ajustes: () => pedir<Ajustes>('GET', '/api/ajustes'),
  guardarAjustes: (a: Partial<Ajustes>) => pedir<Ajustes>('PUT', '/api/ajustes', a),
  motores: () => pedir<EstadoMotor[]>('GET', '/api/motores'),
  accionMotor: (m: Motor, accion: 'instalar' | 'sesion') => pedir('POST', `/api/motores/${m}/${accion}`),
  comandosMotor: (m: Motor) => pedir<{ instalar: string; sesion: string }>('GET', `/api/motores/${m}/comandos`),
  abrirCarpeta: (asignatura?: string, documento?: string, sub?: string) =>
    pedir('POST', '/api/abrir-carpeta', { asignatura, documento, sub }),
  uso: () => pedir<UsoSuscripcion>('GET', '/api/uso'),
  tokens: () => pedir<ContadorTokens>('GET', '/api/tokens'),
  molecula: (q: string) => pedir<Molecula>('GET', `/api/molecula?q=${e(q)}`),
  buscarImagenes: (q: string, local?: string) =>
    pedir<BusquedaImagenes>('GET', `/api/imagenes-web?q=${e(q)}${local ? `&local=${e(local)}` : ''}`),
  guardarImagenWeb: (a: string, d: string, resultado: ResultadoImagen, seccion?: string) =>
    pedir<{ archivo: string; markdown: string }>('POST', `${doc(a, d)}/imagenes-web`, { resultado, seccion }),
  reiniciarTokens: () => pedir<ContadorTokens>('DELETE', '/api/tokens'),

  asignaturas: () => pedir<AsignaturaResumen[]>('GET', '/api/asignaturas'),
  asignatura: (a: string) => pedir<AsignaturaDetalle>('GET', asig(a)),
  crearAsignatura: (datos: Partial<AsignaturaDetalle>) => pedir<AsignaturaDetalle>('POST', '/api/asignaturas', datos),
  guardarAsignatura: (a: string, datos: Partial<AsignaturaDetalle>) => pedir<AsignaturaDetalle>('PUT', asig(a), datos),
  eliminarAsignatura: (a: string) => pedir('DELETE', asig(a)),

  documento: (a: string, d: string) => pedir<Documento>('GET', doc(a, d)),
  crearDocumento: (a: string, datos: Partial<Documento>) => pedir<Documento>('POST', `${asig(a)}/documentos`, datos),
  guardarDocumento: (a: string, d: string, datos: Partial<Documento>) => pedir<Documento>('PUT', doc(a, d), datos),
  eliminarDocumento: (a: string, d: string) => pedir('DELETE', doc(a, d)),

  secciones: (a: string, d: string) => pedir<Seccion[]>('GET', `${doc(a, d)}/secciones`),
  crearSeccion: (a: string, d: string, titulo: string) => pedir<Seccion>('POST', `${doc(a, d)}/secciones`, { titulo }),
  ordenarSecciones: (a: string, d: string, orden: string[]) => pedir<Seccion[]>('PUT', `${doc(a, d)}/secciones/orden`, { orden }),
  leerSeccion: (a: string, d: string, s: string) => pedir<{ contenido: string }>('GET', `${doc(a, d)}/secciones/${e(s)}`),
  guardarSeccion: (a: string, d: string, s: string, contenido: string) =>
    pedir('PUT', `${doc(a, d)}/secciones/${e(s)}`, { contenido }),
  eliminarSeccion: (a: string, d: string, s: string) => pedir('DELETE', `${doc(a, d)}/secciones/${e(s)}`),

  fuentes: (a: string, d?: string) => pedir<Fuente[]>('GET', `${d ? doc(a, d) : asig(a)}/fuentes`),
  subirFuentes: async (a: string, archivos: File[], d?: string) => {
    const fd = new FormData();
    for (const f of archivos) fd.append('archivo', f, f.name);
    const r = await fetch(`${d ? doc(a, d) : asig(a)}/fuentes`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Error al subir');
    return (await r.json()) as { guardados: string[] };
  },
  eliminarFuente: (a: string, nombre: string, d?: string) => pedir('DELETE', `${d ? doc(a, d) : asig(a)}/fuentes/${e(nombre)}`),

  agentes: () => pedir<InfoAgente[]>('GET', '/api/agentes'),
  version: () =>
    pedir<{ version: string; actualizacion?: { estado: 'disponible' | 'descargada'; version: string } }>('GET', '/api/version'),
  instalarActualizacion: () => pedir('POST', '/api/actualizacion/instalar'),

  // Flujo del documento
  flujo: (a: string, d: string) => pedir<EstadoFlujo>('GET', `${doc(a, d)}/flujo`),
  investigar: (a: string, d: string, indicaciones?: string, soloPreguntas = false) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/investigar`, { indicaciones, soloPreguntas }),
  anadirPregunta: (a: string, d: string, texto: string) => pedir('POST', `${doc(a, d)}/flujo/preguntas`, { texto }),
  eliminarPregunta: (a: string, d: string, id: string) => pedir('DELETE', `${doc(a, d)}/flujo/preguntas/${e(id)}`),
  proponerIndice: (a: string, d: string, indicaciones?: string, profundidad?: number, soloApartados = false) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/indice`, { indicaciones, profundidad, soloApartados }),
  guardarIndice: (a: string, d: string, indice: Indice) => pedir<Indice>('PUT', `${doc(a, d)}/flujo/indice`, indice),
  aprobarIndice: (a: string, d: string) => pedir<Indice>('POST', `${doc(a, d)}/flujo/indice/aprobar`),
  redactar: (a: string, d: string, archivos: string[], indicaciones?: string) =>
    pedir<Trabajo[]>('POST', `${doc(a, d)}/flujo/redactar`, { archivos, indicaciones }),
  revisar: (a: string, d: string, tipos: TipoRevision[], archivos?: string[], indicaciones?: string) =>
    pedir<Trabajo[]>('POST', `${doc(a, d)}/flujo/revisar`, { tipos, archivos, indicaciones }),
  decidirSugerencias: (a: string, d: string, ids: string[], decision: 'aceptar' | 'rechazar', propuesta?: string) =>
    pedir<{ aplicadas: number; fallidas: number }>('POST', `${doc(a, d)}/flujo/sugerencias/${decision}`, { ids, propuesta }),
  limpiarSugerencias: (a: string, d: string) => pedir('DELETE', `${doc(a, d)}/flujo/sugerencias`),
  proponerVisuales: (a: string, d: string, archivos?: string[], indicaciones?: string, mezcla?: MezclaVisuales) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/visuales`, { archivos, indicaciones, mezcla }),
  editarPropuesta: (a: string, d: string, id: string, cambios: Partial<PropuestaVisual>) =>
    pedir<PropuestaVisual>('PUT', `${doc(a, d)}/flujo/visuales/${e(id)}`, cambios),
  generarVisual: (a: string, d: string, id: string, indicaciones?: string) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/visuales/${e(id)}/generar`, { indicaciones }),
  limpiarVisuales: (a: string, d: string) => pedir('DELETE', `${doc(a, d)}/flujo/visuales`),
  autoevaluacion: (a: string, d: string, indicaciones?: string) => pedir<Trabajo>('POST', `${doc(a, d)}/flujo/autoevaluacion`, { indicaciones }),
  leerArchivo: (a: string, d: string, nombre: string) => pedir<{ contenido: string }>('GET', `${doc(a, d)}/archivo/${e(nombre)}`),
  guardarArchivo: (a: string, d: string, nombre: string, contenido: string) => pedir('PUT', `${doc(a, d)}/archivo/${e(nombre)}`, { contenido }),

  recursos: (a: string, d: string) => pedir<Recurso[]>('GET', `${doc(a, d)}/recursos`),
  eliminarRecurso: (a: string, d: string, nombre: string) => pedir('DELETE', `${doc(a, d)}/recursos/${e(nombre)}`),

  exportar: (a: string, d: string, opciones: OpcionesExportacion, diagramas: Record<string, string>) =>
    pedir<Exportado>('POST', `${doc(a, d)}/exportar`, { opciones, diagramas }),
  abrirExportado: (a: string, d: string, nombre: string) => pedir('POST', `${doc(a, d)}/exportados/${e(nombre)}/abrir`),

  glosario: (a: string) => pedir<{ contenido: string }>('GET', `${asig(a)}/glosario`),
  guardarGlosario: (a: string, contenido: string) => pedir('PUT', `${asig(a)}/glosario`, { contenido }),
  actualizarGlosario: (a: string, indicaciones?: string) => pedir<Trabajo>('POST', `${asig(a)}/glosario/actualizar`, { indicaciones }),
  plantillas: (a: string) => pedir<{ docx: boolean; odt: boolean }>('GET', `${asig(a)}/plantillas`),
  subirPlantilla: async (a: string, archivo: File) => {
    const fd = new FormData();
    fd.append('plantilla', archivo, archivo.name);
    const r = await fetch(`${asig(a)}/plantillas`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Error al subir');
    return (await r.json()) as { docx: boolean; odt: boolean };
  },
  /** Descarga el documento de base para crear una plantilla (se guarda donde elija el usuario). */
  descargarPlantillaBase: async (a: string, formato: 'docx' | 'odt') => {
    const r = await fetch(`${asig(a)}/plantillas/base/${formato}`);
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'No se pudo generar la plantilla');
    const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `plantilla-base.${formato}`;
    const url = URL.createObjectURL(await r.blob());
    const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  eliminarPlantilla: (a: string, formato: 'docx' | 'odt') => pedir<{ docx: boolean; odt: boolean }>('DELETE', `${asig(a)}/plantillas/${formato}`),

  busqueda: (a: string, d?: string) => pedir<ResultadoBusqueda[]>('GET', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`),
  buscarFuentes: (a: string, consulta: string, tipo: TipoBusqueda, d?: string) =>
    pedir<Trabajo>('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`, { consulta, tipo }),
  anadirFuente: (a: string, id: string, d?: string) => pedir<ResultadoBusqueda>('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes/${e(id)}/anadir`),
  descartarResultado: (a: string, id: string, d?: string) => pedir('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes/${e(id)}/descartar`),
  limpiarBusqueda: (a: string, d?: string) => pedir('DELETE', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`),

  indiceFuentes: (a: string, d?: string) =>
    pedir<{ archivo: string; fragmentos: number; paginas?: number; estado: 'indexado' | 'sin-texto' | 'no-admitido' }[]>('GET', `${d ? doc(a, d) : asig(a)}/fuentes-indice`),
  buscarEnFuentes: (a: string, consulta: string, d?: string) =>
    pedir<{ archivo: string; pagina?: number; titulo?: string; texto: string; carpeta: string; puntuacion: number }[]>(
      'POST',
      `${d ? doc(a, d) : asig(a)}/fuentes-indice/buscar`,
      { consulta },
    ),

  sinPie: (a: string, d: string) => pedir<{ seccion: string; tipo: string; muestra: string }[]>('GET', `${doc(a, d)}/pies`),
  imagenesQueFaltan: (a: string, d: string) => pedir<ImagenFallida[]>('GET', `${doc(a, d)}/imagenes-faltan`),
  repararImagenes: (a: string, d: string) => pedir<{ mensaje: string }>('POST', `${doc(a, d)}/imagenes-faltan`),
  anadirPies: (a: string, d: string) => pedir<Trabajo>('POST', `${doc(a, d)}/pies`),

  trabajos: () => pedir<Trabajo[]>('GET', '/api/trabajos'),
  trabajo: (id: string) => pedir<Trabajo>('GET', `/api/trabajos/${e(id)}`),
  lanzar: (datos: { motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string; herramientas?: HerramientasChat }) =>
    pedir<Trabajo>('POST', '/api/trabajos', datos),
  responder: (id: string, texto: string) => pedir<Trabajo>('POST', `/api/trabajos/${e(id)}/responder`, { texto }),
  cancelar: (id: string) => pedir('POST', `/api/trabajos/${e(id)}/cancelar`),
  limpiarTrabajos: () => pedir<Trabajo[]>('POST', '/api/trabajos/limpiar'),
};

/** URL pública de un archivo dentro de la carpeta de datos. */
export function urlDatos(...partes: string[]) {
  return '/datos/' + partes.map(e).join('/');
}
