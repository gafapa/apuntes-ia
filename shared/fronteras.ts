// Fronteras históricas del atlas historical-basemaps (A. Ourednik, GPL-3.0). No van dentro de la app:
// el servidor descarga cada época la primera vez que un mapa la pide y la guarda junto a los ajustes.

export const URL_FRONTERAS = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';

/** Años con mapa en el atlas (negativos: antes de Cristo). */
export const AÑOS_FRONTERAS = [
  -123000, -10000, -8000, -5000, -4000, -3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300,
  400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815,
  1878, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010,
];

/** El año con mapa más cercano al pedido. */
export function añoFronteras(año: number): number {
  return AÑOS_FRONTERAS.reduce((mejor, a) => (Math.abs(a - año) < Math.abs(mejor - año) ? a : mejor));
}

/** Nombre del archivo del atlas para un año (p. ej. world_bc200.geojson). */
export function archivoFronteras(año: number): string {
  const a = añoFronteras(año);
  return `world_${a < 0 ? `bc${-a}` : a}.geojson`;
}

/** «1492», «200 a. C.». */
export function textoAño(año: number): string {
  return año < 0 ? `${(-año).toLocaleString('es')} a. C.` : String(año);
}
