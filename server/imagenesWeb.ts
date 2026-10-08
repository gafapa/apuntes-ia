// Búsqueda de imágenes con licencia libre en museos, bibliotecas y archivos (historia, arte,
// ciencia…). Cada fuente tiene su adaptador, que normaliza los resultados y aplica su propio
// control de derechos: solo pasa lo que la institución declara expresamente como dominio
// público, CC0, CC BY o CC BY-SA. Lo que no lo declare, o tenga una licencia no comercial o sin
// obras derivadas, se descarta (inspirado en open-museum-mcp y archival-imagery-mcp).
import fs from 'node:fs/promises';
import path from 'node:path';
import { dimensiones } from './imagenes';

import type { BusquedaImagenes, FuenteImagen, ResultadoImagen } from '../shared/tipos';
export type { BusquedaImagenes, FuenteImagen, ResultadoImagen };

export interface ClavesImagenes {
  europeana?: string;
  smithsonian?: string;
}

export const NOMBRES_FUENTES: Record<FuenteImagen, string> = {
  commons: 'Wikimedia Commons',
  openverse: 'Openverse',
  met: 'Metropolitan Museum of Art',
  aic: 'Art Institute of Chicago',
  cleveland: 'Cleveland Museum of Art',
  wellcome: 'Wellcome Collection',
  europeana: 'Europeana',
  smithsonian: 'Smithsonian',
};

const UA = 'ApuntesIA/1.0 (aplicacion educativa)';
const POR_FUENTE = 8;

async function pedirJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}

const sinHtml = (s?: string) =>
  s
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    // Restos de las plantillas de Wikidata en Commons: «date QS:P571,+1887…», «label QS:Len,"…"»
    .replace(/\s*\b(?:date|label|title)\s+QS:.*$/s, '')
    .replace(/\s+/g, ' ')
    .trim() || undefined;

/** Limpia los campos de texto de un resultado (espacios y saltos sobrantes). */
function limpiar(r: ResultadoImagen): ResultadoImagen {
  const t = (s?: string) => s?.replace(/\s+/g, ' ').trim() || undefined;
  return { ...r, titulo: t(r.titulo) ?? 'Sin título', autor: t(r.autor), fecha: t(r.fecha), institucion: t(r.institucion) ?? r.institucion };
}

