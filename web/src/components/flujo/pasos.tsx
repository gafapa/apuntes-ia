// Definición de las fases del flujo y cálculo de su estado, compartido por la barra
// lateral (navegación) y la vista central (detalle de la fase elegida).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { BookOpenText, ClipboardCheck, Download, FileSearch, Files, FolderInput, Image, ImagePlus, ListTree, PenLine, SearchCheck, SlidersHorizontal } from 'lucide-react';
import type { EstadoFlujo, PasoFlujo, Trabajo } from '../../../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../../../shared/tipos';
import { activo, useFlujo } from './comun';
import { useEstado } from '../../lib/estado';

export type IdPaso = 'investigacion' | 'indice' | 'redaccion' | 'revision' | 'visuales' | 'autoevaluacion' | 'exportar';
export type IdVista = IdPaso | 'apuntes' | 'recursos' | 'material' | 'ficha';

export const PASOS: { id: IdPaso; titulo: string; icono: typeof FileSearch; opcional?: boolean }[] = [
  { id: 'investigacion', titulo: 'Investigación', icono: FileSearch, opcional: true },
  { id: 'indice', titulo: 'Índice director', icono: ListTree },
  { id: 'redaccion', titulo: 'Redacción', icono: PenLine },
  { id: 'revision', titulo: 'Revisión', icono: SearchCheck, opcional: true },
  { id: 'visuales', titulo: 'Visuales', icono: ImagePlus, opcional: true },
  { id: 'autoevaluacion', titulo: 'Autoevaluación', icono: ClipboardCheck, opcional: true },
  { id: 'exportar', titulo: 'Exportar', icono: Download },
];

export const VISTAS_DOCUMENTO: { id: IdVista; titulo: string; icono: typeof FileSearch }[] = [
  { id: 'apuntes', titulo: 'Apuntes', icono: BookOpenText },
  { id: 'recursos', titulo: 'Imágenes', icono: Image },
  { id: 'material', titulo: 'Fuentes', icono: FolderInput },
  { id: 'ficha', titulo: 'Ficha', icono: SlidersHorizontal },
];

export const ICONO_DOCUMENTO = Files;

export interface EstadoPaso {
  hecho: boolean;
  trabajando: boolean;
  aviso?: string; // texto corto: «5 pendientes», «3/4 secciones»…
}

const MIN_PALABRAS = 40;

export function estadoPaso(id: IdPaso, e: EstadoFlujo | undefined, trabajos: Trabajo[]): EstadoPaso {
  const enCurso = (paso: PasoFlujo) => trabajos.some((t) => t.paso === paso && activo(t));
  if (!e) return { hecho: false, trabajando: false };
  const secciones = e.secciones.filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo));
  switch (id) {
    case 'investigacion': {
      const pendientes = e.preguntas.filter((p) => p.estado === 'pendiente').length;
      return {
        hecho: !!e.investigacion && pendientes === 0,
        trabajando: enCurso('investigacion'),
        aviso: pendientes ? `${pendientes} ${pendientes === 1 ? 'pregunta' : 'preguntas'}` : undefined,
      };
    }
    case 'indice':
      return {
        hecho: !!e.indice?.aprobado,
        trabajando: enCurso('indice'),
        aviso: e.indice && !e.indice.aprobado ? 'por aprobar' : undefined,
      };
    case 'redaccion': {
      const hechas = secciones.filter((s) => s.palabras >= MIN_PALABRAS).length;
      return {
        hecho: secciones.length > 0 && hechas === secciones.length,
        trabajando: enCurso('redaccion'),
        aviso: secciones.length ? `${hechas}/${secciones.length}` : undefined,
      };
    }
    case 'revision': {
      const pendientes = e.sugerencias.filter((s) => s.estado === 'pendiente').length;
      return {
        hecho: e.sugerencias.length > 0 && pendientes === 0 && !enCurso('revision'),
        trabajando: enCurso('revision') || enCurso('diagnostico'),
        aviso: pendientes ? `${pendientes} pendientes` : undefined,
      };
    }
    case 'visuales': {
      const propuestas = e.visuales.filter((v) => v.estado === 'propuesta' || v.estado === 'error' || v.estado === 'generada').length;
      return {
        hecho: e.visuales.some((v) => v.estado === 'insertada') && propuestas === 0,
        trabajando: enCurso('visuales'),
        aviso: propuestas ? `${propuestas} propuestas` : undefined,
      };
    }
    case 'autoevaluacion': {
      const bloques = e.actividades ?? [];
      const incluidos = bloques.filter((b) => b.incluir && b.estado === 'lista').length;
      return {
        hecho: incluidos > 0,
        trabajando: enCurso('autoevaluacion'),
        aviso: bloques.length ? `${incluidos} de ${bloques.length} bloques` : undefined,
      };
    }
    case 'exportar':
      return { hecho: e.exportados.length > 0, trabajando: false };
  }
}

