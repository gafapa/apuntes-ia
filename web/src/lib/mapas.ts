// Mapas de los bloques ```mapa (YAML). Zonas: España por comunidades o provincias (con Canarias junto
// a la península), la península, Europa, el Mediterráneo, Oriente Próximo, África, América, Asia,
// Oceanía o el mundo, o un encuadre libre. Capas: regiones coloreadas (con tramas), mapas de datos
// con escala, fronteras históricas (atlas historical-basemaps), relieve, ríos y cordilleras (Natural
// Earth), áreas dibujadas, puntos con símbolos, rutas, textos libres y leyenda. Con «mudo: true» los
// nombres se cambian por números y letras, para actividades.
import { load as cargarYaml } from 'js-yaml';
import { geoArea, geoAzimuthalEqualArea, geoBounds, geoConicConformal, geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import { geoConicConformalSpain } from 'd3-composite-projections';
import type { OpcionesBloque } from './bloques';
import { hashTexto } from '../../../shared/hash';
import { añoFronteras, textoAño } from '../../../shared/fronteras';
import { PAISES, comunidades, fisico, fronteras, nombreHistorico, normalizar, paises, provincias, relieve, tierra, type Caja, type Relieve } from './mapasDatos';
import { CIMAS_ESPANA, RELIEVE_ESPANA } from './relieveEspana';
import { claseDe, cortes, gama, textosClases, type MetodoCortes } from './mapasEscala';

const ANCHO = 640;
const PALETA = ['#e4572e', '#4f6bed', '#17a589', '#f0a202', '#8e44ad', '#2e86c1', '#c0392b', '#7f8c8d'];
// Colores suaves para colorear todos los estados de una época (se distinguen entre vecinos)
const PALETA_HISTORICA = ['#e8b27d', '#9fc5a8', '#c7a6d8', '#f2d17f', '#a7c4e5', '#e9a3a3', '#b8d98a', '#d9b8a0', '#9fd4d0', '#e7c1dd', '#c9c48f', '#b0b7e8'];
const ESPANA: Caja = [-19, 27, 5, 45];
const IBERIA: Caja = [-10, 35.9, 3.4, 43.9];

/** Zonas con nombre (además de espana, provincias y mundo). */
const ZONAS: Record<string, Caja> = {
  peninsula: [-10.2, 35.6, 4.6, 44.1],
  europa: [-25, 34, 45, 71],
  mediterraneo: [-10, 29, 37, 47],
  orienteproximo: [24, 12, 63, 43],
  oriente: [24, 12, 63, 43],
  africa: [-19, -36, 53, 38],
  america: [-170, -57, -28, 75],
  norteamerica: [-170, 7, -50, 76],
  centroamerica: [-118, 6, -58, 33],
  sudamerica: [-93, -57, -30, 14],
  suramerica: [-93, -57, -30, 14],
  asia: [25, -11, 150, 78],
  oceania: [110, -50, 180, 2],
};
const NOMBRES_ZONAS = 'espana, provincias, peninsula, europa, mediterraneo, oriente-proximo, africa, america, norteamerica, centroamerica, sudamerica, asia, oceania o mundo';

const CLARO = { tierra: '#e8e6e1', linea: '#ffffff', texto: '#1f2937', halo: '#ffffff', fondo: '#ffffff', mar: '#eef5fb', borde: '#d1d5db' };
const OSCURO = { tierra: '#374151', linea: '#1f2937', texto: '#e5e7eb', halo: '#111827', fondo: 'transparent', mar: 'transparent', borde: '#4b5563' };
type Tema = typeof CLARO;

const esc = (s: unknown) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: unknown, def: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : def);
const lista = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v as T] : []);
const sino = (v: unknown, def: boolean) => (v === undefined || v === null ? def : v !== false && v !== 'no' && v !== 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

// Mismo contenido, mismo dibujo: el relieve tarda un poco en calcularse
const cache = new Map<string, Promise<string>>();

/** SVG de un bloque ```mapa. */
export function dibujarMapa(contenido: string, op: OpcionesBloque): Promise<string> {
  const clave = `${op.oscuro ? 1 : 0}\n${contenido}`;
  let p = cache.get(clave);
  if (!p) {
    p = dibujar(contenido, op);
    p.catch(() => cache.delete(clave));
    cache.set(clave, p);
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
  }
  return p;
}

// ---------- Regiones ----------

interface Region {
  f: any;
  alias: string[]; // nombres normalizados con los que se puede pedir
  etiqueta: string;
  espanola?: boolean;
}

// Otras formas habituales de los nombres oficiales de es-atlas
const ALIAS_ESPANA: Record<string, string[]> = {
  'Illes Balears': ['Islas Baleares', 'Baleares', 'Balears'],
  'Comunitat Valenciana': ['Comunidad Valenciana', 'Valencia', 'País Valenciano'],
  'País Vasco/Euskadi': ['Euskadi', 'País Vasco'],
  'Comunidad Foral de Navarra': ['Navarra'],
  Gipuzkoa: ['Guipúzcoa'],
  Bizkaia: ['Vizcaya'],
  'A Coruña': ['La Coruña', 'Coruña'],
  Ourense: ['Orense'],
  Girona: ['Gerona'],
  Lleida: ['Lérida'],
};
const regionEspanola = (f: any): Region => {
  const nombre = String(f.properties?.name ?? '');
  const etiqueta = nombre.split('/').pop()!.split('. ')[0].trim(); // «Gibraltar. Territorio no asociado…» → «Gibraltar»
  return { f, alias: [nombre, ...nombre.split('/'), ...(ALIAS_ESPANA[nombre] ?? [])].map(normalizar), etiqueta, espanola: true };
};
const INGLES_A_ESPANOL = new Map<string, string[]>();
for (const [es, en] of Object.entries(PAISES)) INGLES_A_ESPANOL.set(en, [...(INGLES_A_ESPANOL.get(en) ?? []), es]);
const regionPais = (f: any): Region => {
  const nombre = String(f.properties?.name ?? '');
  return { f, alias: [normalizar(nombre), ...(INGLES_A_ESPANOL.get(nombre) ?? [])], etiqueta: nombre };
};
const regionHistorica = (f: any): Region => {
  const nombre = String(f.properties.NAME);
  const es = nombreHistorico(nombre);
  return { f, alias: [normalizar(nombre), normalizar(es)], etiqueta: es };
};

function buscar(regiones: Region[], nombre: string): Region | undefined {
  const n = normalizar(nombre);
  // Exacto (también cada forma de «Alacant/Alicante» y el nombre en inglés)…
  // …o una parte clara del nombre oficial («Asturias» → «Principado de Asturias»)
  return regiones.find((r) => r.alias.includes(n)) ?? (n.length >= 4 ? regiones.find((r) => r.alias.some((a) => a.includes(n))) : undefined);
}

// ---------- Encuadre y proyección ----------

interface Marco {
  proy: GeoProjection;
  alto: number;
  arriba: number;
  caja: Caja;
  compuesta: boolean; // España con Canarias en un recuadro
  espana: boolean; // vista de España o de una parte (capas españolas, rótulos del relieve de España)
  extension: number; // grados de longitud a la vista (decide cuánto detalle se dibuja)
  comprobar: boolean; // la inversa de la proyección puede dar puntos fuera del globo (acimutal, mundo)
}

const dentro = (c: Caja, de: Caja) => c[0] >= de[0] && c[2] <= de[2] && c[1] >= de[1] && c[3] <= de[3];

function rejilla([o, s, e, n]: Caja) {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) coordinates.push([o + ((e - o) * i) / 8, s + ((n - s) * j) / 8]);
  return { type: 'MultiPoint', coordinates } as any;
}

