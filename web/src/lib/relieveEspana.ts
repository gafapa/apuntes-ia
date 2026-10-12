// Unidades del relieve de España para los mapas físicos: Natural Earth solo trae algunas, así que se
// ponen a mano con el punto central y la inclinación del rótulo (grados, en el sentido de las agujas
// del reloj), como en los mapas de los libros de texto.

export interface RotuloRelieve {
  nombre: string;
  lat: number;
  lon: number;
  giro: number;
  tipo: 'sierra' | 'llanura';
}

export const RELIEVE_ESPANA: RotuloRelieve[] = [
  { nombre: 'Macizo Galaico', lat: 42.55, lon: -7.75, giro: 0, tipo: 'sierra' },
  { nombre: 'Montes de León', lat: 42.4, lon: -6.4, giro: -35, tipo: 'sierra' },
  { nombre: 'Cordillera Cantábrica', lat: 43.02, lon: -5.3, giro: -3, tipo: 'sierra' },
  { nombre: 'Montes Vascos', lat: 43.08, lon: -2.5, giro: 0, tipo: 'sierra' },
  { nombre: 'Pirineos', lat: 42.68, lon: 0.75, giro: 12, tipo: 'sierra' },
  { nombre: 'Sistema Ibérico', lat: 41.0, lon: -1.95, giro: 45, tipo: 'sierra' },
  { nombre: 'Cordillera Costero-Catalana', lat: 41.5, lon: 1.75, giro: -36, tipo: 'sierra' },
  { nombre: 'Sistema Central', lat: 40.5, lon: -4.75, giro: -16, tipo: 'sierra' },
  { nombre: 'Montes de Toledo', lat: 39.45, lon: -4.45, giro: -4, tipo: 'sierra' },
  { nombre: 'Sierra Morena', lat: 38.2, lon: -5.0, giro: -9, tipo: 'sierra' },
  { nombre: 'Cordilleras Béticas', lat: 37.35, lon: -3.2, giro: -26, tipo: 'sierra' },
  { nombre: 'Submeseta Norte', lat: 41.75, lon: -4.7, giro: 0, tipo: 'llanura' },
  { nombre: 'Submeseta Sur', lat: 39.15, lon: -2.75, giro: 0, tipo: 'llanura' },
  { nombre: 'Depresión del Ebro', lat: 41.6, lon: -0.85, giro: 37, tipo: 'llanura' },
  { nombre: 'Depresión del Guadalquivir', lat: 37.6, lon: -5.45, giro: -24, tipo: 'llanura' },
];

/** Cimas que faltan en Natural Earth (las que ya están se toman de allí). */
export const CIMAS_ESPANA = [
  { nombre: 'Teide', lat: 28.272, lon: -16.642, altura: 3715 },
  { nombre: 'Peñalara', lat: 40.85, lon: -3.955, altura: 2428 },
  { nombre: 'Pico de Urbión', lat: 41.99, lon: -2.88, altura: 2228 },
];