/** Normaliza el nombre de una licencia y dice si permite reutilizar (sin NC ni ND). */
function licenciaLibre(texto: string | undefined): string | undefined {
  const t = (texto ?? '').toLowerCase().replace(/_/g, '-');
  if (!t) return undefined;
  if (/\bnc\b|noncommercial|non-commercial|\bnd\b|noderiv|no-deriv|in ?copyright|incopyright|rightsreserved|all rights/.test(t)) return undefined;
  if (/publicdomain\/zero|\bcc0\b|cc-zero/.test(t)) return 'CC0';
  if (/publicdomain\/mark|public domain|dominio p[uú]blico|^pdm?$|\bpd-?(art|old|self|author|text|scan|ineligible)/.test(t)) return 'Dominio público';
  const by = t.match(/(?:cc[- ]?)?by(-sa)?[- ]?(\d\.\d)?/);
  if (/creativecommons\.org\/licenses\/by(-sa)?\/(\d\.\d)/.test(t)) {
    const m = t.match(/licenses\/by(-sa)?\/(\d\.\d)/)!;
    return `CC BY${m[1] ? '-SA' : ''} ${m[2]}`;
  }
  if (/^cc[- ]by/.test(t) && by) return `CC BY${by[1] ? '-SA' : ''}${by[2] ? ` ${by[2]}` : ''}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Adaptadores

/** Wikimedia Commons: licencia en extmetadata; se rechaza el dominio público solo de EE. UU. */
async function commons(q: string): Promise<ResultadoImagen[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6' +
    `&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&gsrlimit=${POR_FUENTE * 2}` +
    '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1280' +
    '&iiextmetadatafilter=License|LicenseShortName|Artist|ObjectName|DateTimeOriginal|Credit';
  const d = await pedirJson<{ query?: { pages?: Record<string, any> } }>(url);
  const res: ResultadoImagen[] = [];
  for (const p of Object.values(d.query?.pages ?? {}).sort((a, b) => a.index - b.index)) {
    const ii = p.imageinfo?.[0];
    const meta = ii?.extmetadata ?? {};
    const valor = String(meta.License?.value ?? '');
    if (!ii || /^pd-us|pd-1923|pd-usgov/i.test(valor)) continue; // dominio público solo en EE. UU.
    const licencia = licenciaLibre(valor) ?? licenciaLibre(meta.LicenseShortName?.value);
    if (!licencia) continue;
    const grande = String(ii.thumburl ?? ii.url).replace(/\?utm_.*$/, ''); // sin parámetros de seguimiento
    res.push({
      id: `commons:${p.pageid}`,
      fuente: 'commons',
      titulo: sinHtml(meta.ObjectName?.value) ?? String(p.title).replace(/^File:|\.\w+$/g, ''),
      autor: sinHtml(meta.Artist?.value)?.slice(0, 120),
      fecha: sinHtml(meta.DateTimeOriginal?.value)?.slice(0, 40),
      institucion: 'Wikimedia Commons',
      licencia,
      pagina: ii.descriptionurl,
      miniatura: grande.replace(/\/\d+px-/, '/330px-'), // Commons solo sirve miniaturas de tamaños estándar
      imagen: grande,
      ancho: ii.width,
      alto: ii.height,
    });
    if (res.length >= POR_FUENTE) break;
  }
  return res;
}

/** Openverse: agrega Flickr Commons, museos y otras colecciones con licencias Creative Commons. */
async function openverse(q: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ results: any[] }>(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=by,by-sa,cc0,pdm&page_size=${POR_FUENTE * 2}&excluded_source=wikimedia`,
  );
  return d.results
    .map((r): ResultadoImagen | undefined => {
      const licencia = r.license === 'cc0' ? 'CC0' : r.license === 'pdm' ? 'Dominio público' : licenciaLibre(`cc-${r.license}-${r.license_version ?? ''}`);
      if (!licencia || !r.url) return undefined;
      return {
        id: `openverse:${r.id}`,
        fuente: 'openverse',
        titulo: r.title || 'Sin título',
        autor: r.creator || undefined,
        institucion: String(r.source ?? r.provider ?? 'Openverse').replace(/_/g, ' '),
        licencia,
        pagina: r.foreign_landing_url ?? r.url,
        miniatura: r.thumbnail ?? r.url,
        imagen: r.url,
        ancho: r.width ?? undefined,
        alto: r.height ?? undefined,
      };
    })
    .filter((x): x is ResultadoImagen => !!x)
    .slice(0, POR_FUENTE);
}

/** Met: la búsqueda solo da identificadores; cada objeto se vuelve a comprobar (isPublicDomain). */
const objetosMet = new Map<number, any>();
async function met(q: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ objectIDs?: number[] }>(
    `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&isPublicDomain=true&q=${encodeURIComponent(q)}`,
  );
  const ids = (d.objectIDs ?? []).slice(0, POR_FUENTE + 4);
  const objetos = await Promise.all(
    ids.map(async (id) => {
      if (!objetosMet.has(id)) {
        objetosMet.set(id, await pedirJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null));
      }
      return objetosMet.get(id);
    }),
  );
  return objetos
    .filter((o) => o && o.isPublicDomain === true && o.primaryImage)
    .slice(0, POR_FUENTE)
    .map((o) => ({
      id: `met:${o.objectID}`,
      fuente: 'met' as const,
      titulo: o.title || 'Sin título',
      autor: o.artistDisplayName || o.culture || undefined,
      fecha: o.objectDate || undefined,
      institucion: NOMBRES_FUENTES.met,
      licencia: 'CC0',
      pagina: o.objectURL,
      miniatura: o.primaryImageSmall || o.primaryImage,
      imagen: o.primaryImageSmall || o.primaryImage, // «web-large»: suficiente para A4 y mucho más ligera
    }));
}

/** Art Institute of Chicago: is_public_domain; imágenes por IIIF. */
async function aic(q: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ data: any[]; config?: { iiif_url?: string } }>(
    `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true` +
      `&fields=id,title,image_id,artist_display,date_display,is_public_domain&limit=${POR_FUENTE}`,
    { headers: { 'AIC-User-Agent': UA } },
  );
  const iiif = d.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';
  return d.data
    .filter((o) => o.is_public_domain === true && o.image_id)
    .map((o) => ({
      id: `aic:${o.id}`,
      fuente: 'aic' as const,
      titulo: o.title || 'Sin título',
      autor: o.artist_display?.split('\n')[0] || undefined,
      fecha: o.date_display || undefined,
      institucion: NOMBRES_FUENTES.aic,
      licencia: 'CC0',
      pagina: `https://www.artic.edu/artworks/${o.id}`,
      miniatura: `${iiif}/${o.image_id}/full/400,/0/default.jpg`,
      imagen: `${iiif}/${o.image_id}/full/1686,/0/default.jpg`,
    }));
}

