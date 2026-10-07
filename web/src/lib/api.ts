import type {
  Ajustes,
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
  if (!r.ok) throw new Error((datos as { error?: string }).error ?? `Error ${r.status}`);
  return datos as T;
}

const e = encodeURIComponent;
const asig = (a: string) => `/api/asignaturas/${e(a)}`;
const doc = (a: string, d: string) => `${asig(a)}/documentos/${e(d)}`;

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

  trabajos: () => pedir<Trabajo[]>('GET', '/api/trabajos'),
  trabajo: (id: string) => pedir<Trabajo>('GET', `/api/trabajos/${e(id)}`),
  lanzar: (datos: { agente?: string; motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string }) =>
    pedir<Trabajo>('POST', '/api/trabajos', datos),
  responder: (id: string, texto: string) => pedir<Trabajo>('POST', `/api/trabajos/${e(id)}/responder`, { texto }),
  cancelar: (id: string) => pedir('POST', `/api/trabajos/${e(id)}/cancelar`),
  limpiarTrabajos: () => pedir<Trabajo[]>('POST', '/api/trabajos/limpiar'),
};

/** URL pública de un archivo dentro de la carpeta de datos. */
export function urlDatos(...partes: string[]) {
  return '/datos/' + partes.map(e).join('/');
}
