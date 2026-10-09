// Componentes básicos de la interfaz.
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { create } from 'zustand';
import { Loader2, X } from 'lucide-react';
import clsx from 'clsx';

export const cx = clsx;

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';

export const Boton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tam?: 'sm' | 'md'; cargando?: boolean; icono?: ReactNode }
>(function Boton({ variante = 'secundario', tam = 'md', cargando, icono, className, children, disabled, ...resto }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        tam === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variante === 'primario' && 'bg-acento text-white hover:bg-acento-2 shadow-sm',
        variante === 'secundario' && 'bg-panel border border-borde text-texto hover:bg-panel-2',
        variante === 'fantasma' && 'text-texto-2 hover:bg-panel-2 hover:text-texto',
        variante === 'peligro' && 'bg-error text-white hover:opacity-90',
        className,
      )}
      {...resto}
    >
      {cargando ? <Loader2 className="size-4 animate-spin" /> : icono}
      {children}
    </button>
  );
});

export function BotonIcono({
  titulo,
  className,
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { titulo: string }) {
  return (
    <button
      title={titulo}
      aria-label={titulo}
      className={cx(
        'inline-flex size-7 items-center justify-center rounded-md text-texto-3 hover:bg-panel-2 hover:text-texto transition-colors cursor-pointer disabled:opacity-40',
        className,
      )}
      {...resto}
    >
      {children}
    </button>
  );
}

const claseCampo =
  'w-full rounded-lg border border-borde bg-panel px-3 text-sm text-texto placeholder:text-texto-3 outline-none transition-colors focus:border-acento focus:ring-3 focus:ring-acento/15';

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada(
  { className, ...resto },
  ref,
) {
  return <input ref={ref} className={cx(claseCampo, 'h-9', className)} {...resto} />;
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto(
  { className, ...resto },
  ref,
) {
  return <textarea ref={ref} className={cx(claseCampo, 'py-2 leading-relaxed resize-y', className)} {...resto} />;
});

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-texto">{etiqueta}</span>
      {children}
      {ayuda && <span className="block text-xs text-texto-3 leading-snug">{ayuda}</span>}
    </label>
  );
}

export function Insignia({ children, color = 'neutro', className }: { children: ReactNode; color?: 'neutro' | 'acento' | 'ok' | 'aviso' | 'error'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        color === 'neutro' && 'bg-panel-2 text-texto-2',
        color === 'acento' && 'bg-acento-suave text-acento',
        color === 'ok' && 'bg-ok/12 text-ok',
        color === 'aviso' && 'bg-aviso/12 text-aviso',
        color === 'error' && 'bg-error/12 text-error',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-borde bg-panel shadow-suave', className)}>{children}</div>;
}

export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  ancho = 'max-w-lg',
  sinCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  descripcion?: ReactNode;
  children: ReactNode;
  ancho?: string;
  sinCerrar?: boolean;
}) {
  useEffect(() => {
    if (!abierto || sinCerrar) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [abierto, onCerrar, sinCerrar]);
  if (!abierto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => !sinCerrar && e.target === e.currentTarget && onCerrar()}
    >
      {/* Nunca más alto que la ventana: si no cabe, se desplaza el contenido y la cabecera queda fija */}
      <div role="dialog" aria-modal="true" className={cx('aparecer flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-2xl border border-borde bg-panel shadow-2xl', ancho)}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
            {descripcion && <p className="mt-1 text-sm text-texto-2">{descripcion}</p>}
          </div>
          {!sinCerrar && (
            <BotonIcono titulo="Cerrar" onClick={onCerrar}>
              <X className="size-4" />
            </BotonIcono>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pt-4 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Vacio({ icono, titulo, texto, accion }: { icono: ReactNode; titulo: string; texto?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-acento-suave text-acento">{icono}</div>
      <h3 className="font-semibold">{titulo}</h3>
      {texto && <p className="mt-1 max-w-sm text-sm text-texto-2">{texto}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}

// ---------- Confirmación ----------

interface EstadoConfirmar {
  pregunta?: { titulo: string; texto?: string; boton: string; peligro?: boolean; resolver: (v: boolean) => void };
}
const useConfirmar = create<EstadoConfirmar>(() => ({}));

export function confirmar(titulo: string, opciones: { texto?: string; boton?: string; peligro?: boolean } = {}): Promise<boolean> {
  return new Promise((resolver) =>
    useConfirmar.setState({ pregunta: { titulo, texto: opciones.texto, boton: opciones.boton ?? 'Aceptar', peligro: opciones.peligro, resolver } }),
  );
}

export function Confirmador() {
  const p = useConfirmar((s) => s.pregunta);
  const responder = (v: boolean) => {
    p?.resolver(v);
    useConfirmar.setState({ pregunta: undefined });
  };
  return (
    <Modal abierto={!!p} onCerrar={() => responder(false)} titulo={p?.titulo} descripcion={p?.texto} ancho="max-w-md">
      <div className="flex justify-end gap-2">
        <Boton onClick={() => responder(false)}>Cancelar</Boton>
        <Boton variante={p?.peligro ? 'peligro' : 'primario'} onClick={() => responder(true)} autoFocus>
          {p?.boton}
        </Boton>
      </div>
    </Modal>
  );
}