/** Cleveland Museum of Art: share_license_status === CC0. */
async function cleveland(q: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ data: any[] }>(
    `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&has_image=1&cc0=1&limit=${POR_FUENTE}`,
  );
  return d.data
    .filter((o) => String(o.share_license_status).toUpperCase() === 'CC0' && o.images?.web?.url)
    .map((o) => ({
      id: `cleveland:${o.id}`,
      fuente: 'cleveland' as const,
      titulo: o.title || 'Sin título',
      autor: o.creators?.[0]?.description || o.culture?.[0] || undefined,
      fecha: o.creation_date || undefined,
      institucion: NOMBRES_FUENTES.cleveland,
      licencia: 'CC0',
      pagina: o.url,
      miniatura: o.images.web.url,
      imagen: o.images.web.url, // la de impresión pesa varios MB
      ancho: Number(o.images.web.width) || undefined,
      alto: Number(o.images.web.height) || undefined,
    }));
}

/** Wellcome Collection (historia de la medicina y la ciencia): licencia por imagen. */
async function wellcome(q: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ results: any[] }>(
    `https://api.wellcomecollection.org/catalogue/v2/images?query=${encodeURIComponent(q)}&pageSize=${POR_FUENTE * 2}&locations.license=cc-0,cc-by,pdm`,
  );
  return d.results
    .map((r): ResultadoImagen | undefined => {
      const loc = r.locations?.[0];
      const id = loc?.license?.id;
      const licencia = id === 'cc-0' ? 'CC0' : id === 'pdm' ? 'Dominio público' : id === 'cc-by' ? 'CC BY 4.0' : undefined;
      if (!licencia || !loc?.url) return undefined;
      const base = String(loc.url).replace(/\/info\.json$/, '');
      return {
        id: `wellcome:${r.id}`,
        fuente: 'wellcome',
        titulo: r.source?.title || 'Sin título',
        autor: r.source?.contributors?.[0]?.agent?.label,
        institucion: NOMBRES_FUENTES.wellcome,
        licencia,
        pagina: `https://wellcomecollection.org/works/${r.source?.id}`,
        miniatura: `${base}/full/400,/0/default.jpg`,
        imagen: `${base}/full/1600,/0/default.jpg`,
      };
    })
    .filter((x): x is ResultadoImagen => !!x)
    .slice(0, POR_FUENTE);
}

/** Europeana (incluye Hispana y bibliotecas y archivos españoles): derechos por URI. */
async function europeana(q: string, clave: string): Promise<ResultadoImagen[]> {
  const base =
    `https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(clave)}&query=${encodeURIComponent(q)}` +
    `&reusability=open&media=true&qf=TYPE:IMAGE&profile=standard&rows=${POR_FUENTE}`;
  // Primero los fondos españoles y luego el resto de Europa
  const [espana, resto] = await Promise.all([
    pedirJson<{ items?: any[] }>(`${base}&qf=COUNTRY:spain`).catch(() => ({ items: [] })),
    pedirJson<{ items?: any[] }>(base),
  ]);
  const vistos = new Set<string>();
  return [...(espana.items ?? []), ...(resto.items ?? [])]
    .map((x): ResultadoImagen | undefined => {
      const licencia = licenciaLibre(x.rights?.[0]);
      const imagen = x.edmIsShownBy?.[0] ?? x.edmPreview?.[0];
      if (!licencia || !imagen || vistos.has(x.id)) return undefined;
      vistos.add(x.id);
      return {
        id: `europeana:${x.id}`,
        fuente: 'europeana',
        titulo: x.title?.[0] || 'Sin título',
        autor: x.dcCreator?.find((c: string) => !/^https?:/.test(c)),
        fecha: x.year?.[0],
        institucion: x.dataProvider?.[0] ?? 'Europeana',
        licencia,
        pagina: x.guid ?? `https://www.europeana.eu/item${x.id}`,
        miniatura: x.edmPreview?.[0] ?? imagen,
        imagen,
      };
    })
    .filter((x): x is ResultadoImagen => !!x)
    .slice(0, POR_FUENTE);
}

