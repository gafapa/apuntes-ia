import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, MessageSquarePlus } from 'lucide-react';
import type { EstadoFlujo, PasoFlujo, Trabajo } from '../../../../shared/tipos';
import { api } from '../../lib/api';
import { useEstado } from '../../lib/estado';
import { AreaTexto, Boton, Insignia, cx } from '../ui';

/** Estado del flujo de un documento, que se recarga cuando cambian sus archivos o sus trabajos. */
export function useFlujo(asignatura: string, documento: string) {
  const version = useEstado((s) => s.versiones[`${asignatura}/${documento}`] ?? 0);
  const todos = useEstado((s) => s.trabajos);
  const trabajos = useMemo(
    () => Object.values(todos).filter((t) => t.asignatura === asignatura && t.documento === documento),
    [todos, asignatura, documento],
  );
  const firma = trabajos.map((t) => t.id + t.estado).join(',');
  const [estado, setEstado] = useState<EstadoFlujo>();
  const recargar = useCallback(() => api.flujo(asignatura, documento).then(setEstado).catch(() => {}), [asignatura, documento]);
  useEffect(() => {
    recargar();
  }, [recargar, version, firma]);
  return { estado, recargar, trabajos };
}

export const activo = (t: Trabajo) => t.estado === 'ejecutando' || t.estado === 'en-cola';

export function trabajosDe(trabajos: Trabajo[], paso: PasoFlujo, filtro?: (t: Trabajo) => boolean) {
  return trabajos.filter((t) => t.paso === paso && activo(t) && (!filtro || filtro(t)));
}

/** Cuando la fase se muestra sola (elegida en la barra lateral): sin número ni plegado. */
export const PasoSolo = createContext(false);

/** Tarjeta de una fase del flujo, con su número y su estado. */
export function Paso({
  numero,
  titulo,
  descripcion,
  hecho,
  opcional,
  trabajando,
  acciones,
  children,
  plegable = true,
  abiertoInicial = true,
}: {
  numero: number;
  titulo: string;
  descripcion: string;
  hecho?: boolean;
  opcional?: boolean;
  trabajando?: boolean;
  acciones?: ReactNode;
  children?: ReactNode;
  plegable?: boolean;
  abiertoInicial?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const solo = useContext(PasoSolo);
  useEffect(() => {
    if (trabajando) setAbierto(true);
  }, [trabajando]);
  if (solo) {
    return (
      <section>
        <div className="mb-5 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-texto-3">Fase {numero}</span>
              {opcional && <Insignia>Opcional</Insignia>}
              {hecho && <Insignia color="ok">Hecha</Insignia>}
              {trabajando && <Insignia color="acento">En curso</Insignia>}
            </div>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight">{titulo}</h2>
            <p className="mt-1 text-sm text-texto-2">{descripcion}</p>
          </div>
          {acciones && <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">{acciones}</div>}
        </div>
        {children && <div className={cx('rounded-xl border bg-panel p-5 shadow-suave', trabajando ? 'border-acento/40' : 'border-borde')}>{children}</div>}
      </section>
    );
  }
  return (
    <section className="relative pl-12">
      <div
        className={cx(
          'absolute top-4 left-0 flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold',
          hecho ? 'border-ok bg-ok text-white' : trabajando ? 'border-acento bg-acento-suave text-acento' : 'border-borde bg-panel text-texto-3',
        )}
      >
        {trabajando ? <Loader2 className="size-4 animate-spin" /> : hecho ? <Check className="size-4" /> : numero}
      </div>
      <div className={cx('rounded-xl border bg-panel shadow-suave', trabajando ? 'border-acento/40' : 'border-borde')}>
        <div className="flex items-start gap-3 px-5 py-4">
          <button
            className={cx('min-w-0 flex-1 text-left', plegable && children && 'cursor-pointer')}
            onClick={() => plegable && children && setAbierto(!abierto)}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{titulo}</h3>
              {opcional && <Insignia>Opcional</Insignia>}
              {plegable && children && <ChevronDown className={cx('size-4 text-texto-3 transition-transform', abierto && 'rotate-180')} />}
            </div>
            <p className="mt-0.5 text-[13px] text-texto-2">{descripcion}</p>
          </button>
          {acciones && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{acciones}</div>}
        </div>
        {children && abierto && <div className="border-t border-borde px-5 py-4">{children}</div>}
      </div>
    </section>
  );
}

/** Botón que lanza un agente, con un campo opcional para darle indicaciones. */
export function BotonAgente({
  texto,
  onLanzar,
  variante = 'primario',
  icono,
  disabled,
  ayudaIndicaciones = 'Indicaciones para el agente (opcional): enfoque, nivel, qué incluir o evitar…',
}: {
  texto: string;
  onLanzar: (indicaciones?: string) => Promise<unknown>;
  variante?: 'primario' | 'secundario';
  icono?: ReactNode;
  disabled?: boolean;
  ayudaIndicaciones?: string;
}) {
  const { avisar } = useEstado();
  const [conIndicaciones, setConIndicaciones] = useState(false);
  const [indicaciones, setIndicaciones] = useState('');
  const [cargando, setCargando] = useState(false);
  const lanzar = async () => {
    setCargando(true);
    try {
      await onLanzar(indicaciones.trim() || undefined);
      setIndicaciones('');
      setConIndicaciones(false);
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setCargando(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <button
          title="Añadir indicaciones"
          onClick={() => setConIndicaciones(!conIndicaciones)}
          className={cx(
            'flex size-9 items-center justify-center rounded-lg transition-colors cursor-pointer',
            conIndicaciones ? 'bg-acento-suave text-acento' : 'text-texto-3 hover:bg-panel-2 hover:text-texto',
          )}
        >
          <MessageSquarePlus className="size-4" />
        </button>
        <Boton variante={variante} icono={icono} cargando={cargando} disabled={disabled} onClick={lanzar}>
          {texto}
        </Boton>
      </div>
      {conIndicaciones && (
        <AreaTexto
          autoFocus
          rows={2}
          className="w-80 text-[13px]"
          placeholder={ayudaIndicaciones}
          value={indicaciones}
          onChange={(e) => setIndicaciones(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) lanzar();
          }}
        />
      )}
    </div>
  );
}

/** Línea con lo último que está haciendo un agente. */
export function ActividadAgente({ t }: { t: Trabajo }) {
  const ultimo = [...t.eventos].reverse().find((e) => e.tipo === 'herramienta' || e.tipo === 'estado');
  return (
    <div className="flex items-center gap-2 rounded-lg bg-acento-suave/60 px-3 py-2 text-[12.5px]">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-acento" />
      <span className="font-medium text-acento">{t.nombreAgente}</span>
      <span className="min-w-0 truncate text-texto-2">{t.estado === 'en-cola' ? 'En cola…' : ultimo?.texto ?? 'Trabajando…'}</span>
    </div>
  );
}

export function fechaCorta(iso: string) {
  return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
