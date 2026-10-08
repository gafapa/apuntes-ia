import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useEstado } from '../../lib/estado';
import { cx } from '../ui';
import { PASOS, VISTAS_DOCUMENTO, estadoPaso, useFlujoActual, useVistaDocumento, type IdVista } from './pasos';

/** Barra lateral dentro de un documento: las fases del flujo y las vistas del documento. */
export function NavegacionDocumento() {
  const f = useFlujoActual()!;
  const { asignaturas, seleccionar } = useEstado();
  const [vista, elegir] = useVistaDocumento();
  const asig = asignaturas.find((a) => a.id === f.a);
  const doc = asig?.documentos.find((d) => d.id === f.d);
  const secciones = f.estado?.secciones.length ?? 0;
  const imagenes = f.estado?.visuales.filter((v) => v.estado === 'insertada').length ?? 0;

  const Elemento = ({ id, children, activo }: { id: IdVista; children: React.ReactNode; activo: boolean }) => (
    <button
      onClick={() => elegir(id)}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors cursor-pointer',
        activo ? 'bg-acento-suave text-acento' : 'text-texto-2 hover:bg-panel-2 hover:text-texto',
      )}
    >
      {children}
    </button>
  );

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-2 pb-3">
      <button
        onClick={() => seleccionar({ asignatura: f.a })}
        className="mx-2 mt-2 flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-acento cursor-pointer"
      >
        <ArrowLeft className="size-3.5" />
        <span className="size-2 shrink-0 rounded-full" style={{ background: asig?.color }} />
        <span className="truncate">{asig?.nombre ?? 'Asignatura'}</span>
      </button>
      <div className="mx-2 mt-1.5 mb-3 text-[15px] leading-snug font-semibold">{doc?.titulo ?? ''}</div>

      <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Flujo</div>
      <ol className="relative">
        {/* Línea que une las fases */}
        <div className="absolute top-4 bottom-4 left-[21px] w-px bg-borde" aria-hidden />
        {PASOS.map((p, i) => {
          const e = estadoPaso(p.id, f.estado, f.trabajos);
          const sel = vista === p.id;
          return (
            <li key={p.id} className="relative">
              <Elemento id={p.id} activo={sel}>
                <span
                  className={cx(
                    'z-10 flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                    e.hecho
                      ? 'border-ok bg-ok text-white'
                      : e.trabajando
                        ? 'border-acento bg-panel text-acento'
                        : sel
                          ? 'border-acento bg-acento text-white'
                          : 'border-borde bg-panel text-texto-3',
                  )}
                >
                  {e.trabajando ? <Loader2 className="size-3 animate-spin" /> : e.hecho ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate', sel && 'font-medium')}>{p.titulo}</span>
                  {(e.aviso || p.opcional) && (
                    <span className={cx('block truncate text-[11px] leading-tight', e.aviso ? 'text-aviso' : 'text-texto-3')}>
                      {e.aviso ?? 'opcional'}
                    </span>
                  )}
                </span>
              </Elemento>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 px-2 pb-1 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Documento</div>
      {VISTAS_DOCUMENTO.map((v) => (
        <Elemento key={v.id} id={v.id} activo={vista === v.id}>
          <v.icono className="size-4 shrink-0" />
          <span className="flex-1">{v.titulo}</span>
          {v.id === 'apuntes' && secciones > 0 && <span className="text-[11px] text-texto-3">{secciones} secc.</span>}
          {v.id === 'recursos' && imagenes > 0 && <span className="text-[11px] text-texto-3">{imagenes}</span>}
        </Elemento>
      ))}
    </nav>
  );
}