/** Smithsonian Open Access: usage.access === CC0. */
async function smithsonian(q: string, clave: string): Promise<ResultadoImagen[]> {
  const d = await pedirJson<{ response?: { rows?: any[] } }>(
    `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${q} AND online_media_type:"Images"`)}&rows=${POR_FUENTE * 2}&api_key=${encodeURIComponent(clave)}`,
  );
  return (d.response?.rows ?? [])
    .map((r): ResultadoImagen | undefined => {
      const dn = r.content?.descriptiveNonRepeating;
      const media = dn?.online_media?.media?.find((m: any) => m.type === 'Images' && m.usage?.access === 'CC0');
      if (!media) return undefined;
      return {
        id: `smithsonian:${r.id}`,
        fuente: 'smithsonian',
        titulo: r.title || dn?.title?.content || 'Sin título',
        autor: r.content?.freetext?.name?.[0]?.content,
        fecha: r.content?.freetext?.date?.[0]?.content,
        institucion: dn?.data_source ?? NOMBRES_FUENTES.smithsonian,
        licencia: 'CC0',
        pagina: dn?.record_link ?? media.content,
        miniatura: media.thumbnail ?? media.content,
        imagen: media.content,
      };
    })
    .filter((x): x is ResultadoImagen => !!x)
    .slice(0, POR_FUENTE);
}

// ---------------------------------------------------------------------------


/**
 * Busca en todas las fuentes a la vez. `consulta` va a los museos (que catalogan en inglés);
 * `consultaLocal`, si se da, a Commons y Europeana, que tienen muchos fondos en español.
 */
export async function buscarImagenes(
  consulta: string,
  op: { consultaLocal?: string; claves?: ClavesImagenes; fuentes?: FuenteImagen[] } = {},
): Promise<BusquedaImagenes> {
  const q = consulta.trim();
  const local = op.consultaLocal?.trim() || q;
  const claves = op.claves ?? {};
  const todas: [FuenteImagen, () => Promise<ResultadoImagen[]>][] = [
    ['commons', () => commons(local)],
    ['europeana', () => (claves.europeana ? europeana(local, claves.europeana) : Promise.reject(new Error('sin clave')))],
    ['met', () => met(q)],
    ['aic', () => aic(q)],
    ['cleveland', () => cleveland(q)],
    ['wellcome', () => wellcome(q)],
    ['smithsonian', () => (claves.smithsonian ? smithsonian(q, claves.smithsonian) : Promise.reject(new Error('sin clave')))],
    ['openverse', () => openverse(q)],
  ];
  const elegidas = todas.filter(([f]) => !op.fuentes || op.fuentes.includes(f));
  const respuestas = await Promise.allSettled(elegidas.map(([, fn]) => fn()));
  const fuentes = elegidas.map(([f], i) => {
    const r = respuestas[i];
    return r.status === 'fulfilled'
      ? { fuente: f, nombre: NOMBRES_FUENTES[f], n: r.value.length }
      : { fuente: f, nombre: NOMBRES_FUENTES[f], n: 0, error: (r.reason as Error).message };
  });
  // Intercalados (el primero de cada fuente, luego el segundo…) para que ninguna acapare
  const listas = respuestas.map((r) => (r.status === 'fulfilled' ? r.value.map(limpiar) : []));
  const resultados: ResultadoImagen[] = [];
  const urls = new Set<string>();
  for (let i = 0; i < POR_FUENTE; i++) {
    for (const l of listas) {
      const x = l[i];
      if (x && !urls.has(x.imagen)) {
        urls.add(x.imagen);
        resultados.push(x);
      }
    }
  }
  return { resultados, fuentes };
}

/** Servidores de los que se admiten miniaturas a través de la app (evita usarla como proxy abierto). */
const HOSTS_MINIATURAS = /(^|\.)(wikimedia\.org|openverse\.org|staticflickr\.com|flickr\.com|metmuseum\.org|artic\.edu|clevelandart\.org|wellcomecollection\.org|europeana\.eu|si\.edu|[a-z0-9-]+\.es)$/i;

/**
 * Descarga una miniatura para mostrarla en la interfaz: algunos museos (el Art Institute of
 * Chicago) no dejan que el navegador las cargue desde otra web, pero sí la app con su cabecera.
 */
export async function miniatura(url: string): Promise<{ tipo: string; datos: Buffer }> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !HOSTS_MINIATURAS.test(u.hostname)) throw new Error('Servidor no admitido');
  const r = await fetch(u, {
    headers: { 'User-Agent': UA, ...(/artic\.edu$/.test(u.hostname) ? { 'AIC-User-Agent': UA } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  const tipo = r.headers.get('content-type') ?? '';
  if (!r.ok || !tipo.startsWith('image/')) throw new Error(`No disponible (${r.status})`);
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > 5 * 1024 * 1024) throw new Error('Demasiado grande');
  return { tipo, datos };
}

/** Crédito al estilo de los museos: «Autor, Título, fecha. Institución · licencia». */
export function credito(r: Pick<ResultadoImagen, 'titulo' | 'autor' | 'fecha' | 'institucion' | 'licencia'>): string {
  const obra = [r.autor, r.titulo && `«${r.titulo.replace(/[*_]/g, '')}»`, r.fecha].filter(Boolean).join(', ');
  return `${obra}. ${r.institucion} · ${r.licencia}`;
}

/** Descarga una imagen de internet a la carpeta de recursos y devuelve el nombre del archivo. */
export async function descargarImagen(url: string, dir: string, base: string): Promise<string> {
  // Una página de Wikimedia Commons («…/wiki/File:X.jpg») se convierte en el enlace al archivo
  const commons = url.match(/^https?:\/\/commons\.(?:m\.)?wikimedia\.org\/wiki\/(?:File|Archivo):(.+)$/i);
  if (commons) url = `https://commons.wikimedia.org/wiki/Special:FilePath/${commons[1]}`;
  let ultimo: Error | undefined;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      return await descargarUnaVez(url, dir, base);
    } catch (e) {
      ultimo = e as Error;
      const espera = (e as { espera?: number }).espera;
      if (espera === undefined) break; // error definitivo (404, no es una imagen…): no se reintenta
      if (intento < 3) await new Promise((r) => setTimeout(r, espera || intento * 3000));
    }
  }
  throw ultimo!;
}

