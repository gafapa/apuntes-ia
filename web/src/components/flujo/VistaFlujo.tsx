import type { EstadoFlujo, Trabajo } from '../../../../shared/tipos';
import { PasoIndice, PasoInvestigacion } from './PasosPreparacion';
import { PasoRedaccion, PasoRevision } from './PasosEscritura';
import { PasoAutoevaluacion, PasoExportar, PasoVisuales } from './PasosFinales';

/** Las fases del documento, de la investigación a la exportación. */
export function VistaFlujo({
  a,
  d,
  estado,
  trabajos,
  recargar,
}: {
  a: string;
  d: string;
  estado?: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
}) {
  if (!estado) return null;
  const props = { a, d, estado, trabajos, recargar };
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative mx-auto max-w-3xl px-8 py-8">
        {/* Línea que une los pasos */}
        <div className="absolute top-12 bottom-12 left-12 w-0.5 bg-borde" aria-hidden />
        <div className="space-y-4">
          <PasoInvestigacion {...props} />
          <PasoIndice {...props} />
          <PasoRedaccion {...props} />
          <PasoRevision {...props} />
          <PasoVisuales {...props} />
          <PasoAutoevaluacion {...props} />
          <PasoExportar {...props} />
        </div>
        <p className="mt-6 pl-12 text-[12.5px] text-texto-3">
          Puedes saltarte las fases opcionales, repetir cualquiera y editar los apuntes a mano en cualquier momento. Para todo lo demás, pídeselo al
          orquestador en el panel de la derecha.
        </p>
      </div>
    </div>
  );
}