function marcoCaja(caja: Caja, arriba: number): Marco {
  const [o, s, e, n] = caja;
  const centro = [(o + e) / 2, (s + n) / 2];
  const espana = dentro(caja, ESPANA);
  // Cónica en las zonas pequeñas de latitudes medias (como los mapas de España); acimutal en el resto
  const conica = espana || (e - o <= 50 && n - s <= 40 && Math.min(Math.abs(s), Math.abs(n)) > 20 && s * n > 0);
  const proy = conica ? geoConicConformal().rotate([-centro[0], 0]).parallels([s + (n - s) / 4, n - (n - s) / 4]) : geoAzimuthalEqualArea().rotate([-centro[0], -centro[1]]);
  const g = rejilla(caja);
  proy.fitWidth(ANCHO - 24, g);
  const [[, y0], [, y1]] = geoPath(proy).bounds(g);
  const alto = Math.round(arriba + Math.max(260, Math.min(720, y1 - y0)) + 12);
  proy.fitExtent([[12, arriba], [ANCHO - 12, alto - 12]], g).clipExtent([[0, arriba - 4], [ANCHO, alto]]);
  return { proy, alto, arriba, caja, compuesta: false, espana, extension: e - o, comprobar: !conica };
}

/** Caja del encuadre: [[latS, lonO], [latN, lonE]], una zona o el nombre de una región o un país. */
async function cajaEncuadre(v: unknown): Promise<Caja> {
  if (Array.isArray(v) && v.length === 2 && v.every((p) => Array.isArray(p) && p.length === 2)) {
    const [[a, b], [c, d]] = v.map((p: any) => p.map(Number));
    if (![a, b, c, d].every(Number.isFinite)) throw new Error('«encuadre» con coordenadas: [[lat sur, lon oeste], [lat norte, lon este]]');
    return [Math.min(b, d), Math.min(a, c), Math.max(b, d), Math.max(a, c)];
  }
  const nombres = lista<string>(v).map(String);
  const zona = ZONAS[normalizar(nombres[0] ?? '')];
  if (zona && nombres.length === 1) return zona;
  const [com, prov, mundo] = await Promise.all([comunidades(), provincias(), paises()]);
  const regiones = [...com.regiones.map(regionEspanola), ...prov.regiones.map(regionEspanola), ...mundo.map(regionPais)];
  let caja: Caja | undefined;
  for (const nombre of nombres) {
    const r = buscar(regiones, nombre);
    if (!r) throw new Error(`No encuentro «${nombre}» para el encuadre`);
    let [[o, s], [e, n]] = geoBounds(r.f);
    if (o > e) [o, e] = [-180, 180]; // cruza el antimeridiano
    caja = caja ? [Math.min(caja[0], o), Math.min(caja[1], s), Math.max(caja[2], e), Math.max(caja[3], n)] : [o, s, e, n];
  }
  if (!caja) throw new Error('«encuadre» vacío');
  const mx = (caja[2] - caja[0]) * 0.08 + 0.15;
  const my = (caja[3] - caja[1]) * 0.08 + 0.15;
  return [caja[0] - mx, caja[1] - my, caja[2] + mx, caja[3] + my];
}

// ---------- Rótulos sin solaparse ----------

type Rect = [number, number, number, number];
class Rotulos {
  private ocupado: Rect[] = [];
  constructor(private limite: Rect) {}
  /**
   * Lo que ocupa un texto centrado en (x, y), girado `giro` grados: un rectángulo o, si va inclinado,
   * una fila de cuadrados a lo largo de la línea (un rectángulo que lo contuviera taparía demasiado).
   */
  caja(x: number, y: number, texto: string, tam: number, giro = 0, ancla: 'middle' | 'start' = 'middle', espaciado = 0): Rect[] {
    const w = texto.length * (tam * 0.56 + espaciado) + 4;
    const h = tam * 1.25;
    const cy = y - tam * 0.35;
    if (Math.abs(giro) < 10) {
      const cx = ancla === 'start' ? x + w / 2 : x;
      return [[cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]];
    }
    const a = (giro * Math.PI) / 180;
    const n = Math.max(1, Math.ceil(w / h));
    const paso = w / n;
    return Array.from({ length: n }, (_, i) => {
      const d = (ancla === 'start' ? 0 : -w / 2) + paso * (i + 0.5);
      const px = x + d * Math.cos(a);
      const py = cy + d * Math.sin(a);
      const r = Math.max(paso, h) / 2;
      return [px - r, py - r, px + r, py + r] as Rect;
    });
  }
  libre(huella: Rect | Rect[]) {
    const [x0, y0, x1, y1] = this.limite;
    return (Array.isArray(huella[0]) ? (huella as Rect[]) : [huella as Rect]).every(
      (c) => c[0] >= x0 && c[1] >= y0 && c[2] <= x1 && c[3] <= y1 && !this.ocupado.some((b) => c[0] < b[2] && c[2] > b[0] && c[1] < b[3] && c[3] > b[1]),
    );
  }
  ocupar(huella: Rect | Rect[]) {
    if (Array.isArray(huella[0])) this.ocupado.push(...(huella as Rect[]));
    else this.ocupado.push(huella as Rect);
  }
}

interface EstiloTexto {
  tam?: number;
  color: string;
  halo: string;
  peso?: number | string;
  cursiva?: boolean;
  giro?: number;
  ancla?: 'middle' | 'start' | 'end';
  espaciado?: number;
}
function texto(x: number, y: number, contenido: string, e: EstiloTexto) {
  const giro = e.giro ? ` transform="rotate(${r1(e.giro)} ${r1(x)} ${r1(y)})"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${e.ancla ?? 'middle'}" font-size="${e.tam ?? 11}" font-weight="${e.peso ?? 600}"${e.cursiva ? ' font-style="italic"' : ''}${e.espaciado ? ` letter-spacing="${e.espaciado}"` : ''} fill="${e.color}" stroke="${e.halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"${giro}>${esc(contenido)}</text>`;
}

/** Ángulo para que un rótulo siga una dirección sin quedar boca abajo. */
const derecho = (grados: number) => (grados > 90 ? grados - 180 : grados < -90 ? grados + 180 : grados);

// ---------- Símbolos y tramas ----------

const SIMBOLOS = ['ciudad', 'capital', 'batalla', 'puerto', 'monasterio', 'iglesia', 'castillo', 'mina', 'yacimiento', 'volcan', 'cima', 'estrella'];

