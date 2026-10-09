// Bloques que la interfaz dibuja (como los diagramas Mermaid y las moléculas) y que al exportar se
// convierten en imagen con su pie: gráficas, mapas, árboles sintácticos, partituras, dibujos SVG
// (circuitos, geometría), tiras de pictogramas e imágenes con etiquetas.
import { hashTexto } from './hash';

export const BLOQUES_DIBUJADOS = ['grafica', 'mapa', 'sintaxis', 'abc', 'svg', 'pictogramas', 'etiquetas'] as const;
export type TipoBloque = (typeof BLOQUES_DIBUJADOS)[number];

/** ```tipo … ``` seguido, opcionalmente, de la línea «*Figura: pie*». Grupos: tipo, contenido, pie. */
export const PATRON_BLOQUE = new RegExp(
  '```(' + BLOQUES_DIBUJADOS.join('|') + ')[^\\n]*\\n([\\s\\S]*?)```(?:[ \\t]*\\n\\s*\\n?[ \\t]*\\*Figura:\\s*([^*\\n]+)\\*)?',
  'g',
);

/** Identificador de la imagen de un bloque al exportar (solo letras y números). */
export function claveBloque(tipo: TipoBloque, contenido: string): string {
  return `b${BLOQUES_DIBUJADOS.indexOf(tipo)}${hashTexto(`${tipo}\n${contenido.trim()}`)}`;
}

/** Ancho máximo al exportar (cm), según lo que suele necesitar cada tipo para leerse bien. */
export const ANCHO_BLOQUE: Record<TipoBloque, number> = {
  grafica: 13,
  mapa: 14,
  sintaxis: 15,
  abc: 16,
  svg: 13,
  pictogramas: 16,
  etiquetas: 14,
};

/** Nombre legible de cada tipo (avisos y pies genéricos). */
export const NOMBRE_BLOQUE: Record<TipoBloque, string> = {
  grafica: 'Gráfica',
  mapa: 'Mapa',
  sintaxis: 'Análisis sintáctico',
  abc: 'Partitura',
  svg: 'Dibujo',
  pictogramas: 'Pictogramas',
  etiquetas: 'Imagen con etiquetas',
};
