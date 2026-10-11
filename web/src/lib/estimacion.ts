// Estimación de tokens (entrada + salida) de una tarea antes de lanzarla, a partir de lo que ha
// gastado de media cada agente hasta ahora. Mientras un agente tiene pocas llamadas, la media se
// mezcla con un valor de referencia (medido con apuntes reales de unas 10 secciones).
import type { ContadorTokens } from '../../../shared/tipos';

const REFERENCIA: Record<string, number> = {
  orquestador: 130_000,
  investigador: 300_000,
  arquitecto: 40_000,
  redactor: 160_000,
  estilo: 270_000,
  calidad: 500_000,
  fuentes: 500_000,
  curriculo: 200_000,
  'director-visual': 80_000,
  ilustrador: 45_000,
  autoevaluacion: 60_000,
  glosario: 300_000,
  diagnostico: 300_000,
  transcriptor: 250_000,
};

/** Llamadas que «pesa» el valor de referencia frente a las reales. */
const PESO_REFERENCIA = 3;

export function mediaAgente(contador: ContadorTokens | undefined, agente: string): number {
  const real = contador?.porAgente?.[agente];
  const ref = REFERENCIA[agente] ?? 150_000;
  if (!real?.llamadas) return ref;
  return (real.entrada + real.salida + ref * PESO_REFERENCIA) / (real.llamadas + PESO_REFERENCIA);
}

/** Tokens previstos para unas tareas: [agente, número de veces]. */
export function estimar(contador: ContadorTokens | undefined, tareas: [string, number][]): number {
  return tareas.reduce((n, [agente, veces]) => n + mediaAgente(contador, agente) * veces, 0);
}
