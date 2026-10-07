import { useEffect, useMemo, useRef } from 'react';
import { dibujarDiagramas, renderizar } from '../lib/markdown';

/** Vista previa de Markdown con fórmulas y diagramas. `base` es la URL de la carpeta del documento. */
export function VistaPrevia({ texto, base }: { texto: string; base: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderizar(texto, base), [texto, base]);

  useEffect(() => {
    if (!ref.current) return;
    const t = setTimeout(() => ref.current && dibujarDiagramas(ref.current), 150);
    return () => clearTimeout(t);
  }, [html]);

  return <div ref={ref} className="apunte" dangerouslySetInnerHTML={{ __html: html }} />;
}
