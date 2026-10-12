// Prepara los datos de los mapas físicos a partir de Natural Earth (dominio público):
//   node scripts/datos-mapas.mjs [carpeta de descargas]
// Descarga (si no están) las capas de ríos, lagos, regiones físicas y cimas a escala 1:10 millones y el
// relieve en colores de altitud (HYP_HR_SR_W, ~400 MB) y escribe en web/src/lib/datos-mapas/:
//   fisico.json            TopoJSON con ríos, lagos, cordilleras y cimas (nombres en español)
//   relieve-*.jpg          el relieve en proyección equirectangular para el mundo, Europa e Iberia
// Las cordilleras de España que Natural Earth no trae están en web/src/lib/relieveEspana.ts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import shapefile from 'shapefile';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';
import { fromFile } from 'geotiff';
import jpeg from 'jpeg-js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.join(raiz, 'web', 'src', 'lib', 'datos-mapas');
const descargas = process.argv[2] ?? path.join(os.tmpdir(), 'apuntes-datos-mapas');
const NE = 'https://naciscdn.org/naturalearth/10m';
fs.mkdirSync(salida, { recursive: true });
fs.mkdirSync(descargas, { recursive: true });

/** Descarga y descomprime una capa de Natural Earth; devuelve la carpeta con sus archivos. */
async function capa(ruta) {
  const nombre = path.basename(ruta);
  const dir = path.join(descargas, nombre);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) return dir;
  const zip = path.join(descargas, `${nombre}.zip`);
  if (!fs.existsSync(zip)) {
    console.log(`Descargando ${nombre}…`);
    const r = await fetch(`${NE}/${ruta}.zip`);
    if (!r.ok) throw new Error(`${r.status} al descargar ${nombre}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync('unzip', ['-oq', zip, '-d', dir]);
  } catch {
    execFileSync('tar', ['-xf', zip, '-C', dir]);
  }
  return dir;
}

async function leer(ruta) {
  const dir = await capa(ruta);
  const base = path.join(dir, path.basename(ruta));
  const { features } = await shapefile.read(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' });
  // Los campos de texto del .dbf vienen rellenos de caracteres nulos
  for (const f of features) for (const [k, v] of Object.entries(f.properties)) if (typeof v === 'string') f.properties[k] = v.replace(/\0/g, '').trim();
  return features;
}

// Caja (lon, lat) de Europa, donde se conservan también los ríos y lagos pequeños
const enEuropa = ([lon, lat]) => lon > -26 && lon < 46 && lat > 33 && lat < 72;
const puntos = (g) => (g.type === 'Point' ? [g.coordinates] : g.type.startsWith('Multi') && g.type !== 'MultiPoint' ? g.coordinates.flat(g.type === 'MultiPolygon' ? 2 : 1) : g.coordinates.flat(g.type === 'Polygon' ? 1 : 0));
const centro = (g) => {
  const p = puntos(g);
  return [p.reduce((s, c) => s + c[0], 0) / p.length, p.reduce((s, c) => s + c[1], 0) / p.length];
};

// ---------- Vectores ----------
const rios = [];
for (const f of await leer('physical/ne_10m_rivers_lake_centerlines')) {
  if (!f.geometry) continue;
  const r = f.properties.scalerank;
  if (r > 6 && !enEuropa(centro(f.geometry))) continue;
  rios.push({ type: 'Feature', geometry: f.geometry, properties: { n: f.properties.name_es || f.properties.name_en || '', r } });
}
for (const f of await leer('physical/ne_10m_rivers_europe')) {
  if (!f.geometry) continue;
  let n = f.properties.name_es || f.properties.name || '';
  const [, lat] = centro(f.geometry);
  // Errores de Natural Earth en la península
  if (f.properties.name === 'Guadiana Menor') n = 'Guadiana Menor';
  if (f.properties.name === 'Alagón') n = lat > 41.5 ? 'Aragón' : 'Alagón';
  rios.push({ type: 'Feature', geometry: f.geometry, properties: { n, r: f.properties.scalerank } });
}
const lagos = (await leer('physical/ne_10m_lakes'))
  .filter((f) => f.geometry && (f.properties.scalerank <= 2 || (enEuropa(centro(f.geometry)) && f.properties.scalerank <= 9)))
  .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { n: f.properties.name_es || f.properties.name || '', r: f.properties.scalerank } }));
const sierras = (await leer('physical/ne_10m_geography_regions_polys'))
  .filter((f) => f.geometry && ['Range/mtn', 'Plateau'].includes(f.properties.FEATURECLA) && f.properties.SCALERANK <= (enEuropa(centro(f.geometry)) ? 5 : 3))
  .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { n: f.properties.NAME_ES || f.properties.NAME, r: f.properties.SCALERANK, m: f.properties.FEATURECLA === 'Plateau' ? 1 : 0 } }));
const cimas = (await leer('physical/ne_10m_geography_regions_elevation_points'))
  .filter((f) => f.geometry && f.properties.elevation > 0 && (f.properties.scalerank <= 5 || enEuropa(centro(f.geometry))))
  .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { n: f.properties.name_es || f.properties.name, e: Math.round(f.properties.elevation), r: f.properties.scalerank } }));

let topo = topology({ rios: { type: 'FeatureCollection', features: rios }, lagos: { type: 'FeatureCollection', features: lagos }, sierras: { type: 'FeatureCollection', features: sierras }, cimas: { type: 'FeatureCollection', features: cimas } });
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, 0.15)); // conserva el 15 % de los puntos
// Sin el peso de cada punto que añade la simplificación, y cuantizado (coordenadas enteras en deltas)
topo.arcs = topo.arcs.map((arco) => arco.map(([x, y]) => [x, y]));
topo = quantize(topo, 1e5);
fs.writeFileSync(path.join(salida, 'fisico.json'), JSON.stringify(topo));
console.log(`fisico.json: ${rios.length} ríos, ${lagos.length} lagos, ${sierras.length} cordilleras y mesetas, ${cimas.length} cimas (${Math.round(fs.statSync(path.join(salida, 'fisico.json')).size / 1024)} KB)`);

// ---------- Relieve ----------
const dirRelieve = await capa('raster/HYP_HR_SR_W');
const tiff = await fromFile(path.join(dirRelieve, 'HYP_HR_SR_W.tif'));
const imagen = await tiff.getImage();
const ANCHO = imagen.getWidth(); // 21600: 1 minuto de arco por píxel
const POR_GRADO = ANCHO / 360;

/** Recorta [lonO, latS, lonE, latN] reduciendo `factor` veces (media de cada bloque) y lo guarda en JPEG. */
async function recorte(nombre, [lonO, latS, lonE, latN], factor) {
  const x0 = Math.round((lonO + 180) * POR_GRADO);
  const x1 = Math.round((lonE + 180) * POR_GRADO);
  const y0 = Math.round((90 - latN) * POR_GRADO);
  const y1 = Math.round((90 - latS) * POR_GRADO);
  const ancho = Math.floor((x1 - x0) / factor);
  const alto = Math.floor((y1 - y0) / factor);
  const rgba = Buffer.alloc(ancho * alto * 4);
  for (let fila = 0; fila < alto; fila++) {
    const banda = await imagen.readRasters({ window: [x0, y0 + fila * factor, x0 + ancho * factor, y0 + (fila + 1) * factor], interleave: true });
    const anchoBanda = ancho * factor;
    for (let col = 0; col < ancho; col++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = (dy * anchoBanda + col * factor + dx) * 3;
          r += banda[i];
          g += banda[i + 1];
          b += banda[i + 2];
        }
      }
      const n = factor * factor;
      const o = (fila * ancho + col) * 4;
      rgba[o] = r / n;
      rgba[o + 1] = g / n;
      rgba[o + 2] = b / n;
      rgba[o + 3] = 255;
    }
  }
  const datos = jpeg.encode({ data: rgba, width: ancho, height: alto }, 82).data;
  fs.writeFileSync(path.join(salida, `relieve-${nombre}.jpg`), datos);
  console.log(`relieve-${nombre}.jpg: ${ancho}×${alto}, [${lonO}, ${latS}, ${lonE}, ${latN}] (${Math.round(datos.length / 1024)} KB)`);
}

await recorte('iberia', [-18.5, 27, 5.5, 44.6], 1);
await recorte('europa', [-32, 18, 68, 74], 3);
await recorte('mundo', [-180, -90, 180, 90], 10);