/** Primera fase obligatoria o con trabajo pendiente; si todo está hecho, los apuntes. */
export function vistaInicial(e: EstadoFlujo | undefined, trabajos: Trabajo[]): IdVista {
  if (!e) return 'investigacion';
  if (e.imported) {
    return PASOS.find(step => estadoPaso(step.id, e, trabajos).trabajando)?.id ?? 'apuntes';
  }
  if (!e.secciones.length && !e.investigacion && !e.indice) return 'investigacion';
  // Apuntes importados: lo primero es su diagnóstico (en la fase de revisión)
  if ((e.diagnostico || trabajos.some((t) => t.paso === 'diagnostico' && activo(t))) && !estadoPaso('revision', e, trabajos).hecho) {
    if (!trabajos.some((t) => (t.paso === 'indice' || t.paso === 'redaccion' || t.paso === 'importacion') && activo(t))) return 'revision';
  }
  for (const p of PASOS) {
    const s = estadoPaso(p.id, e, trabajos);
    if (s.trabajando || s.aviso === 'por aprobar') return p.id;
    if (!s.hecho && !p.opcional) return p.id;
  }
  return 'apuntes';
}

// ---------------------------------------------------------------------------
// Estado del flujo del documento abierto, compartido entre la barra y la vista

type ValorFlujo = ReturnType<typeof useFlujo> & { a: string; d: string };
const Contexto = createContext<ValorFlujo | null>(null);
/** Solo si hay un documento abierto: no cambia con cada mensaje de sus agentes, como el estado del flujo. */
const HayFlujo = createContext(false);

export function ProveedorFlujo({ a, d, children }: { a: string; d: string; children: ReactNode }) {
  const { estado, recargar, trabajos } = useFlujo(a, d);
  const valor = useMemo(() => ({ estado, recargar, trabajos, a, d }), [estado, recargar, trabajos, a, d]);
  return (
    <HayFlujo.Provider value={true}>
      <Contexto.Provider value={valor}>{children}</Contexto.Provider>
    </HayFlujo.Provider>
  );
}

export const useFlujoActual = () => useContext(Contexto);
export const useHayFlujo = () => useContext(HayFlujo);

/** Vista abierta en el documento actual: la elegida por el usuario o, si no, la fase que toca. */
export function useVistaDocumento(): [IdVista, (v: IdVista) => void] {
  const f = useFlujoActual();
  const clave = f ? `${f.a}/${f.d}` : '';
  const elegida = useEstado((s) => s.vistas[clave]);
  const elegirVista = useEstado((s) => s.elegirVista);
  let guardada: string | null = null;
  try {
    guardada = localStorage.getItem(`vista:${clave}`);
  } catch {}
  const vista = (elegida ?? guardada ?? vistaInicial(f?.estado, f?.trabajos ?? [])) as IdVista;
  return [vista, (v) => elegirVista(clave, v)];
}
