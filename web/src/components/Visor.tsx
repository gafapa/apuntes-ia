import { useEffect } from 'react';
import { X } from 'lucide-react';

export type ContenidoVisor = { tipo: 'imagen'; src: string } | { tipo: 'svg'; html: string };

/** Visor a pantalla completa para ampliar imágenes y diagramas. */
export function Visor({ contenido, onCerrar }: { contenido?: ContenidoVisor; onCerrar: () => void }) {
  useEffect(() => {
    if (!contenido) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [contenido, onCerrar]);
  if (!contenido) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-8 backdrop-blur-sm" onClick={onCerrar}>
      <button className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 cursor-pointer" aria-label="Cerrar" onClick={onCerrar}>
        <X className="size-5" />
      </button>
      {contenido.tipo === 'imagen' ? (
        <img src={contenido.src} alt="" className="max-h-full max-w-full rounded-lg bg-white object-contain" onClick={(e) => e.stopPropagation()} />
      ) : (
        <div
          className="visor-svg flex max-h-full max-w-full items-center justify-center overflow-auto rounded-lg bg-panel p-6"
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: contenido.html }}
        />
      )}
    </div>
  );
}