async function descargarUnaVez(url: string, dir: string, base: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  // Error que merece otro intento (red, tiempo agotado, servidor saturado), con la espera sugerida
  const temporal = (msg: string, espera = 0) => Object.assign(new Error(msg), { espera });
  try {
    let r: Response;
    try {
      // El Art Institute of Chicago pide identificarse con su cabecera propia para servir las imágenes
      r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, ...(/artic\.edu/.test(url) ? { 'AIC-User-Agent': UA } : {}) } });
    } catch (e) {
      throw temporal(`No se pudo conectar para descargar la imagen (${(e as Error).name === 'AbortError' ? 'tiempo agotado' : (e as Error).message}).`);
    }
    if (r.status === 429 || r.status >= 500) {
      const s = Number(r.headers.get('retry-after'));
      throw temporal(`No se pudo descargar la imagen (${r.status}).`, s > 0 ? Math.min(s, 20) * 1000 : 0);
    }
    if (!r.ok) throw new Error(`No se pudo descargar la imagen (${r.status}).`);
    const tipo = r.headers.get('content-type') ?? '';
    const ext = /png/.test(tipo) ? 'png' : /jpe?g/.test(tipo) ? 'jpg' : /svg/.test(tipo) ? 'svg' : /webp/.test(tipo) ? 'webp' : /gif/.test(tipo) ? 'gif' : '';
    if (!ext) throw new Error(`La URL no es una imagen (${tipo || 'tipo desconocido'}).`);
    const datos = Buffer.from(await r.arrayBuffer());
    if (datos.length > 20 * 1024 * 1024) throw new Error('La imagen es demasiado grande (más de 20 MB).');
    await fs.mkdir(dir, { recursive: true });
    const nombre = `${base}.${ext}`;
    const ruta = path.join(dir, nombre);
    await fs.writeFile(ruta, datos);
    if (!dimensiones(ruta)) {
      await fs.rm(ruta, { force: true });
      throw temporal('La imagen descargada está incompleta o dañada.');
    }
    return nombre;
  } finally {
    clearTimeout(t);
  }
}
