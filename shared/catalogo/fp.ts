// Catálogo de títulos de Formación Profesional del Ministerio en todofp.es (fp.json, generado con
// scripts/catalogo-fp.mjs). Va aparte de educacion.ts porque pesa mucho: la interfaz lo carga
// solo al abrir el selector de enseñanza.
import fp from './fp.json';
import type { Etapa } from './educacion';

export interface ModuloFP {
  codigo?: string;
  nombre: string;
}

export interface TituloFP {
  nombre: string;
  nivel: 'fp-basica' | 'fp-medio' | 'fp-superior';
  horas?: number;
  url: string;
  modulos: ModuloFP[];
}

export interface FamiliaFP {
  nombre: string;
  titulos: TituloFP[];
}

export const CATALOGO_FP = fp as { fuente: string; generado: string; familias: FamiliaFP[] };

/** Familias profesionales que tienen títulos del nivel indicado. */
export function familiasFP(nivel: Etapa): FamiliaFP[] {
  return CATALOGO_FP.familias
    .map((f) => ({ ...f, titulos: f.titulos.filter((t) => t.nivel === nivel) }))
    .filter((f) => f.titulos.length > 0);
}
