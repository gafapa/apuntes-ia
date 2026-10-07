import { useEffect, useMemo, useRef, useState } from 'react';
import { dibujarDiagramas, renderizar } from '../lib/markdown';
import { Visor, type ContenidoVisor } from './Visor';

/** Vista previa de Markdown con fórmulas y diagramas. `base` es la URL de la carpeta del documento. */
export function VistaPrevia({ texto, base }: { texto: string; base: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderizar(texto, base), [texto, base]);
  const [ampliado, setAmpliado] = useState<ContenidoVisor>();

  useEffect(() => {
    if (!ref.current) return;
    const t = setTimeout(() => ref.current && dibujarDiagramas(ref.current), 150);
    return () => clearTimeout(t);
  }, [html]);

  // Clic en una imagen o un diagrama: verlo ampliado
  const alPulsar = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const img = el.closest('img');
    if (img) return setAmpliado({ tipo: 'imagen', src: img.src });
    const diagrama = el.closest('.mermaid');
    if (diagrama?.querySelector('svg')) setAmpliado({ tipo: 'svg', html: diagrama.innerHTML });
  };

  return (
    <>
      <div ref={ref} className="apunte" onClick={alPulsar} dangerouslySetInnerHTML={{ __html: html }} />
      <Visor contenido={ampliado} onCerrar={() => setAmpliado(undefined)} />
    </>
  );
}
