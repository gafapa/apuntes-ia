import { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Stethoscope } from 'lucide-react';
import type { AccionDiagnostico, AreaDiagnostico, EstadoFlujo, ModoMejora, ProblemaDiagnostico, Trabajo } from '../../../../shared/tipos';
import { api } from '../../lib/api';
import { useEstado } from '../../lib/estado';
import { Boton, Insignia, confirmar, cx } from '../ui';
import { ActividadAgente, BotonAgente, fechaCorta, trabajosDe } from './comun';
import { useVistaDocumento } from './pasos';

const AREAS: Record<AreaDiagnostico, string> = {
  contenido: 'Contenido',
  actualidad: 'Actualidad',
  estructura: 'Estructura',
  estilo: 'Estilo',
  curriculo: 'Currículo',
  visuales: 'Visuales',
  actividades: 'Actividades',
  formato: 'Formato',
};

const MODOS: Record<ModoMejora, string> = {
  conservador: 'mejorar sobre el texto actual',
  reestructurar: 'reorganizar los apuntes',
  reescribir: 'rehacer los apuntes',
};

/**
 * Diagnóstico general de unos apuntes (importados o no): qué conservar, qué falta y qué corregir,
 * con un acceso directo a la fase que resuelve cada cosa.
 */
export function PanelDiagnostico({ a, d, estado, trabajos, conImportacion }: { a: string; d: string; estado: EstadoFlujo; trabajos: Trabajo[]; conImportacion: boolean }) {
  const { avisar } = useEstado();
  const [, elegirVista] = useVistaDocumento();
  const activos = trabajosDe(trabajos, 'diagnostico');
  const diag = estado.diagnostico;
  const [abierto, setAbierto] = useState(true);
  const [verFuertes, setVerFuertes] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const titulos = useMemo(() => new Map(estado.secciones.map((s) => [s.archivo, s.titulo])), [estado.secciones]);
  const orden = { alta: 0, media: 1, baja: 2 };
  const problemas = useMemo(() => [...(diag?.problemas ?? [])].sort((x, y) => orden[x.gravedad] - orden[y.gravedad]), [diag]);

  const resolver = async (p: ProblemaDiagnostico) => {
    const accion = p.accion as AccionDiagnostico;
    try {
      if (accion === 'visuales') elegirVista('visuales');
      else if (accion === 'actividades') elegirVista('autoevaluacion');
      else if (accion === 'indice') elegirVista('indice');
      else {
        await api.revisar(a, d, [accion], p.seccion ? [p.seccion] : undefined, `Céntrate en esto, señalado por el diagnóstico: ${p.descripcion}`);
        avisar('Revisión lanzada: las sugerencias aparecerán aquí debajo', 'ok');
      }
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  const cambiarModo = async (modo: ModoMejora) => {
    const ok = await confirmar(`¿${modo === 'reestructurar' ? 'Reorganizar' : 'Rehacer'} los apuntes?`, {
      texto:
        'El texto actual pasa a ser la fuente principal y el arquitecto propone un índice nuevo. Las secciones actuales no se borran: cuando apruebes el índice, los redactores escriben las nuevas a partir de ellas.',
      boton: modo === 'reestructurar' ? 'Reorganizar' : 'Rehacer',
    });
    if (!ok) return;
    try {
      await api.cambiarModo(a, d, modo);
      elegirVista('indice');
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  if (!diag && !activos.length) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-borde bg-fondo/40 px-4 py-3">
        <Stethoscope className="size-5 shrink-0 text-acento" />
        <div className="min-w-60 flex-1">
          <div className="text-[13.5px] font-medium">Diagnóstico general</div>
          <div className="text-[12.5px] text-texto-2">
            {conImportacion
              ? 'Un agente lee tus apuntes enteros y te dice qué conservar, qué falta, qué está desactualizado y por dónde empezar.'
              : 'Un agente lee el documento entero y te dice qué conservar, qué falta y qué corregir, antes de revisar en detalle.'}
          </div>
        </div>
        <BotonAgente
          texto="Diagnosticar"
          variante="secundario"
          icono={<Stethoscope className="size-4" />}
          disabled={!estado.secciones.length}
          onLanzar={(ind) => api.diagnosticar(a, d, ind)}
          estimacion={[['diagnostico', 1]]}
          ayudaIndicaciones="Por ejemplo: fíjate sobre todo en si está al día con la normativa actual…"
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-borde bg-fondo/40">
      <div className="flex items-center gap-2 px-4 py-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer" onClick={() => setAbierto(!abierto)}>
          <Stethoscope className="size-4 shrink-0 text-acento" />
          <span className="text-[13.5px] font-medium">Diagnóstico</span>
          {diag && (
            <span className="text-[12px] text-texto-3">
              {problemas.length} aspectos · {fechaCorta(diag.actualizado)}
            </span>
          )}
          <ChevronDown className={cx('size-4 text-texto-3 transition-transform', abierto && 'rotate-180')} />
        </button>
        {diag && !activos.length && (
          <BotonAgente texto="Repetir" variante="secundario" onLanzar={(ind) => api.diagnosticar(a, d, ind)} ayudaIndicaciones="Qué mirar esta vez (opcional)" />
        )}
      </div>
      {abierto && (
        <div className="space-y-3 border-t border-borde px-4 py-3">
          {activos.map((t) => (
            <ActividadAgente key={t.id} t={t} />
          ))}
          {diag && (
            <>
              <p className="text-[13.5px] leading-relaxed">{diag.resumen}</p>
              {diag.recomendacion !== 'conservador' && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-aviso/10 px-3 py-2.5">
                  <p className="min-w-60 flex-1 text-[13px]">
                    <strong>Recomienda {MODOS[diag.recomendacion]}.</strong> {diag.motivoRecomendacion}
                  </p>
                  <Boton tam="sm" onClick={() => cambiarModo(diag.recomendacion)}>
                    {diag.recomendacion === 'reestructurar' ? 'Reorganizar' : 'Rehacer'}
                  </Boton>
                </div>
              )}
              {diag.puntosFuertes.length > 0 && (
                <div>
                  <button className="flex items-center gap-1 text-[12.5px] font-medium text-ok cursor-pointer" onClick={() => setVerFuertes(!verFuertes)}>
                    {diag.puntosFuertes.length} puntos fuertes que conviene conservar
                    <ChevronDown className={cx('size-3.5 transition-transform', verFuertes && 'rotate-180')} />
                  </button>
                  {verFuertes && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-texto-2">
                      {diag.puntosFuertes.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <ul className="space-y-1.5">
                {(verTodos ? problemas : problemas.slice(0, Math.max(6, problemas.filter((p) => p.gravedad === 'alta').length))).map((p) => (
                  <li key={p.id} className="flex items-start gap-2.5 rounded-md border border-borde bg-panel px-3 py-2">
                    <div className="flex shrink-0 flex-col items-start gap-1 pt-0.5">
                      <Insignia color={p.gravedad === 'alta' ? 'error' : p.gravedad === 'media' ? 'aviso' : 'neutro'}>{AREAS[p.area]}</Insignia>
                    </div>
                    <div className="min-w-0 flex-1 text-[13px]">
                      {p.seccion && (
                        <button
                          onClick={() => useEstado.setState({ irASeccion: p.seccion })}
                          className="mb-0.5 flex items-center gap-1 text-[11.5px] font-semibold tracking-wide text-texto-3 uppercase hover:text-acento cursor-pointer"
                        >
                          {titulos.get(p.seccion) ?? p.seccion}
                          <ExternalLink className="size-3" />
                        </button>
                      )}
                      {p.descripcion}
                    </div>
                    {p.accion && (
                      <Boton tam="sm" variante="fantasma" className="shrink-0" onClick={() => resolver(p)}>
                        {p.accion === 'visuales'
                          ? 'Ir a visuales'
                          : p.accion === 'actividades'
                            ? 'Ir a actividades'
                            : p.accion === 'indice'
                              ? 'Ver índice'
                              : 'Revisar'}
                      </Boton>
                    )}
                  </li>
                ))}
              </ul>
              {!verTodos && problemas.length > Math.max(6, problemas.filter((p) => p.gravedad === 'alta').length) && (
                <button className="text-[12.5px] font-medium text-acento hover:underline cursor-pointer" onClick={() => setVerTodos(true)}>
                  Ver los {problemas.length - Math.max(6, problemas.filter((p) => p.gravedad === 'alta').length)} restantes
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