function simbolo(tipo: string, x: number, y: number, color: string | undefined, t: Tema): string {
  const X = r1(x);
  const Y = r1(y);
  const h = t.halo;
  switch (normalizar(tipo)) {
    case 'capital':
      return `<circle cx="${X}" cy="${Y}" r="5.5" fill="${h}" stroke="${color ?? t.texto}" stroke-width="2"/><circle cx="${X}" cy="${Y}" r="2.2" fill="${color ?? t.texto}"/>`;
    case 'batalla': {
      const c = color ?? '#b91c1c';
      return `<g stroke="${h}" stroke-width="4.5" stroke-linecap="round"><path d="M${X - 5} ${Y - 5}L${X + 5} ${Y + 5}M${X + 5} ${Y - 5}L${X - 5} ${Y + 5}"/></g><g stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M${X - 5} ${Y - 5}L${X + 5} ${Y + 5}M${X + 5} ${Y - 5}L${X - 5} ${Y + 5}M${X - 4.5} ${Y + 1.5}L${X - 1.5} ${Y + 4.5}M${X + 4.5} ${Y + 1.5}L${X + 1.5} ${Y + 4.5}"/></g>`;
    }
    case 'puerto': {
      const c = color ?? '#1d4ed8';
      const d = `M${X} ${Y - 3.6}V${Y + 5.5}M${X - 4.5} ${Y + 1.5}Q${X - 4.5} ${Y + 5.5} ${X} ${Y + 5.5}Q${X + 4.5} ${Y + 5.5} ${X + 4.5} ${Y + 1.5}M${X - 2.8} ${Y - 1}H${X + 2.8}`;
      return `<circle cx="${X}" cy="${Y - 5.2}" r="1.7" fill="none" stroke="${h}" stroke-width="4"/><path d="${d}" fill="none" stroke="${h}" stroke-width="4" stroke-linecap="round"/><circle cx="${X}" cy="${Y - 5.2}" r="1.7" fill="none" stroke="${c}" stroke-width="1.6"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
    case 'monasterio':
    case 'iglesia': {
      const d = `M${X} ${Y - 6}V${Y + 6}M${X - 4} ${Y - 2}H${X + 4}`;
      return `<path d="${d}" stroke="${h}" stroke-width="4.5" stroke-linecap="round"/><path d="${d}" stroke="${color ?? '#7c2d12'}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    case 'castillo':
      return `<path d="M${X - 5} ${Y + 5}V${Y - 3}H${X - 3}V${Y - 5.5}H${X - 1}V${Y - 3}H${X + 1}V${Y - 5.5}H${X + 3}V${Y - 3}H${X + 5}V${Y + 5}Z" fill="${color ?? '#57534e'}" stroke="${h}" stroke-width="1.2"/>`;
    case 'mina': {
      const c = color ?? '#44403c';
      const d = `M${X - 5} ${Y + 5}L${X + 3} ${Y - 3}M${X - 1} ${Y - 6}Q${X + 4} ${Y - 6} ${X + 6} ${Y - 1}`;
      return `<path d="${d}" fill="none" stroke="${h}" stroke-width="4.5" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    case 'yacimiento':
      return `<path d="M${X} ${Y - 6}L${X + 6} ${Y}L${X} ${Y + 6}L${X - 6} ${Y}Z" fill="${color ?? '#a16207'}" stroke="${h}" stroke-width="1.4"/>`;
    case 'volcan':
      return `<path d="M${X - 6.5} ${Y + 5}L${X - 2} ${Y - 4}H${X + 2}L${X + 6.5} ${Y + 5}Z" fill="${color ?? '#78350f'}" stroke="${h}" stroke-width="1.2"/><circle cx="${X}" cy="${Y - 5.5}" r="2" fill="#dc2626"/>`;
    case 'cima':
      return `<path d="M${X} ${Y - 5.5}L${X + 5} ${Y + 3.5}H${X - 5}Z" fill="${color ?? '#6b3f1d'}" stroke="${h}" stroke-width="1.2"/>`;
    case 'estrella': {
      const p = Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const r = i % 2 ? 2.6 : 6.5;
        return `${r1(x + r * Math.cos(a))},${r1(y + r * Math.sin(a))}`;
      }).join(' ');
      return `<polygon points="${p}" fill="${color ?? '#d97706'}" stroke="${h}" stroke-width="1.2"/>`;
    }
    default:
      return `<circle cx="${X}" cy="${Y}" r="4" fill="${color ?? t.texto}" stroke="${h}" stroke-width="1.5"/>`;
  }
}

class Tramas {
  private defs = new Map<string, string>();
  constructor(private prefijo: string) {}
  /** Valor de «fill»: el color o la trama (rayas, cuadros o puntos) de ese color. */
  relleno(color: string, trama?: string): string {
    const tipo = normalizar(trama ?? '');
    if (!tipo || tipo === 'no' || tipo === 'lleno') return color;
    if (!['rayas', 'cuadros', 'puntos'].includes(tipo)) throw new Error(`Trama desconocida «${trama}»: usa rayas, cuadros o puntos`);
    const id = `${this.prefijo}-${tipo}-${color.replace(/[^a-z0-9]/gi, '')}`;
    if (!this.defs.has(id)) {
      const fondo = `<rect width="8" height="8" fill="${color}" fill-opacity="0.18"/>`;
      this.defs.set(
        id,
        tipo === 'puntos'
          ? `<pattern id="${id}" patternUnits="userSpaceOnUse" width="7" height="7">${fondo}<circle cx="3.5" cy="3.5" r="1.4" fill="${color}"/></pattern>`
          : `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">${fondo}<path d="M0 0V8${tipo === 'cuadros' ? 'M0 4H8' : ''}" stroke="${color}" stroke-width="${tipo === 'cuadros' ? 1.6 : 2.6}"/></pattern>`,
      );
    }
    return `url(#${id})`;
  }
  svg() {
    return [...this.defs.values()].join('');
  }
}

// ---------- Rutas ----------

/** Curva suave que pasa por los puntos (Catmull-Rom); con dos puntos, un arco hacia la izquierda. */
function curvaSuave(p: number[][], arco: number): string {
  const f = (q: number[]) => `${r1(q[0])},${r1(q[1])}`;
  if (p.length === 2) {
    const [a, b] = p;
    const c = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * arco, (a[1] + b[1]) / 2 + (b[0] - a[0]) * arco];
    return `M${f(a)}Q${f(c)} ${f(b)}`;
  }
  let d = `M${f(p[0])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1)} ${f(c2)} ${f(p2)}`;
  }
  return d;
}

/** Punto a una fracción del recorrido de una línea en pantalla (la mitad, por defecto) y su dirección (grados). */
function mitad(p: number[][], fraccion = 0.5): { x: number; y: number; giro: number; largo: number } | undefined {
  if (p.length < 2) return;
  const tramos = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
  const largo = tramos.reduce((a, b) => a + b, 0);
  let falta = largo * fraccion;
  for (let i = 0; i < tramos.length; i++) {
    if (falta <= tramos[i] || i === tramos.length - 1) {
      const k = tramos[i] ? Math.min(1, falta / tramos[i]) : 0;
      const [a, b] = [p[i], p[i + 1]];
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, giro: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, largo };
    }
    falta -= tramos[i];
  }
}

const lonLat = (p: any): [number, number] => (Array.isArray(p) ? [Number(p[1]), Number(p[0])] : [Number(p.lon), Number(p.lat)]);

// ---------- Relieve ----------

