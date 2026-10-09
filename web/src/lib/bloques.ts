// Dibujo de los bloques de shared/bloques.ts (gráficas, mapas, árboles sintácticos, partituras, SVG,
// pictogramas e imágenes con etiquetas). Cada tipo se carga solo cuando hace falta.
import type { TipoBloque } from '../../../shared/bloques';

export interface OpcionesBloque {
  oscuro: boolean; // colores para la vista previa en modo oscuro (al exportar, siempre claro)
  base?: string; // URL de la carpeta del documento (para las imágenes de «etiquetas»)
}

type Dibujante = (contenido: string, op: OpcionesBloque) => Promise<string> | string;

const DIBUJANTES: Record<TipoBloque, () => Promise<Dibujante>> = {
  grafica: () => import('./graficas').then((m) => (c: string, op: OpcionesBloque) => m.dibujarGrafica(c, op.oscuro)),
  mapa: () => import('./mapas').then((m) => m.dibujarMapa),
  sintaxis: () => import('./sintaxis').then((m) => (c: string, op: OpcionesBloque) => m.dibujarSintaxis(c, op.oscuro)),
  abc: () => import('./partituras').then((m) => (c: string, op: OpcionesBloque) => m.dibujarPartitura(c, op.oscuro)),
  svg: () => import('./svgSeguro').then((m) => (c: string) => m.limpiarSvg(c)),
  pictogramas: () => import('./pictogramas').then((m) => m.dibujarPictogramas),
  etiquetas: () => import('./etiquetas').then((m) => m.dibujarEtiquetas),
};

const cargados = new Map<TipoBloque, Promise<Dibujante>>();

/** SVG (como texto) de un bloque. Lanza un error legible si el contenido no es válido. */
export async function dibujarBloque(tipo: TipoBloque, contenido: string, op: OpcionesBloque): Promise<string> {
  let d = cargados.get(tipo);
  if (!d) {
    d = DIBUJANTES[tipo]();
    cargados.set(tipo, d);
  }
  return (await d)(contenido, op);
}
