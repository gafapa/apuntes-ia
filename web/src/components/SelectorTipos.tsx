import { TIPOS_ACTIVIDAD, type TipoActividad } from '../../../shared/actividades';
import { cx } from './ui';

const GRUPOS: { nombre: string; abierta: boolean }[] = [
  { nombre: 'Respuesta cerrada', abierta: false },
  { nombre: 'Respuesta abierta', abierta: true },
];

/** Cuántas preguntas de cada tipo, agrupados en cerradas y abiertas (actividades y exámenes). */
export function SelectorTipos({
  valor,
  onCambio,
  maximo,
  nota,
}: {
  valor: Partial<Record<TipoActividad, number>>;
  onCambio: (v: Partial<Record<TipoActividad, number>>) => void;
  maximo: (t: TipoActividad) => number;
  /** Texto añadido a la ayuda de cada tipo (p. ej. «con rúbrica»). */
  nota?: (t: TipoActividad) => string | undefined;
}) {
  const fijar = (t: TipoActividad, n: number) => onCambio({ ...valor, [t]: Math.max(0, Math.min(maximo(t), n)) });
  return (
    <div className="space-y-3">
      {GRUPOS.map((g) => (
        <div key={g.nombre}>
          <div className="mb-1.5 text-[11.5px] font-medium tracking-wide text-texto-3 uppercase">{g.nombre}</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {TIPOS_ACTIVIDAD.filter((t) => !!t.abierta === g.abierta).map((t) => {
              const n = valor[t.id] ?? 0;
              const extra = nota?.(t.id);
              return (
                <div key={t.id} className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', n > 0 ? 'border-acento bg-acento-suave' : 'border-borde')} title={t.ayuda}>
                  <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => fijar(t.id, n > 0 ? 0 : maximo(t.id) <= 6 ? 1 : t.abierta ? 2 : 5)}>
                    <span className={cx('block text-[12.5px]', n > 0 && 'font-medium')}>{t.nombre}</span>
                    <span className="block truncate text-[11px] text-texto-3">
                      {t.ayuda}
                      {extra ? ` · ${extra}` : ''}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="size-6 rounded-md border border-borde text-[13px] hover:bg-panel-2 cursor-pointer disabled:opacity-40"
                      disabled={!n}
                      onClick={() => fijar(t.id, n - 1)}
                      aria-label={`Una menos de ${t.nombre}`}
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-[13px] tabular-nums">{n}</span>
                    <button
                      className="size-6 rounded-md border border-borde text-[13px] hover:bg-panel-2 cursor-pointer disabled:opacity-40"
                      disabled={n >= maximo(t.id)}
                      onClick={() => fijar(t.id, n + 1)}
                      aria-label={`Una más de ${t.nombre}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
