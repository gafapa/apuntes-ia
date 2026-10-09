// Mapas de los bloques ```mapa (YAML): España por comunidades o provincias (con Canarias junto a la
// península), Europa o el mundo, con regiones coloreadas, leyenda, puntos y rutas. Los límites son
// los actuales (es-atlas, Natural Earth); para épocas pasadas se colorean las regiones aproximadas.
import { load as cargarYaml } from 'js-yaml';
import { geoAzimuthalEqualArea, geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import { geoConicConformalSpain } from 'd3-composite-projections';
import { feature, mesh } from 'topojson-client';
import type { OpcionesBloque } from './bloques';

const PALETA = ['#e4572e', '#4f6bed', '#17a589', '#f0a202', '#8e44ad', '#2e86c1', '#c0392b', '#7f8c8d'];
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

// Países en español → nombre en Natural Earth (inglés)
const PAISES: Record<string, string> = {
  espana: 'Spain', portugal: 'Portugal', francia: 'France', italia: 'Italy', alemania: 'Germany', reinounido: 'United Kingdom',
  irlanda: 'Ireland', belgica: 'Belgium', paisesbajos: 'Netherlands', holanda: 'Netherlands', luxemburgo: 'Luxembourg', suiza: 'Switzerland',
  austria: 'Austria', polonia: 'Poland', chequia: 'Czechia', republicacheca: 'Czechia', eslovaquia: 'Slovakia', hungria: 'Hungary',
  rumania: 'Romania', bulgaria: 'Bulgaria', grecia: 'Greece', turquia: 'Turkey', dinamarca: 'Denmark', suecia: 'Sweden', noruega: 'Norway',
  finlandia: 'Finland', islandia: 'Iceland', estonia: 'Estonia', letonia: 'Latvia', lituania: 'Lithuania', bielorrusia: 'Belarus',
  ucrania: 'Ukraine', rusia: 'Russia', moldavia: 'Moldova', eslovenia: 'Slovenia', croacia: 'Croatia', bosniayherzegovina: 'Bosnia and Herz.',
  serbia: 'Serbia', montenegro: 'Montenegro', albania: 'Albania', macedoniadelnorte: 'North Macedonia', kosovo: 'Kosovo', chipre: 'Cyprus',
  malta: 'Malta', andorra: 'Andorra', marruecos: 'Morocco', argelia: 'Algeria', tunez: 'Tunisia', libia: 'Libya', egipto: 'Egypt',
  estadosunidos: 'United States of America', eeuu: 'United States of America', canada: 'Canada', mexico: 'Mexico', cuba: 'Cuba',
  guatemala: 'Guatemala', honduras: 'Honduras', elsalvador: 'El Salvador', nicaragua: 'Nicaragua', costarica: 'Costa Rica', panama: 'Panama',
  colombia: 'Colombia', venezuela: 'Venezuela', ecuador: 'Ecuador', peru: 'Peru', bolivia: 'Bolivia', chile: 'Chile', argentina: 'Argentina',
  uruguay: 'Uruguay', paraguay: 'Paraguay', brasil: 'Brazil', republicadominicana: 'Dominican Rep.', puertorico: 'Puerto Rico',
  filipinas: 'Philippines', china: 'China', japon: 'Japan', india: 'India', corea: 'South Korea', coreadelsur: 'South Korea',
  coreadelnorte: 'North Korea', australia: 'Australia', nuevazelanda: 'New Zealand', sudafrica: 'South Africa', iran: 'Iran', irak: 'Iraq',
  israel: 'Israel', siria: 'Syria', arabiasaudi: 'Saudi Arabia', guineaecuatorial: 'Eq. Guinea', saharaoccidental: 'W. Sahara',
};

type Base = 'espana' | 'provincias' | 'europa' | 'mundo';

async function datos(base: Base) {
  if (base === 'espana' || base === 'provincias') {
    const topo: any = await (base === 'provincias' ? import('es-atlas/es/provinces.json') : import('es-atlas/es/autonomous_regions.json'));
    const t = topo.default ?? topo;
    const capa = base === 'provincias' ? 'provinces' : 'autonomous_regions';
    return { regiones: (feature(t, t.objects[capa]) as any).features as any[], borde: mesh(t, t.objects.border) as any };
  }
  const topo: any = await import('world-atlas/countries-50m.json');
  const t = topo.default ?? topo;
  return { regiones: (feature(t, t.objects.countries) as any).features as any[], borde: undefined };
}

function proyeccion(base: Base, ancho: number, alto: number, arriba: number, fc: any): GeoProjection {
  const caja: [[number, number], [number, number]] = [[12, arriba], [ancho - 12, alto - 12]];
  if (base === 'espana' || base === 'provincias') return (geoConicConformalSpain() as unknown as GeoProjection).fitExtent(caja, fc);
  if (base === 'europa') {
    // Encuadre fijo de Europa (con el norte de África y Oriente Próximo cercanos)
    const marco = { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[-24, 35], [42, 35], [-12, 71], [40, 70], [10, 34]] } };
    return geoAzimuthalEqualArea().rotate([-12, -52]).fitExtent(caja, marco as any);
  }
  return geoNaturalEarth1().fitExtent(caja, { type: 'Sphere' } as any);
}