/** Imagen del relieve reproyectada al mapa (JPEG embebido). */
async function capaRelieve(marco: Marco, fondo: string): Promise<string> {
  const imagenes = await relieve(marco.compuesta ? ESPANA : marco.caja);
  if (!imagenes.length) return '';
  const escala = 2;
  const arriba = marco.arriba - 4;
  const W = Math.round(ANCHO * escala);
  const H = Math.round((marco.alto - arriba) * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = W;
  lienzo.height = H;
  const g = lienzo.getContext('2d')!;
  const salida = g.createImageData(W, H);
  const d = salida.data;
  const [fr, fg, fb] = [1, 3, 5].map((i) => parseInt(fondo.slice(i, i + 2), 16));
  const muestra = (img: Relieve, lon: number, lat: number, o: number) => {
    const [ox, s, ex, n] = img.caja;
    const fx = ((lon - ox) / (ex - ox)) * (img.ancho - 1);
    const fy = ((n - lat) / (n - s)) * (img.alto - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, img.ancho - 1);
    const y1 = Math.min(y0 + 1, img.alto - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      const a = img.datos[(y0 * img.ancho + x0) * 4 + c] * (1 - tx) + img.datos[(y0 * img.ancho + x1) * 4 + c] * tx;
      const b = img.datos[(y1 * img.ancho + x0) * 4 + c] * (1 - tx) + img.datos[(y1 * img.ancho + x1) * 4 + c] * tx;
      d[o + c] = a * (1 - ty) + b * ty;
    }
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      d[o] = fr;
      d[o + 1] = fg;
      d[o + 2] = fb;
      d[o + 3] = 255;
      const x = (px + 0.5) / escala;
      const y = arriba + (py + 0.5) / escala;
      const ll = marco.proy.invert?.([x, y]);
      if (!ll || !Number.isFinite(ll[0])) continue;
      if (marco.comprobar) {
        const vuelta = marco.proy(ll);
        if (!vuelta || Math.abs(vuelta[0] - x) > 0.75 || Math.abs(vuelta[1] - y) > 0.75) continue;
      }
      let [lon, lat] = ll;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      const img = imagenes.find((i) => lon >= i.caja[0] && lon <= i.caja[2] && lat >= i.caja[1] && lat <= i.caja[3]);
      if (img) muestra(img, lon, lat, o);
    }
  }
  g.putImageData(salida, 0, 0);
  return `<image href="${lienzo.toDataURL('image/jpeg', 0.86)}" x="0" y="${arriba}" width="${ANCHO}" height="${marco.alto - arriba}" preserveAspectRatio="none"/>`;
}

// ---------- Dibujo ----------

