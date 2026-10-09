// Dibujos SVG escritos directamente en un bloque ```svg (circuitos, figuras de geometría, esquemas
// que no encajan en Mermaid). Se limpian antes de mostrarlos: nada de scripts, eventos ni recursos
// externos.
import DOMPurify from 'dompurify';

export function limpiarSvg(contenido: string): string {
  const limpio = DOMPurify.sanitize(contenido.trim(), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'use'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
  const doc = new DOMParser().parseFromString(limpio, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('El bloque no contiene un <svg> válido');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Tamaño explícito (para rasterizarlo al exportar) a partir del viewBox si falta
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (!svg.getAttribute('width') && vb?.[2]) svg.setAttribute('width', String(vb[2]));
  if (!svg.getAttribute('height') && vb?.[3]) svg.setAttribute('height', String(vb[3]));
  return new XMLSerializer().serializeToString(svg);
}