/** SVG de un bloque ```mapa. */
export async function dibujarMapa(contenido: string, op: OpcionesBloque): Promise<string> {
  let s: any;
  try {
    s = cargarYaml(contenido);
  } catch (e) {
    throw new Error(`YAML no válido: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!s || typeof s !== 'object') throw new Error('El mapa está vacío');
  const base = String(s.mapa ?? s.base ?? 'espana')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase() as Base;
  if (!['espana', 'provincias', 'europa', 'mundo'].includes(base)) throw new Error('«mapa» debe ser espana, provincias, europa o mundo');
  const { regiones, borde } = await datos(base);
  const ancho = 640;
  const alto = base === 'mundo' ? 380 : 520;
  const arriba = s.titulo ? 38 : 12;
  const proy = proyeccion(base, ancho, alto, arriba, { type: 'FeatureCollection', features: regiones });
  const camino = geoPath(proy);
  const t = op.oscuro
    ? { tierra: '#374151', linea: '#1f2937', texto: '#e5e7eb', halo: '#111827', fondo: 'transparent', mar: 'transparent' }
    : { tierra: '#e8e6e1', linea: '#ffffff', texto: '#1f2937', halo: '#ffffff', fondo: '#ffffff', mar: '#eef5fb' };

  // Regiones destacadas: { nombre: color } o { nombre: { color, etiqueta } } o lista
  const pedidas: { nombre: string; color: string; etiqueta?: string }[] = [];
  const entrada = s.regiones ?? s.paises ?? s.comunidades ?? s.provincias ?? {};
  const lista = Array.isArray(entrada) ? entrada : Object.entries(entrada).map(([nombre, v]) => (typeof v === 'string' ? { nombre, color: v } : { nombre, ...(v as object) }));
  lista.forEach((r: any, i: number) =>
    pedidas.push({ nombre: String(typeof r === 'string' ? r : r.nombre), color: (typeof r === 'object' && r.color) || PALETA[i % PALETA.length], etiqueta: r?.etiqueta }),
  );
  const buscar = (nombre: string) => {
    const n = norm(nombre);
    const ingles = PAISES[n] ? norm(PAISES[n]) : undefined;
    const nombreDe = (f: any) => String(f.properties?.name ?? '');
    // Exacto (también cada forma de «Alacant/Alicante» y el nombre en inglés de los países)…
    const exacto = regiones.find((f) => {
      const p = norm(nombreDe(f));
      return p === n || p === ingles || nombreDe(f).split('/').some((x: string) => norm(x) === n);
    });
    // …o una parte clara del nombre oficial («Asturias» → «Principado de Asturias»)
    return exacto ?? (n.length >= 4 ? regiones.find((f) => norm(nombreDe(f)).includes(n)) : undefined);
  };
  const colores = new Map<any, { color: string; etiqueta?: string; nombre: string }>();
  const noEncontradas: string[] = [];
  for (const r of pedidas) {
    const f = buscar(r.nombre);
    if (f) colores.set(f, r);
    else noEncontradas.push(r.nombre);
  }
  if (noEncontradas.length) throw new Error(`No encuentro en el mapa: ${noEncontradas.join(', ')}`);

  const clip = `<clipPath id="marco-mapa"><rect x="0" y="${arriba - 4}" width="${ancho}" height="${alto - arriba + 4}"/></clipPath>`;
  let cuerpo = `<rect x="0" y="${arriba - 4}" width="${ancho}" height="${alto - arriba + 4}" fill="${t.mar}"/>`;
  cuerpo += regiones
    .map((f) => {
      const d = camino(f);
      if (!d) return '';
      const c = colores.get(f);
      return `<path d="${d}" fill="${c?.color ?? t.tierra}" stroke="${t.linea}" stroke-width="${base === 'mundo' ? 0.4 : 0.8}"/>`;
    })
    .join('');
  if (borde) cuerpo += `<path d="${(proy as any).getCompositionBorders?.() ?? ''}" fill="none" stroke="#9ca3af" stroke-width="1"/>`;
  // Rutas (p. ej. viajes, frentes, migraciones), con flecha al final si se pide
  const rutas = (s.rutas ?? []).map((r: any, i: number) => {
    const puntos = (r.puntos ?? r).map((p: any) => (Array.isArray(p) ? [Number(p[1]), Number(p[0])] : [Number(p.lon), Number(p.lat)]));
    const color = r.color ?? '#c0392b';
    const d = camino({ type: 'LineString', coordinates: puntos } as any);
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"${r.discontinua ? ' stroke-dasharray="7 5"' : ''}${r.flecha === false ? '' : ` marker-end="url(#flecha-${i})"`}/>
<defs><marker id="flecha-${i}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker></defs>`;
  });
  cuerpo += rutas.join('');
  // Etiquetas de las regiones coloreadas (con halo para que se lean sobre cualquier color)
  if (s.etiquetas !== false) {
    for (const [f, c] of colores) {
      const [x, y] = camino.centroid(f);
      if (!Number.isFinite(x)) continue;
      const texto = c.etiqueta ?? (base === 'mundo' || base === 'europa' ? c.nombre : String(f.properties?.name ?? c.nombre).split('/').pop());
      cuerpo += `<text x="${x}" y="${y}" text-anchor="middle" font-size="11" font-weight="600" fill="${t.texto}" stroke="${t.halo}" stroke-width="3" paint-order="stroke">${esc(texto)}</text>`;
    }
  }
  // Puntos (ciudades, batallas…)
  for (const p of s.puntos ?? []) {
    const xy = proy([Number(p.lon), Number(p.lat)]);
    if (!xy) continue;
    cuerpo += `<circle cx="${xy[0]}" cy="${xy[1]}" r="4" fill="${p.color ?? t.texto}" stroke="${t.halo}" stroke-width="1.5"/>`;
    if (p.nombre) cuerpo += `<text x="${xy[0] + 7}" y="${xy[1] + 4}" font-size="11.5" fill="${t.texto}" stroke="${t.halo}" stroke-width="3" paint-order="stroke">${esc(p.nombre)}</text>`;
  }
  // Leyenda
  const leyenda: { color: string; texto: string }[] = s.leyenda ?? [];
  if (leyenda.length) {
    const alto0 = leyenda.length * 20 + 12;
    const anchoL = Math.max(...leyenda.map((l) => String(l.texto).length)) * 6.6 + 44;
    // Abajo a la derecha: abajo a la izquierda está el recuadro de Canarias en el mapa de España
    const x0 = ancho - anchoL - 14;
    const y0 = alto - alto0 - 12;
    cuerpo += `<rect x="${x0}" y="${y0}" width="${anchoL}" height="${alto0}" rx="6" fill="${t.halo}" fill-opacity="0.9" stroke="#d1d5db"/>`;
    leyenda.forEach((l, i) => {
      cuerpo += `<rect x="${x0 + 10}" y="${y0 + 9 + i * 20}" width="14" height="12" rx="2" fill="${l.color}"/><text x="${x0 + 30}" y="${y0 + 19 + i * 20}" font-size="12" fill="${t.texto}">${esc(l.texto)}</text>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" font-family="Inter, Arial, Helvetica, sans-serif">
<rect width="100%" height="100%" fill="${t.fondo}"/><defs>${clip}</defs>${s.titulo ? `<text x="${ancho / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${t.texto}">${esc(s.titulo)}</text>` : ''}
<g clip-path="url(#marco-mapa)">${cuerpo}</g></svg>`;
}
