import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { EstadoFlujo, Trabajo } from '../../../../shared/tipos';
import { Boton } from '../ui';
import { PasoIndice, PasoInvestigacion } from './PasosPreparacion';
import { PasoRedaccion, PasoRevision } from './PasosEscritura';
import { PasoExportar, PasoVisuales } from './PasosFinales';
import { PasoActividades } from './Actividades';
import { PasoSolo } from './comun';
import { PASOS, type IdPaso, type IdVista } from './pasos';

const COMPONENTES = {
  investigacion: PasoInvestigacion,
  indice: PasoIndice,
  redaccion: PasoRedaccion,
  revision: PasoRevision,
  visuales: PasoVisuales,
  autoevaluacion: PasoActividades,
  exportar: PasoExportar,
} satisfies Record<IdPaso, unknown>;

/** Detalle de la fase elegida en la barra lateral. */
export function VistaPaso({
  id,
  a,
  d,
  estado,
  trabajos,
  recargar,
  onIr,
}: {
  id: IdPaso;
  a: string;
  d: string;
  estado?: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
  onIr: (v: IdVista) => void;
}) {
  if (!estado) return null;
  const Componente = COMPONENTES[id];
  const i = PASOS.findIndex((p) => p.id === id);
  const anterior = PASOS[i - 1];
  const siguiente = PASOS[i + 1];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PasoSolo.Provider value={true}>
          <Componente a={a} d={d} estado={estado} trabajos={trabajos} recargar={recargar} />
        </PasoSolo.Provider>
        <div className="mt-6 flex items-center justify-between">
          {anterior ? (
            <Boton variante="fantasma" icono={<ArrowLeft className="size-4" />} onClick={() => onIr(anterior.id)}>
              {anterior.titulo}
            </Boton>
          ) : (
            <span />
          )}
          {siguiente ? (
            <Boton onClick={() => onIr(siguiente.id)}>
              Siguiente: {siguiente.titulo}
              <ArrowRight className="size-4" />
            </Boton>
          ) : (
            <Boton onClick={() => onIr('apuntes')}>
              Ver los apuntes
              <ArrowRight className="size-4" />
            </Boton>
          )}
        </div>
      </div>
    </div>
  );
}