async function dibujar(contenido: string, op: OpcionesBloque): Promise<string> {
  let s: any;
  try {
    s = cargarYaml(contenido);
  } catch (e) {
    throw new Error(`YAML no válido: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!s || typeof s !== 'object') throw new Error('El mapa está vacío');
  const zona = normalizar(s.mapa ?? s.base ?? s.zona ?? 'espana');
  if (!['espana', 'provincias', 'mundo', ...Object.keys(ZONAS)].includes(zona)) throw new Error(`«mapa» debe ser ${NOMBRES_ZONAS}`);
  const prefijo = `m${hashTexto(contenido).slice(0, 8)}`;
  const añoPedido = s.año ?? s.ano ?? s.anio ?? s.epoca;
  const año = añoPedido === undefined ? undefined : añoFronteras(num(añoPedido, NaN));
  if (añoPedido !== undefined && !Number.isFinite(Number(añoPedido))) throw new Error('«año» debe ser un número (negativo antes de Cristo)');
  const conFisico = sino(s.fisico ?? s.físico, false);
  const conRelieve = sino(s.relieve, conFisico);
  const conRios = sino(s.rios ?? s.ríos, conFisico);
  const conMontes = sino(s.montes ?? s.sierras ?? s.cordilleras, conFisico);
  const mudo = sino(s.mudo, false);
  const conEtiquetas = sino(s.etiquetas, true) && !mudo;
  const t: Tema = op.oscuro && !conRelieve ? OSCURO : CLARO;
  const arriba = s.titulo ? 38 : 12;
  const tramas = new Tramas(prefijo);

  // Encuadre
  let marco: Marco;
  let [com, prov] = [undefined as Awaited<ReturnType<typeof comunidades>> | undefined, undefined as Awaited<ReturnType<typeof provincias>> | undefined];
  if (s.encuadre) marco = marcoCaja(await cajaEncuadre(s.encuadre), arriba);
  else if ((zona === 'espana' || zona === 'provincias') && año === undefined) {
    const capa = zona === 'provincias' ? (prov = await provincias()) : (com = await comunidades());
    const alto = 520;
    const proy = (geoConicConformalSpain() as unknown as GeoProjection).fitExtent([[12, arriba], [ANCHO - 12, alto - 12]], { type: 'FeatureCollection', features: capa.regiones } as any);
    marco = { proy, alto, arriba, caja: ESPANA, compuesta: true, espana: true, extension: 14, comprobar: false };
  } else if (zona === 'mundo') {
    const alto = arriba + 356;
    const proy = geoNaturalEarth1().fitExtent([[12, arriba], [ANCHO - 12, alto - 12]], { type: 'Sphere' } as any).clipExtent([[0, arriba - 4], [ANCHO, alto]]);
    marco = { proy, alto, arriba, caja: [-180, -90, 180, 90], compuesta: false, espana: false, extension: 360, comprobar: true };
  } else marco = marcoCaja(zona === 'espana' || zona === 'provincias' ? ZONAS.peninsula : ZONAS[zona], arriba);
  const { proy, alto } = marco;
  const camino = geoPath(proy);
  const enMarco = (xy: [number, number] | null | undefined): xy is [number, number] =>
    !!xy && Number.isFinite(xy[0]) && xy[0] >= 0 && xy[0] <= ANCHO && xy[1] >= arriba - 4 && xy[1] <= alto;

  // Capas de regiones: España (comunidades o provincias), países y, con «año», los estados de esa época
  const divisiones = zona === 'provincias' || normalizar(s.divisiones ?? '') === 'provincias' ? 'provincias' : 'comunidades';
  const regiones: Region[] = [];
  let bordeEspana: any;
  let historicas: Region[] = [];
  if (año !== undefined) historicas = (await fronteras(año)).map(regionHistorica);
  if (marco.compuesta) {
    const capa = (divisiones === 'provincias' ? prov : com) ?? (divisiones === 'provincias' ? await provincias() : await comunidades());
    regiones.push(...capa.regiones.map(regionEspanola));
    bordeEspana = capa.borde;
  } else if (año === undefined) {
    const mundo = await paises();
    if (marco.espana) {
      const capa = divisiones === 'provincias' ? await provincias() : await comunidades();
      regiones.push(...capa.regiones.map(regionEspanola), ...mundo.filter((f) => f.properties?.name !== 'Spain').map(regionPais));
    } else regiones.push(...mundo.map(regionPais));
  }
  const buscables = año !== undefined ? historicas : regiones;

  // Colores: estados de la época (automáticos), mapa de datos y regiones pedidas
  // auto: estados de una época (colores y nombres automáticos); opcional: su nombre solo aparece si cabe
  const colores = new Map<Region, { color: string; etiqueta?: string; trama?: string; auto?: boolean; opcional?: boolean }>();
  const visibles = (rs: Region[]) =>
    rs.filter((r) => {
      const b = camino.bounds(r.f);
      return Number.isFinite(b[0][0]) && b[1][0] > 0 && b[0][0] < ANCHO && b[1][1] > arriba && b[0][1] < alto;
    });
  if (año !== undefined) {
    // Color distinto del de los vecinos (cajas que se tocan), empezando por los más grandes
    const vis = visibles(historicas).map((r) => ({ r, b: camino.bounds(r.f), area: camino.area(r.f) })).sort((a, b) => b.area - a.area);
    const puestos: { b: number[][]; color: string }[] = [];
    for (const { r, b } of vis) {
      const vecinos = new Set(puestos.filter((p) => b[0][0] <= p.b[1][0] + 2 && b[1][0] >= p.b[0][0] - 2 && b[0][1] <= p.b[1][1] + 2 && b[1][1] >= p.b[0][1] - 2).map((p) => p.color));
      const inicio = parseInt(hashTexto(r.etiqueta), 36) % PALETA_HISTORICA.length;
      const color = PALETA_HISTORICA.map((_, i) => PALETA_HISTORICA[(inicio + i) % PALETA_HISTORICA.length]).find((c) => !vecinos.has(c)) ?? PALETA_HISTORICA[inicio];
      puestos.push({ b, color });
      colores.set(r, { color, auto: true });
    }
  }
  const leyendaDatos: { color: string; texto: string }[] = [];
  let tituloLeyenda: string | undefined;
  if (s.valores && typeof s.valores === 'object') {
    const escala = s.escala ?? {};
    const pares = Object.entries(s.valores).map(([nombre, v]) => [nombre, Number(v)] as const);
    const malos = pares.filter(([, v]) => !Number.isFinite(v)).map(([n]) => n);
    if (malos.length) throw new Error(`Valores que no son números: ${malos.join(', ')}`);
    const limites = cortes(pares.map(([, v]) => v), Math.max(2, Math.min(9, num(escala.clases, 5))), (normalizar(escala.metodo ?? '') === 'iguales' ? 'iguales' : 'cuantiles') as MetodoCortes);
    const paradas = lista<string>(escala.colores).length >= 2 ? lista<string>(escala.colores) : ['#fde7d4', '#b3361b'];
    const tonos = gama(paradas, limites.length + 1);
    const noEncontradas: string[] = [];
    const mostrar = normalizar(escala.mostrar ?? 'nombre');
    for (const [nombre, v] of pares) {
      const r = buscar(buscables, nombre);
      if (!r) {
        noEncontradas.push(nombre);
        continue;
      }
      const valor = `${v.toLocaleString('es', { maximumFractionDigits: 2 })}${escala.unidad ? ` ${escala.unidad}` : ''}`;
      const etiqueta = mostrar === 'valor' ? valor : mostrar === 'ambos' ? `${nombre} (${valor})` : nombre;
      colores.set(r, { color: tonos[claseDe(v, limites)], etiqueta, opcional: true });
    }
    if (noEncontradas.length) throw new Error(`No encuentro en el mapa: ${noEncontradas.join(', ')}`);
    textosClases(limites, escala.unidad).forEach((texto, i) => leyendaDatos.push({ color: tonos[i], texto }));
    tituloLeyenda = escala.titulo;
  }
  {
    const entrada = s.regiones ?? s.paises ?? s.comunidades ?? s.provincias ?? s.estados ?? {};
    const pedidas: any[] = Array.isArray(entrada) ? entrada : Object.entries(entrada).map(([nombre, v]) => (typeof v === 'string' ? { nombre, color: v } : { nombre, ...(v as object) }));
    const noEncontradas: string[] = [];
    pedidas.forEach((p, i) => {
      const nombre = String(typeof p === 'string' ? p : p.nombre);
      const r = buscar(buscables, nombre);
      if (!r) return noEncontradas.push(nombre);
      const previo = colores.get(r);
      colores.set(r, {
        color: (typeof p === 'object' && p.color) || (previo?.auto ? previo.color : undefined) || PALETA[i % PALETA.length],
        etiqueta: p?.etiqueta ?? (año !== undefined ? r.etiqueta : nombre),
        trama: p?.trama,
      });
    });
    if (noEncontradas.length) {
      const pista = año !== undefined ? ` En ${textoAño(año)} hay: ${visibles(historicas).map((r) => r.etiqueta).slice(0, 40).join(', ')}.` : '';
      throw new Error(`No encuentro en el mapa: ${noEncontradas.join(', ')}.${pista}`);
    }
  }

  const defs: string[] = [`<clipPath id="${prefijo}-marco"><rect x="0" y="${arriba - 4}" width="${ANCHO}" height="${alto - arriba + 4}"/></clipPath>`];
  const capas: string[] = [];
  const rotulos = new Rotulos([2, arriba - 2, ANCHO - 2, alto - 2]);
  const encima: string[] = []; // rótulos y símbolos, siempre por encima de todo

  // Fondo: relieve o mar
  if (conRelieve) capas.push(await capaRelieve(marco, t === OSCURO ? '#1f2937' : '#dce9f3'));
  else capas.push(`<rect x="0" y="${arriba - 4}" width="${ANCHO}" height="${alto - arriba + 4}" fill="${t.mar}"/>`);
  const opacidad = conRelieve ? 0.55 : 1;

  // Tierra y regiones
  if (año !== undefined) {
    const suelo = await tierra();
    const d = camino(suelo) ?? '';
    defs.push(`<clipPath id="${prefijo}-tierra"><path d="${d}"/></clipPath>`);
    if (!conRelieve) capas.push(`<path d="${d}" fill="${t.tierra}"/>`);
    capas.push(
      `<g clip-path="url(#${prefijo}-tierra)">${[...colores]
        .map(([r, c]) => `<path d="${camino(r.f) ?? ''}" fill="${tramas.relleno(c.color, c.trama)}" fill-opacity="${opacidad}" stroke="${t.linea}" stroke-width="0.9"/>`)
        .join('')}</g>`,
    );
  } else {
    const lineaEspana = conRelieve ? '#ffffff' : t.linea;
    capas.push(
      regiones
        .map((r) => {
          const d = camino(r.f);
          if (!d) return '';
          const c = colores.get(r);
          if (conRelieve && !c) return `<path d="${d}" fill="none" stroke="${r.espanola ? lineaEspana : '#4b5563'}" stroke-opacity="${r.espanola ? 0.75 : 0.55}" stroke-width="${r.espanola ? 0.7 : 0.8}"/>`;
          const relleno = c ? tramas.relleno(c.color, c.trama) : t.tierra;
          return `<path d="${d}" fill="${relleno}"${c && conRelieve ? ` fill-opacity="${opacidad}"` : ''} stroke="${r.espanola || marco.extension > 100 ? (conRelieve ? '#ffffff' : t.linea) : marco.espana ? '#9ca3af' : t.linea}" stroke-width="${marco.extension > 300 ? 0.4 : 0.8}"/>`;
        })
        .join(''),
    );
  }
  if (bordeEspana && marco.compuesta) capas.push(`<path d="${(proy as any).getCompositionBorders?.() ?? ''}" fill="none" stroke="#9ca3af" stroke-width="1"/>`);

  // Áreas dibujadas a mano (territorios antiguos, zonas de influencia…)
  const areas = lista(s.areas ?? s.áreas);
  const numerosAreas: { x: number; y: number; texto: string }[] = [];
  for (const [i, a] of areas.entries()) {
    const anillo = lista<any>(a.puntos).map(lonLat);
    if (anillo.length < 3 || anillo.some((p) => !p.every(Number.isFinite))) throw new Error(`El área ${i + 1} necesita al menos 3 puntos [lat, lon]`);
    if (anillo[0][0] !== anillo[anillo.length - 1][0] || anillo[0][1] !== anillo[anillo.length - 1][1]) anillo.push(anillo[0]);
    let poligono: any = { type: 'Polygon', coordinates: [anillo] };
    if (geoArea(poligono) > 2 * Math.PI) poligono = { type: 'Polygon', coordinates: [[...anillo].reverse()] }; // sentido de las agujas del reloj
    const color = a.color ?? PALETA[(i + 3) % PALETA.length];
    const d = camino(poligono);
    if (!d) continue;
    capas.push(`<path d="${d}" fill="${tramas.relleno(color, a.trama)}" fill-opacity="${a.trama ? 1 : num(a.opacidad, 0.4)}" stroke="${color}" stroke-width="1.4"${a.borde === 'discontinuo' ? ' stroke-dasharray="6 4"' : ''}/>`);
    const nombre = a.etiqueta ?? a.nombre;
    const [x, y] = camino.centroid(poligono);
    if (nombre && Number.isFinite(x)) numerosAreas.push({ x, y, texto: String(nombre) });
  }

  // Ríos, lagos, cordilleras y cimas
  const fuentes: string[] = [];
  if (conRelieve || conRios || conMontes) fuentes.push(conRelieve ? 'Relieve y ríos: Natural Earth' : 'Natural Earth');
  // Sus rótulos van después de los de las regiones y los puntos, por orden de importancia y donde quepan
  const rotulosSierras: (() => void)[] = [];
  const rotulosRios: (() => void)[] = [];
  const rotulosCimas: (() => void)[] = [];
  // Un polígono que la simplificación deja al revés cubriría toda la Tierra
  const invertido = (f: any) => geoArea(f) > 2 * Math.PI;
  if (conRios || conMontes) {
    const fis = await fisico();
    const ext = marco.extension;
    const detalle = ext <= 30 ? 0 : ext <= 100 ? 1 : 2;
    if (conRios) {
      const maxRio = [12, 7, 4][detalle];
      const maxNombre = [10, 5, 3][detalle];
      const maxLago = [12, 8, 3][detalle];
      const base = detalle === 0 ? 1 : 0.8;
      capas.push(
        fis.lagos
          .filter((f) => f.properties.r <= maxLago && !invertido(f))
          .map((f) => camino(f))
          .filter(Boolean)
          .map((d) => `<path d="${d}" fill="#9fcbea" stroke="#2b7bb9" stroke-width="0.5"/>`)
          .join(''),
      );
      const porNombre = new Map<string, { p: number[][]; r: number }>();
      const largo = (q: number[][]) => q.slice(1).reduce((a, c, i) => a + Math.hypot(c[0] - q[i][0], c[1] - q[i][1]), 0);
      for (const f of fis.rios) {
        const { r, n } = f.properties;
        if (r > maxRio) continue;
        const d = camino(f);
        if (!d) continue;
        capas.push(`<path d="${d}" fill="none" stroke="#2b7bb9" stroke-width="${r1((r <= 5 ? 1.7 : r <= 8 ? 1.2 : 0.8) * base)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        if (!n || r > maxNombre || !conEtiquetas) continue;
        // Para el rótulo, el tramo más largo de cada río dentro del mapa
        const lineas = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
        for (const l of lineas) {
          const p = (l as [number, number][]).map((c) => proy(c)).filter(enMarco);
          const actual = porNombre.get(n);
          if (p.length > 1 && (!actual || largo(p) > largo(actual.p))) porNombre.set(n, { p, r: Math.min(r, actual?.r ?? r) });
        }
      }
      // Los ríos principales primero
      const rios = [...porNombre].sort((a, b) => a[1].r - b[1].r || largo(b[1].p) - largo(a[1].p));
      rotulosRios.push(() => {
        for (const [n, { p }] of rios) {
          // Varios sitios a lo largo del cauce, empezando por el centro, hasta que el nombre quepa
          for (const fraccion of [0.5, 0.35, 0.65, 0.22, 0.78]) {
            const m = mitad(p, fraccion);
            if (!m || m.largo < 40) break;
            const tam = m.largo > 150 ? 11 : 9.5;
            const giro = derecho(m.giro);
            const caja = rotulos.caja(m.x, m.y - 3, n, tam, giro);
            if (!rotulos.libre(caja)) continue;
            rotulos.ocupar(caja);
            encima.push(texto(m.x, m.y - 3, n, { tam, color: '#1f5f99', halo: '#ffffff', cursiva: true, peso: 600, giro }));
            break;
          }
        }
      });
    }
    if (conMontes) {
      const cimas: { nombre: string; lat: number; lon: number; altura: number }[] = fis.cimas
        .filter((f) => f.properties.r <= [9, 6, 4][detalle] && f.properties.e >= [1000, 2000, 3000][detalle])
        .map((f) => ({ nombre: f.properties.n, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], altura: f.properties.e }));
      if (marco.espana) for (const c of CIMAS_ESPANA) if (!cimas.some((x) => normalizar(x.nombre).includes(normalizar(c.nombre)))) cimas.push(c);
      cimas.sort((a, b) => b.altura - a.altura);
      rotulosCimas.push(() => {
        for (const c of cimas) {
          const xy = proy([c.lon, c.lat]);
          if (!enMarco(xy)) continue;
          const triangulo: Rect = [xy[0] - 5, xy[1] - 6, xy[0] + 5, xy[1] + 4];
          // En un mapa mudo, solo el triángulo; si no, el pico solo aparece si cabe su nombre
          if (!conEtiquetas) {
            if (!rotulos.libre(triangulo)) continue;
            rotulos.ocupar(triangulo);
            encima.push(simbolo('cima', xy[0], xy[1], '#6b3f1d', CLARO));
            continue;
          }
          const nombre = `${c.nombre} ${c.altura.toLocaleString('es')} m`;
          // El nombre a la derecha del triángulo o, si no cabe, a la izquierda
          const ancho = nombre.length * 9.5 * 0.56 + 4;
          for (const lado of [1, -1]) {
            const x = lado > 0 ? xy[0] + 7 : xy[0] - 7 - ancho;
            const caja = [triangulo, ...rotulos.caja(x, xy[1] + 3.5, nombre, 9.5, 0, 'start')];
            if (!rotulos.libre(caja)) continue;
            rotulos.ocupar(caja);
            encima.push(simbolo('cima', xy[0], xy[1], '#6b3f1d', CLARO), texto(x, xy[1] + 3.5, nombre, { tam: 9.5, color: '#5b3416', halo: '#ffffff', ancla: 'start', peso: 600 }));
            break;
          }
        }
      });
      if (conEtiquetas) {
        const sierras: { nombre: string; x: number; y: number; giro: number; llanura: boolean }[] = [];
        if (marco.espana && detalle === 0) {
          for (const r of RELIEVE_ESPANA) {
            const xy = proy([r.lon, r.lat]);
            if (enMarco(xy)) sierras.push({ nombre: r.nombre, x: xy[0], y: xy[1], giro: r.giro, llanura: r.tipo === 'llanura' });
          }
        }
        const maxSierra = [5, 4, 2][detalle];
        // En el mapa de España con Canarias aparte solo se ven España y su relieve: basta con las de a mano
        for (const f of marco.compuesta ? [] : fis.sierras) {
          if (f.properties.r > maxSierra || invertido(f)) continue;
          const b = geoBounds(f);
          const centro: [number, number] = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
          if (marco.espana && dentro([centro[0], centro[1], centro[0], centro[1]], IBERIA)) continue; // las de España, a mano
          const xy = proy(centro);
          if (!enMarco(xy)) continue;
          // Inclinación según la forma de la cordillera (eje principal de sus puntos)
          const pts = (f.geometry.type === 'Polygon' ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2)).map((c: [number, number]) => proy(c)).filter(enMarco);
          let giro = 0;
          if (pts.length > 2) {
            const mx = pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length;
            const my = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length;
            let sxx = 0, syy = 0, sxy = 0;
            for (const [x, y] of pts) {
              sxx += (x - mx) ** 2;
              syy += (y - my) ** 2;
              sxy += (x - mx) * (y - my);
            }
            giro = Math.max(-60, Math.min(60, derecho((Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI))));
          }
          sierras.push({ nombre: f.properties.n, x: xy[0], y: xy[1], giro, llanura: f.properties.m === 1 });
        }
        rotulosSierras.push(() => {
          const puestos = new Set<string>();
          for (const r of sierras) {
            if (puestos.has(r.nombre)) continue;
            const nombre = r.llanura ? r.nombre : r.nombre.toUpperCase();
            const tam = r.llanura ? 10 : marco.extension <= 16 ? 9.5 : 9;
            const espaciado = r.llanura ? 0 : 1.2;
            const caja = rotulos.caja(r.x, r.y, nombre, tam, r.giro, 'middle', espaciado);
            if (!rotulos.libre(caja)) continue;
            rotulos.ocupar(caja);
            puestos.add(r.nombre);
            encima.push(texto(r.x, r.y, nombre, { tam, color: r.llanura ? '#4d6b2f' : '#7a4a24', halo: '#ffffff', peso: r.llanura ? 600 : 700, cursiva: r.llanura, giro: r.giro, espaciado }));
          }
        });
      }
    }
  }

  // Rutas (viajes, frentes, migraciones…)
  const marcadores: string[] = [];
  const rotulosRutas: { x: number; y: number; giro: number; texto: string; color: string }[] = [];
  for (const [i, r] of lista(s.rutas).entries()) {
    const pts = lista<any>(r.puntos ?? r).map(lonLat);
    if (pts.length < 2 || pts.some((p) => !p.every(Number.isFinite))) throw new Error(`La ruta ${i + 1} necesita al menos 2 puntos [lat, lon]`);
    const color = r.color ?? '#c0392b';
    const grosor = Math.max(1, Math.min(14, num(r.grosor, 2.4)));
    const pantalla = pts.map((p) => proy(p)).filter((p): p is [number, number] => !!p);
    const arco = r.curva === true ? 0.22 : num(r.curva, 0);
    const d = arco || (r.curva && pantalla.length > 2) ? curvaSuave(pantalla, arco || 0.22) : camino({ type: 'LineString', coordinates: pts } as any);
    if (!d) continue;
    const id = `${prefijo}-flecha-${i}`;
    const tam = Math.max(1.8, Math.min(6, 10 / grosor + 1.2));
    const flecha = r.flecha === false || r.flecha === 'no' ? '' : r.flecha === 'ambas' ? 'ambas' : 'fin';
    if (flecha) marcadores.push(`<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="${r1(tam)}" markerHeight="${r1(tam)}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`);
    capas.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round"${r.discontinua ? ` stroke-dasharray="${r1(grosor * 3)} ${r1(grosor * 2)}"` : ''}${flecha ? ` marker-end="url(#${id})"` : ''}${flecha === 'ambas' ? ` marker-start="url(#${id})"` : ''}${r.opacidad ? ` stroke-opacity="${num(r.opacidad, 1)}"` : ''}/>`,
    );
    const nombre = r.etiqueta ?? r.nombre;
    const m = mitad(pantalla);
    if (nombre && m) rotulosRutas.push({ x: m.x, y: m.y - grosor / 2 - 4, giro: derecho(m.giro), texto: String(nombre), color });
  }

  // Rótulos de las regiones coloreadas (o sus números en un mapa mudo)
  let numero = 0;
  const numeros: string[] = [];
  const insignia = (x: number, y: number, n: string) => {
    numeros.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="8.5" fill="#ffffff" stroke="${t === OSCURO ? '#9ca3af' : '#1f2937'}" stroke-width="1.2"/><text x="${r1(x)}" y="${r1(y + 3.8)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1f2937">${esc(n)}</text>`);
    rotulos.ocupar([x - 9, y - 9, x + 9, y + 9]);
  };
  const centroGrande = (f: any): [number, number] => {
    if (f.geometry?.type !== 'MultiPolygon') return camino.centroid(f) as [number, number];
    let mejor: any;
    let area = -1;
    for (const coordinates of f.geometry.coordinates) {
      const g = { type: 'Polygon', coordinates };
      const a = camino.area(g as any);
      if (a > area) [mejor, area] = [g, a];
    }
    return camino.centroid(mejor) as [number, number];
  };
  const etiquetasRegiones: (() => void)[] = [];
  if (mudo || sino(s.etiquetas, true)) {
    const conColor = [...colores].filter(([r, c]) => !c.auto || camino.area(r.f) > 700);
    for (const [r, c] of conColor) {
      if (s.valores && !mudo && conColor.length > 25 && !r.espanola) continue;
      const [x, y] = centroGrande(r.f);
      if (!Number.isFinite(x) || !enMarco([x, y])) continue;
      if (mudo) {
        if (c.auto || s.valores) continue;
        insignia(x, y, String(++numero));
        continue;
      }
      const nombre = c.etiqueta ?? r.etiqueta;
      const tam = c.auto ? 10.5 : 11;
      etiquetasRegiones.push(() => {
        const caja = rotulos.caja(x, y + 4, nombre, tam);
        if ((c.auto || c.opcional) && !rotulos.libre(caja)) return;
        rotulos.ocupar(caja);
        encima.push(texto(x, y + 4, nombre, { tam, color: t.texto, halo: t.halo, peso: 600 }));
      });
    }
    if (mudo && año !== undefined) {
      for (const [r, c] of conColor) {
        if (!c.auto || camino.area(r.f) < 1500) continue;
        const [x, y] = centroGrande(r.f);
        if (Number.isFinite(x) && enMarco([x, y])) insignia(x, y, String(++numero));
      }
    }
  }
  for (const a of numerosAreas) {
    if (mudo) insignia(a.x, a.y, String(++numero));
    else if (conEtiquetas) {
      etiquetasRegiones.push(() => {
        rotulos.ocupar(rotulos.caja(a.x, a.y + 4, a.texto, 11));
        encima.push(texto(a.x, a.y + 4, a.texto, { tam: 11, color: t.texto, halo: t.halo, peso: 700 }));
      });
    }
  }

  // Puntos (ciudades, batallas, puertos…), con letras en un mapa mudo
  let letra = 0;
  const puntos = lista(s.puntos).map((p: any, i: number) => {
    const xy = proy([Number(p.lon), Number(p.lat)]);
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) throw new Error(`El punto ${i + 1} necesita lat y lon`);
    if (p.simbolo && !SIMBOLOS.includes(normalizar(p.simbolo))) throw new Error(`Símbolo desconocido «${p.simbolo}»: ${SIMBOLOS.join(', ')}`);
    return { p, xy };
  });
  for (const { p, xy } of puntos) {
    if (!enMarco(xy)) continue;
    encima.push(simbolo(p.simbolo ?? 'ciudad', xy[0], xy[1], p.color, t));
    rotulos.ocupar([xy[0] - 7, xy[1] - 7, xy[0] + 7, xy[1] + 7]);
  }
  for (const { p, xy } of puntos) {
    if (!enMarco(xy)) continue;
    const nombre = mudo ? String.fromCharCode(65 + (letra++ % 26)) : p.nombre ? String(p.nombre) : '';
    if (!nombre || (!mudo && !conEtiquetas && !p.nombre)) continue;
    const derecha = normalizar(p.posicion ?? '') !== 'izquierda';
    const x = xy[0] + (derecha ? 8 : -8);
    encima.push(texto(x, xy[1] + 4, nombre, { tam: mudo ? 12 : 11.5, color: t.texto, halo: t.halo, ancla: derecha ? 'start' : 'end', peso: mudo ? 800 : 600 }));
    rotulos.ocupar(rotulos.caja(derecha ? x : x - nombre.length * 6.5, xy[1] + 4, nombre, 11.5, 0, 'start'));
  }

  // Textos libres (mares, océanos, pueblos…): en un mapa mudo solo los marcados como fijos
  for (const [i, x] of lista(s.textos).entries()) {
    if (mudo && !x.fijo) continue;
    const xy = proy([Number(x.lon), Number(x.lat)]);
    if (!x.texto || !Number.isFinite(Number(x.lat))) throw new Error(`El texto ${i + 1} necesita texto, lat y lon`);
    if (!enMarco(xy)) continue;
    const tam = Math.max(7, Math.min(30, num(x.tamaño ?? x.tamano, 12)));
    const giro = num(x.giro, 0);
    rotulos.ocupar(rotulos.caja(xy[0], xy[1], String(x.texto), tam, giro));
    encima.push(texto(xy[0], xy[1], String(x.texto), { tam, color: x.color ?? t.texto, halo: t.halo, cursiva: !!x.cursiva, peso: x.negrita ? 700 : 600, giro, espaciado: num(x.espaciado, 0) }));
  }

  // Rótulos con prioridad: regiones, rutas y después los del relieve donde quepan
  etiquetasRegiones.forEach((f) => f());
  if (conEtiquetas)
    for (const r of rotulosRutas) {
      rotulos.ocupar(rotulos.caja(r.x, r.y, r.texto, 11, r.giro));
      encima.push(texto(r.x, r.y, r.texto, { tam: 11, color: r.color, halo: t.halo, peso: 700, giro: r.giro }));
    }
  [...rotulosSierras, ...rotulosRios, ...rotulosCimas].forEach((f) => f());

  // Leyenda: la del mapa de datos y la que se pida (colores, tramas, símbolos o líneas)
  const leyenda = [...leyendaDatos, ...lista<any>(s.leyenda)];
  let piezaLeyenda = '';
  if (leyenda.length) {
    const fila = 20;
    const titulo = tituloLeyenda ? String(tituloLeyenda) : '';
    const altoL = leyenda.length * fila + 12 + (titulo ? 18 : 0);
    const anchoL = Math.max(...leyenda.map((l) => String(l.texto ?? '').length), titulo.length * 1.05) * 6.6 + 46;
    // Abajo a la derecha: abajo a la izquierda está el recuadro de Canarias en el mapa de España
    const x0 = ANCHO - anchoL - 14;
    const y0 = alto - altoL - 12;
    piezaLeyenda += `<rect x="${r1(x0)}" y="${r1(y0)}" width="${r1(anchoL)}" height="${altoL}" rx="6" fill="${t.halo}" fill-opacity="0.92" stroke="${t.borde}"/>`;
    if (titulo) piezaLeyenda += `<text x="${r1(x0 + 10)}" y="${r1(y0 + 18)}" font-size="12" font-weight="700" fill="${t.texto}">${esc(titulo)}</text>`;
    leyenda.forEach((l, i) => {
      const y = y0 + (titulo ? 18 : 0) + 9 + i * fila;
      const color = l.color ?? t.texto;
      if (l.simbolo) piezaLeyenda += simbolo(l.simbolo, x0 + 17, y + 6, l.color, t);
      else if (l.linea || l.ruta) piezaLeyenda += `<path d="M${r1(x0 + 9)} ${r1(y + 6)}H${r1(x0 + 25)}" stroke="${color}" stroke-width="3"${l.discontinua ? ' stroke-dasharray="5 3"' : ''}/>`;
      else piezaLeyenda += `<rect x="${r1(x0 + 10)}" y="${r1(y)}" width="14" height="12" rx="2" fill="${tramas.relleno(color, l.trama)}" stroke="${l.trama ? color : 'none'}" stroke-width="0.8"/>`;
      piezaLeyenda += `<text x="${r1(x0 + 32)}" y="${r1(y + 10)}" font-size="12" fill="${t.texto}">${esc(l.texto)}</text>`;
    });
  }

  if (año !== undefined) fuentes.push(`Fronteras de ${textoAño(año)}${Number(añoPedido) !== año ? ' (aprox.)' : ''}: historical-basemaps (A. Ourednik)`);
  const pie = fuentes.length ? 14 : 0;
  const altoTotal = alto + pie;
  defs.push(tramas.svg(), ...marcadores);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO} ${altoTotal}" width="${ANCHO}" height="${altoTotal}" font-family="Inter, Arial, Helvetica, sans-serif">
<rect width="100%" height="100%" fill="${t.fondo}"/><defs>${defs.join('')}</defs>${s.titulo ? `<text x="${ANCHO / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${t === OSCURO ? OSCURO.texto : CLARO.texto}">${esc(s.titulo)}</text>` : ''}
<g clip-path="url(#${prefijo}-marco)">${capas.join('')}${encima.join('')}${numeros.join('')}</g>${piezaLeyenda}${
    pie ? `<text x="${ANCHO - 8}" y="${altoTotal - 4}" text-anchor="end" font-size="9" fill="#6b7280">${esc(fuentes.join(' · '))}</text>` : ''
  }</svg>`;
}
