import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, PenLine, SearchCheck, X } from 'lucide-react';
import type { EstadoFlujo, Sugerencia, TipoRevision, Trabajo } from '../../../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../../../shared/tipos';
import { api } from '../../lib/api';
import { useEstado } from '../../lib/estado';
import { diferencias } from '../../lib/diff';
import { AreaTexto, Boton, Insignia, cx } from '../ui';
import { ActividadAgente, BotonAgente, Paso, trabajosDe } from './comun';

interface Props {
  a: string;
  d: string;
  estado: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
}

const MIN_PALABRAS = 40; // por debajo, la sección se considera vacía

export function irASeccion(archivo: string) {
  useEstado.setState({ irASeccion: archivo });
}

export function PasoRedaccion({ a, d, estado, trabajos }: Props) {
  const secciones = estado.secciones.filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo));
  const activos = trabajosDe(trabajos, 'redaccion');
  const redactando = new Map(activos.map((t) => [t.seccion, t]));
  const vacias = secciones.filter((s) => s.palabras < MIN_PALABRAS).map((s) => s.archivo);
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(vacias));
  // Las secciones vacías que aparecen (p. ej. al aprobar el índice) se marcan solas
  const conocidas = useRef(new Set(secciones.map((s) => s.archivo)));
  const firma = secciones.map((s) => s.archivo).join('|');
  useEffect(() => {
    const nuevas = secciones.filter((s) => !conocidas.current.has(s.archivo) && s.palabras < MIN_PALABRAS).map((s) => s.archivo);
    conocidas.current = new Set(secciones.map((s) => s.archivo));
    if (nuevas.length) setElegidas((e) => new Set([...e, ...nuevas]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);
  // Al terminar de redactar una sección, se desmarca
  const enCurso = useRef(new Set<string>());
  const firmaActivos = activos.map((t) => t.seccion).join('|');
  useEffect(() => {
    const ahora = new Set(activos.map((t) => t.seccion!).filter(Boolean));
    const terminadas = [...enCurso.current].filter((x) => !ahora.has(x));
    enCurso.current = ahora;
    if (terminadas.length) setElegidas((e) => new Set([...e].filter((x) => !terminadas.includes(x))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaActivos]);
  const hechas = secciones.length > 0 && secciones.every((s) => s.palabras >= MIN_PALABRAS);
  const libres = [...elegidas].filter((x) => !redactando.has(x) && secciones.some((s) => s.archivo === x));

  const alternar = (archivo: string) => {
    const n = new Set(elegidas);
    n.has(archivo) ? n.delete(archivo) : n.add(archivo);
    setElegidas(n);
  };

  return (
    <Paso
      numero={3}
      titulo="Redacción"
      hecho={hechas}
      trabajando={activos.length > 0}
      descripcion="Un redactor por sección, trabajando en paralelo. Cada uno sigue su plan del índice y el dossier."
      acciones={
        secciones.length > 0 && (
          <BotonAgente
            texto={libres.length ? `Redactar ${libres.length === 1 ? '1 sección' : `${libres.length} secciones`}` : 'Redactar'}
            variante={hechas ? 'secundario' : 'primario'}
            icono={<PenLine className="size-4" />}
            disabled={!libres.length}
            onLanzar={(ind) => api.redactar(a, d, libres, ind)}
            ayudaIndicaciones="Se aplican a todas las secciones elegidas. Por ejemplo: tono cercano, más ejemplos, incluye una tabla resumen…"
          />
        )
      }
    >
      {secciones.length === 0 ? (
        <p className="text-[13px] text-texto-3">Aprueba el índice o crea secciones en la pestaña Apuntes para poder redactarlas.</p>
      ) : (
        <div className="space-y-1">
          <div className="mb-2 flex gap-3 text-[12px] text-texto-3">
            <button className="hover:text-acento cursor-pointer" onClick={() => setElegidas(new Set(secciones.map((s) => s.archivo)))}>
              Todas
            </button>
            <button className="hover:text-acento cursor-pointer" onClick={() => setElegidas(new Set(vacias))}>
              Solo vacías
            </button>
            <button className="hover:text-acento cursor-pointer" onClick={() => setElegidas(new Set())}>
              Ninguna
            </button>
          </div>
          {secciones.map((s) => {
            const t = redactando.get(s.archivo);
            return (
              <div key={s.archivo} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--acento)]"
                  checked={elegidas.has(s.archivo)}
                  disabled={!!t}
                  onChange={() => alternar(s.archivo)}
                  aria-label={`Elegir ${s.titulo}`}
                />
                <button onClick={() => irASeccion(s.archivo)} className="min-w-0 flex-1 truncate text-left text-sm hover:text-acento cursor-pointer">
                  {s.titulo}
                </button>
                {t ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-acento">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t.estado === 'en-cola' ? 'En cola' : 'Redactando…'}
                  </span>
                ) : s.palabras >= MIN_PALABRAS ? (
                  <Insignia color="ok">{s.palabras.toLocaleString('es')} palabras</Insignia>
                ) : (
                  <Insignia>Vacía</Insignia>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Paso>
  );
}

// ---------------------------------------------------------------------------

const NOMBRES_REVISION: Record<TipoRevision, { nombre: string; ayuda: string }> = {
  estilo: { nombre: 'Estilo', ayuda: 'claridad, tono, ortografía' },
  calidad: { nombre: 'Calidad', ayuda: 'rigor y huecos' },
  fuentes: { nombre: 'Fuentes y datos', ayuda: 'verificación en la web' },
};

export function PasoRevision({ a, d, estado, trabajos, recargar }: Props) {
  const { avisar } = useEstado();
  const activos = trabajosDe(trabajos, 'revision');
  const [tipos, setTipos] = useState<Set<TipoRevision>>(new Set(['estilo', 'calidad']));
  const pendientes = estado.sugerencias.filter((s) => s.estado === 'pendiente');
  const decididas = estado.sugerencias.length - pendientes.length;
  const titulos = useMemo(() => new Map(estado.secciones.map((s) => [s.archivo, s.titulo])), [estado.secciones]);
  const porSeccion = useMemo(() => {
    const m = new Map<string, Sugerencia[]>();
    for (const s of pendientes) m.set(s.seccion, [...(m.get(s.seccion) ?? []), s]);
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [pendientes]);

  const decidir = async (ids: string[], decision: 'aceptar' | 'rechazar', propuesta?: string) => {
    try {
      const r = await api.decidirSugerencias(a, d, ids, decision, propuesta);
      if (decision === 'aceptar' && r.fallidas) {
        avisar(`${r.fallidas} no se ${r.fallidas === 1 ? 'pudo' : 'pudieron'} aplicar: el texto ha cambiado desde la revisión`, 'error');
      }
      recargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  return (
    <Paso
      numero={4}
      titulo="Revisión"
      opcional
      hecho={estado.sugerencias.length > 0 && pendientes.length === 0 && activos.length === 0}
      trabajando={activos.length > 0}
      descripcion="Los revisores no tocan el texto: proponen cambios y tú decides cuáles aceptar."
      acciones={
        <BotonAgente
          texto="Revisar"
          icono={<SearchCheck className="size-4" />}
          disabled={!tipos.size || !estado.secciones.length}
          onLanzar={(ind) => api.revisar(a, d, [...tipos], undefined, ind)}
          ayudaIndicaciones="Por ejemplo: sé muy exigente con la ortografía, revisa sobre todo la sección 3…"
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(NOMBRES_REVISION) as TipoRevision[]).map((t) => {
            const enCurso = activos.some((x) => x.ref === t);
            return (
              <label
                key={t}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                  tipos.has(t) ? 'border-acento/50 bg-acento-suave' : 'border-borde hover:bg-panel-2',
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--acento)]"
                  checked={tipos.has(t)}
                  onChange={() => {
                    const n = new Set(tipos);
                    n.has(t) ? n.delete(t) : n.add(t);
                    setTipos(n);
                  }}
                />
                <span className="font-medium">{NOMBRES_REVISION[t].nombre}</span>
                <span className="text-texto-3">{NOMBRES_REVISION[t].ayuda}</span>
                {enCurso && <Loader2 className="size-3.5 animate-spin text-acento" />}
              </label>
            );
          })}
        </div>
        {activos.map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}

        {pendientes.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm font-medium">{pendientes.length} sugerencias pendientes</span>
            <div className="ml-auto flex gap-2">
              <Boton tam="sm" variante="fantasma" onClick={() => decidir(pendientes.map((s) => s.id), 'rechazar')}>
                Rechazar todas
              </Boton>
              <Boton tam="sm" icono={<Check className="size-3.5" />} onClick={() => decidir(pendientes.map((s) => s.id), 'aceptar')}>
                Aceptar todas
              </Boton>
            </div>
          </div>
        )}
        {porSeccion.map(([seccion, lista]) => (
          <div key={seccion} className="space-y-2">
            <button onClick={() => irASeccion(seccion)} className="flex items-center gap-1 text-[12px] font-semibold tracking-wide text-texto-3 uppercase hover:text-acento cursor-pointer">
              {titulos.get(seccion) ?? seccion}
              <ExternalLink className="size-3" />
            </button>
            {lista.map((s) => (
              <TarjetaSugerencia key={s.id} s={s} onDecidir={decidir} />
            ))}
          </div>
        ))}
        {decididas > 0 && (
          <div className="flex items-center justify-between text-[12px] text-texto-3">
            <span>
              {estado.sugerencias.filter((s) => s.estado === 'aceptada').length} aceptadas ·{' '}
              {estado.sugerencias.filter((s) => s.estado === 'rechazada').length} rechazadas
              {estado.sugerencias.some((s) => s.estado === 'fallida') && ` · ${estado.sugerencias.filter((s) => s.estado === 'fallida').length} no aplicables`}
            </span>
            <button className="hover:text-acento cursor-pointer" onClick={() => api.limpiarSugerencias(a, d).then(recargar)}>
              Limpiar historial
            </button>
          </div>
        )}
      </div>
    </Paso>
  );
}

function TarjetaSugerencia({ s, onDecidir }: { s: Sugerencia; onDecidir: (ids: string[], d: 'aceptar' | 'rechazar', p?: string) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [propuesta, setPropuesta] = useState(s.propuesta);
  const [ocupado, setOcupado] = useState(false);
  const trozos = useMemo(() => diferencias(s.original, s.propuesta), [s.original, s.propuesta]);
  // Si cambia casi todo, el resaltado palabra a palabra es ilegible: mejor «antes» y «después»
  const iguales = trozos.filter((t) => t.tipo === 'igual').reduce((n, t) => n + t.texto.trim().length, 0);
  const enBloques = iguales < 0.45 * Math.max(s.original.length, s.propuesta.length);
  const decidir = async (d: 'aceptar' | 'rechazar') => {
    setOcupado(true);
    await onDecidir([s.id], d, editando ? propuesta : undefined);
    setOcupado(false);
  };
  return (
    <div className="aparecer rounded-lg border border-borde bg-fondo/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Insignia color={s.tipo === 'calidad' ? 'acento' : s.tipo === 'fuentes' ? 'aviso' : 'neutro'}>{NOMBRES_REVISION[s.tipo].nombre}</Insignia>
        {s.gravedad === 'alta' && <Insignia color="error">Importante</Insignia>}
        <span className="min-w-0 flex-1 text-[12.5px] text-texto-2">{s.motivo}</span>
      </div>
      {editando ? (
        <AreaTexto rows={4} className="text-[13px]" value={propuesta} onChange={(e) => setPropuesta(e.target.value)} />
      ) : enBloques ? (
        <div className="space-y-1.5 text-[13.5px] leading-relaxed">
          <p className="rounded-md border-l-2 border-error/60 bg-error/8 px-2.5 py-1.5 whitespace-pre-wrap text-texto-2 line-through decoration-error/40">
            {s.original}
          </p>
          <p className="rounded-md border-l-2 border-ok/70 bg-ok/10 px-2.5 py-1.5 whitespace-pre-wrap">{s.propuesta}</p>
        </div>
      ) : (
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
          {trozos.map((t, i) =>
            t.tipo === 'igual' ? (
              <span key={i}>{t.texto}</span>
            ) : t.tipo === 'quitado' ? (
              <del key={i} className="rounded bg-error/12 text-error decoration-error/60">
                {t.texto}
              </del>
            ) : (
              <ins key={i} className="rounded bg-ok/15 text-ok no-underline">
                {t.texto}
              </ins>
            ),
          )}
        </p>
      )}
      <div className="mt-2.5 flex justify-end gap-1.5">
        <Boton tam="sm" variante="fantasma" onClick={() => setEditando(!editando)}>
          {editando ? 'Ver cambios' : 'Editar'}
        </Boton>
        <Boton tam="sm" variante="fantasma" icono={<X className="size-3.5" />} disabled={ocupado} onClick={() => decidir('rechazar')}>
          Rechazar
        </Boton>
        <Boton tam="sm" icono={<Check className="size-3.5" />} cargando={ocupado} onClick={() => decidir('aceptar')}>
          Aceptar
        </Boton>
      </div>
    </div>
  );
}
