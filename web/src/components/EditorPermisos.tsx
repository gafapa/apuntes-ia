import { Check } from 'lucide-react';
import { PERMISOS, type Permisos } from '../../../shared/tipos';
import { cx } from './ui';

/**
 * Qué pueden usar los agentes. En la asignatura, una casilla por permiso (por defecto, todo
 * permitido). En el documento (`heredados` = lo que dice la asignatura), cada permiso puede
 * seguir a la asignatura o fijarse a sí o no.
 */
export function EditorPermisos({
  valor,
  onCambio,
  heredados,
}: {
  valor: Permisos;
  onCambio: (p: Permisos) => void;
  heredados?: Required<Permisos>;
}) {
  const fijar = (id: keyof Permisos, v: boolean | undefined) => {
    const n = { ...valor };
    if (v === undefined) delete n[id];
    else n[id] = v;
    onCambio(n);
  };

  return (
    <div className="divide-y divide-borde rounded-xl border border-borde">
      {PERMISOS.map((p) => {
        const propio = valor[p.id];
        const efectivo = propio ?? heredados?.[p.id] ?? true;
        return (
          <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={cx('text-[13.5px]', !efectivo && 'text-texto-3 line-through decoration-texto-3/50')}>{p.nombre}</div>
              <div className="text-[12px] text-texto-3">{p.ayuda}</div>
            </div>
            {heredados ? (
              <div className="flex shrink-0 gap-0.5 rounded-lg bg-panel-2 p-0.5">
                {(
                  [
                    [undefined, `Como la asignatura (${heredados[p.id] ? 'sí' : 'no'})`],
                    [true, 'Sí'],
                    [false, 'No'],
                  ] as [boolean | undefined, string][]
                ).map(([v, texto]) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => fijar(p.id, v)}
                    className={cx(
                      'whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition-colors cursor-pointer',
                      propio === v ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                    )}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                role="checkbox"
                aria-checked={efectivo}
                aria-label={p.nombre}
                onClick={() => fijar(p.id, efectivo ? false : undefined)}
                className={cx(
                  'flex size-5 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer',
                  efectivo ? 'border-acento bg-acento text-white' : 'border-borde hover:border-texto-3',
                )}
              >
                {efectivo && <Check className="size-3.5" />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
