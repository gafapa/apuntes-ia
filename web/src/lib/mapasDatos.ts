// Datos de los mapas: límites actuales (es-atlas y Natural Earth), capas físicas y relieve
// (web/src/lib/datos-mapas, de scripts/datos-mapas.mjs) y fronteras históricas (las descarga el
// servidor del atlas historical-basemaps). Todo se carga solo cuando un mapa lo necesita.
import { feature, mesh } from 'topojson-client';
import urlRelieveIberia from './datos-mapas/relieve-iberia.jpg';
import urlRelieveEuropa from './datos-mapas/relieve-europa.jpg';
import urlRelieveMundo from './datos-mapas/relieve-mundo.jpg';

/** [oeste, sur, este, norte] en grados. */
export type Caja = [number, number, number, number];

const memo = <T>(f: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= f().catch((e) => ((p = undefined), Promise.reject(e))));
};
const json = (m: any) => m.default ?? m;

export const comunidades = memo(async () => {
  const t = json(await import('es-atlas/es/autonomous_regions.json'));
  return { regiones: (feature(t, t.objects.autonomous_regions) as any).features as any[], borde: mesh(t, t.objects.border) as any };
});
export const provincias = memo(async () => {
  const t = json(await import('es-atlas/es/provinces.json'));
  return { regiones: (feature(t, t.objects.provinces) as any).features as any[], borde: mesh(t, t.objects.border) as any };
});
export const paises = memo(async () => {
  const t = json(await import('world-atlas/countries-50m.json'));
  return (feature(t, t.objects.countries) as any).features as any[];
});
export const tierra = memo(async () => {
  const t = json(await import('world-atlas/land-50m.json'));
  return feature(t, t.objects.land) as any;
});

export interface Fisico {
  rios: any[];
  lagos: any[];
  sierras: any[];
  cimas: any[];
}
export const fisico = memo(async (): Promise<Fisico> => {
  const t = json(await import('./datos-mapas/fisico.json'));
  const capa = (n: string) => (feature(t, t.objects[n]) as any).features as any[];
  return { rios: capa('rios'), lagos: capa('lagos'), sierras: capa('sierras'), cimas: capa('cimas') };
});

// ---------- Relieve (colores de altitud con sombreado, en proyección equirectangular) ----------

export interface Relieve {
  caja: Caja;
  ancho: number;
  alto: number;
  datos: Uint8ClampedArray;
}
const IMAGENES: { url: string; caja: Caja }[] = [
  { url: urlRelieveIberia, caja: [-18.5, 27, 5.5, 44.6] },
  { url: urlRelieveEuropa, caja: [-32, 18, 68, 74] },
  { url: urlRelieveMundo, caja: [-180, -90, 180, 90] },
];
const cargarImagen = (url: string, caja: Caja) =>
  memo(async (): Promise<Relieve> => {
    // onload y no decode(): decode() no termina mientras la ventana está oculta o minimizada
    const img = new Image();
    await new Promise<void>((ok, mal) => {
      img.onload = () => ok();
      img.onerror = () => mal(new Error('No se pudo cargar el relieve'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    return { caja, ancho: c.width, alto: c.height, datos: g.getImageData(0, 0, c.width, c.height).data };
  });
const relieves = IMAGENES.map((i) => cargarImagen(i.url, i.caja));

/** Las imágenes de relieve que cubren la caja, de la más detallada a la más general. */
export async function relieve(caja: Caja): Promise<Relieve[]> {
  const solapa = (c: Caja) => c[0] < caja[2] && c[2] > caja[0] && c[1] < caja[3] && c[3] > caja[1];
  const usadas = IMAGENES.map((img, i) => ({ img, i })).filter(({ img }) => solapa(img.caja));
  return Promise.all(usadas.map(({ i }) => relieves[i]()));
}

// ---------- Fronteras históricas ----------

const historicos = new Map<number, Promise<any[]>>();
export function fronteras(año: number): Promise<any[]> {
  let p = historicos.get(año);
  if (!p) {
    p = fetch(`/api/mapas/fronteras/${año}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? 'No se pudieron cargar las fronteras históricas');
        return ((d.features ?? []) as any[]).filter((f) => f.geometry && f.properties?.NAME);
      })
      .catch((e) => {
        historicos.delete(año);
        throw e;
      });
    historicos.set(año, p);
  }
  return p;
}

// ---------- Nombres ----------

export const normalizar = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Países en español → nombre en Natural Earth (inglés). */
export const PAISES: Record<string, string> = {
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
  libano: 'Lebanon', jordania: 'Jordan', palestina: 'Palestine', afganistan: 'Afghanistan', pakistan: 'Pakistan', mongolia: 'Mongolia',
  kazajistan: 'Kazakhstan', indonesia: 'Indonesia', tailandia: 'Thailand', vietnam: 'Vietnam', nigeria: 'Nigeria', etiopia: 'Ethiopia',
  kenia: 'Kenya', congo: 'Congo', republicademocraticadelcongo: 'Dem. Rep. Congo', angola: 'Angola', mauritania: 'Mauritania',
  mali: 'Mali', senegal: 'Senegal', sudan: 'Sudan', groenlandia: 'Greenland', georgia: 'Georgia', armenia: 'Armenia', azerbaiyan: 'Azerbaijan',
};

/** Estados y pueblos del atlas histórico (en inglés) → español. Lo que no está aquí se muestra tal cual. */
const HISTORICOS: Record<string, string> = {
  'Akatziri': 'Acatziros', 'Alamans': 'Alamanes', 'Alans': 'Alanos', 'Algeria': 'Argelia', 'Algeria (France)': 'Argelia (Francia)',
  'Algiers': 'Argel', 'Almohad Caliphate': 'Califato almohade', 'Almoravid dynasty': 'Imperio almorávide', 'Angevin Empire': 'Imperio angevino',
  'Arabs': 'Árabes', 'Austrian Empire': 'Imperio austriaco', 'Austrian Netherlands': 'Países Bajos austriacos',
  'Austro-Hungarian Empire': 'Imperio austrohúngaro', 'Avars': 'Ávaros', 'Azerbaijan': 'Azerbaiyán', 'Baltic tribes': 'Pueblos bálticos',
  'Balts': 'Bálticos', 'Bavaria': 'Baviera', 'Belgium': 'Bélgica', 'Berber Tribes': 'Tribus bereberes', 'Bosporan Kingdom': 'Reino del Bósforo',
  'Bosporian Kingdom': 'Reino del Bósforo', 'Brandenburg': 'Brandeburgo', 'Britany': 'Bretaña', 'Bulgar Khanate': 'Kanato búlgaro',
  'Bulgars': 'Búlgaros', 'Burgandy': 'Borgoña', 'Burgundy': 'Borgoña', 'Burgundians': 'Burgundios', 'Buwayhid Emirates': 'Emiratos búyidas',
  'Byzantine Empire': 'Imperio bizantino', 'Caliphate of Córdoba': 'Califato de Córdoba', 'Emirate of Córdoba': 'Emirato de Córdoba',
  'Carthage': 'Cartago', 'Carthaginian Empire': 'Cartago', 'Castille': 'Castilla', 'Castile': 'Castilla', 'Crown of Castile': 'Corona de Castilla',
  'Crown of Aragon': 'Corona de Aragón', 'Celtic kingdoms': 'Reinos celtas', 'Celts': 'Celtas', 'Celtiberians': 'Celtíberos',
  'Iberians': 'Íberos', 'Lusitanians': 'Lusitanos', 'Corsica': 'Córcega', 'Crimean Khanate': 'Kanato de Crimea', 'Croatia': 'Croacia',
  'Cuman Khanates': 'Kanatos cumanos', 'Cyprus': 'Chipre', 'Cyrenaica': 'Cirenaica', 'Czechoslovakia': 'Checoslovaquia', 'Czechs': 'Checos',
  'Danes': 'Daneses', 'Danube Bulgars': 'Búlgaros del Danubio', 'Denmark': 'Dinamarca', 'Denmark-Norway': 'Dinamarca-Noruega',
  'Duchy of Benevento': 'Ducado de Benevento', 'Duchy of Swabia': 'Ducado de Suabia', 'Dutch Republic': 'Provincias Unidas',
  'Eastern Roman Empire': 'Imperio romano de Oriente', 'Western Roman Empire': 'Imperio romano de Occidente', 'Egypt': 'Egipto',
  'Emirate of Sicily': 'Emirato de Sicilia', 'Emirate of Granada': 'Reino nazarí de Granada', 'Granada': 'Reino nazarí de Granada',
  'England': 'Inglaterra', 'England and Ireland': 'Inglaterra e Irlanda', 'Fatimid Caliphate': 'Califato fatimí', 'Finland': 'Finlandia',
  'Florence': 'Florencia', 'France': 'Francia', 'Frankish Kingdom': 'Reino franco', 'Franks': 'Francos', 'Frisians': 'Frisones',
  'Genoa': 'Génova', 'Georgian Kingdom': 'Reino de Georgia', 'Kingdom of Georgia': 'Reino de Georgia', 'Gepids': 'Gépidos',
  'German Empire': 'Imperio alemán', 'Germany': 'Alemania', 'Golden Horde': 'Horda de Oro', 'Goths': 'Godos',
  'Grand Duchy of Moscow': 'Gran Ducado de Moscú', 'Greece': 'Grecia', 'Greek city-states': 'Polis griegas', 'Habsburg Netherlands': 'Países Bajos de los Habsburgo',
  'Hafsid Caliphate': 'Califato hafsí', 'Hanover': 'Hannover', 'Hejaz': 'Hiyaz', 'Holy Roman Empire': 'Sacro Imperio Romano Germánico',
  'Hungary': 'Hungría', 'Kingdom of Hungary': 'Reino de Hungría', 'Hunnic Empire': 'Imperio huno', 'Huns': 'Hunos', 'Iran': 'Irán',
  'Iraq': 'Irak', 'Ireland': 'Irlanda', 'Italy': 'Italia', 'Jordan': 'Jordania', 'Khazars': 'Jázaros', 'Kingdom of France': 'Reino de Francia',
  'Kingdom of Ireland': 'Reino de Irlanda', 'Kingdom of Italy': 'Reino de Italia', 'Kingdom of Sardinia': 'Reino de Cerdeña',
  'Kingdom of the Two Sicilies': 'Reino de las Dos Sicilias', 'Kingdom of Naples': 'Reino de Nápoles', 'Kingdom of Sicily': 'Reino de Sicilia',
  'Kingdom of England': 'Reino de Inglaterra', 'Kingdom of Scotland': 'Reino de Escocia', 'Kingdom of Poland': 'Reino de Polonia',
  'Kingdom of Portugal': 'Reino de Portugal', 'Kingdom of Asturias': 'Reino de Asturias', 'Kyivan Rus': 'Rus de Kiev', 'Latvia': 'Letonia',
  'Lebanon': 'Líbano', 'Libya': 'Libia', 'Lithuania': 'Lituania', 'Lombard principalities': 'Principados lombardos', 'Lombardy': 'Lombardía',
  'Luxembourg': 'Luxemburgo', 'Macedon and Hellenic League': 'Macedonia y Liga helénica', 'Macedon': 'Macedonia', 'Magyars': 'Magiares',
  'Mamluke Sultanate': 'Sultanato mameluco', 'Mandatory Palestine (GB)': 'Mandato británico de Palestina', 'Mauretania': 'Mauritania',
  'Mauri': 'Mauros', 'Milan': 'Milán', 'Mongol Empire': 'Imperio mongol', 'Moravians': 'Moravos', 'Morocco': 'Marruecos',
  'Morocco (France)': 'Marruecos (Francia)', 'Nabatean Kingdom': 'Reino nabateo', 'Naples': 'Nápoles', 'Navarre': 'Navarra',
  'Netherlands': 'Países Bajos', 'Norsemen': 'Nórdicos', 'Norway': 'Noruega', 'Odrysian Kingdom': 'Reino odrisio', 'Ostrogoths': 'Ostrogodos',
  'Ostrogothic Kingdom': 'Reino ostrogodo', 'Ottoman Empire': 'Imperio otomano', 'Papal States': 'Estados Pontificios',
  'Parthian Empire': 'Imperio parto', 'Pergamon': 'Pérgamo', 'Poland': 'Polonia', 'Poland-Lithuania': 'Polonia-Lituania',
  'Polish–Lithuanian Commonwealth': 'República de las Dos Naciones', 'Principality of Kyiv': 'Principado de Kiev',
  'Principality of Novgorod': 'República de Nóvgorod', 'Prussia': 'Prusia', 'Prussians': 'Prusianos', 'Ptolemaic Kingdom': 'Reino ptolemaico',
  'Roman Empire': 'Imperio romano', 'Roman Republic': 'República romana', 'Romania': 'Rumanía', 'Rome': 'Roma', 'Russian Empire': 'Imperio ruso',
  'Safavid Empire': 'Imperio safávida', 'Sardinia': 'Cerdeña', 'Sardinia-Piedmont': 'Cerdeña-Piamonte', 'Sasanian Empire': 'Imperio sasánida',
  'Saudi Arabia': 'Arabia Saudí', 'Savoy': 'Saboya', 'Saxons': 'Sajones', 'Saxony': 'Sajonia', 'Scotland': 'Escocia', 'Scythians': 'Escitas',
  'Seleucid Kingdom': 'Imperio seléucida', 'Achaemenid Empire': 'Imperio aqueménida', 'Sicily': 'Sicilia', 'Slavs': 'Eslavos', 'Spain': 'España',
  'Spanish Morocco': 'Marruecos español', 'Suebi': 'Suevos', 'Kingdom of the Suebi': 'Reino suevo', 'Sweden': 'Suecia',
  'Sweden–Norway': 'Suecia-Noruega', 'Swiss Confederation': 'Confederación Suiza', 'Switzerland': 'Suiza', 'Syria': 'Siria',
  'Syria (France)': 'Siria (Francia)', 'Teutonic Knights': 'Orden Teutónica', 'Thuringia': 'Turingia', 'Tsardom of Muscovy': 'Zarato ruso',
  'Tunis': 'Túnez', 'Tunisia': 'Túnez', 'Turkey': 'Turquía', 'Tuscany': 'Toscana', 'USSR': 'URSS', 'Umayyad Caliphate': 'Califato omeya',
  'United Kingdom': 'Reino Unido', 'United Kingdom of Great Britain and Ireland': 'Reino Unido', 'Vandals': 'Vándalos',
  'Vandal Kingdom': 'Reino vándalo', 'Venice': 'Venecia', 'Republic of Venice': 'República de Venecia', 'Visigothic Kingdom': 'Reino visigodo',
  'Visigoths': 'Visigodos', 'Volga Bulgars': 'Búlgaros del Volga', 'Yugoslavia': 'Yugoslavia', 'Zayyanid Caliphate': 'Sultanato zayyaní',
  'Wattasid Caliphate': 'Sultanato wattasí', 'Watassid Morocco': 'Sultanato wattasí', 'Marinid Sultanate': 'Sultanato benimerín',
  'Ilkhanate': 'Iljanato', 'Persia': 'Persia', 'Mesopotamia (GB)': 'Mesopotamia (Reino Unido)', 'Arabia (Nejd)': 'Arabia (Néyed)',
  'Germany (France)': 'Alemania (zona francesa)', 'Germany (UK)': 'Alemania (zona británica)', 'Germany (USA)': 'Alemania (zona estadounidense)',
  'Germany (Soviet)': 'Alemania (zona soviética)', 'Saharan Nomadic Tribes': 'Nómadas del Sáhara', 'Tuareg Nomadic Tribes': 'Tuaregs',
  'minor states': 'Estados menores',
  'Iceland': 'Islandia', 'Monaco': 'Mónaco', 'Ukraine': 'Ucrania', 'Belarus': 'Bielorrusia', 'Russia': 'Rusia', 'Moldova': 'Moldavia',
  'Czechia': 'Chequia', 'Czech Republic': 'República Checa', 'Slovakia': 'Eslovaquia', 'Slovenia': 'Eslovenia', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'North Macedonia': 'Macedonia del Norte', 'Macedonia': 'Macedonia', 'Sudan': 'Sudán', 'Ethiopia': 'Etiopía', 'Afghanistan': 'Afganistán',
  'Pakistan': 'Pakistán', 'Kazakhstan': 'Kazajistán', 'Japan': 'Japón', 'Korea': 'Corea', 'Philippines': 'Filipinas', 'Brazil': 'Brasil',
  'Mexico': 'México', 'Canada': 'Canadá', 'Peru': 'Perú', 'United States': 'Estados Unidos', 'United States of America': 'Estados Unidos',
  'South Africa': 'Sudáfrica', 'Soviet Union': 'URSS', 'Qing Empire': 'Imperio Qing', 'Ming Chinese Empire': 'Imperio Ming',
  'Mughal Empire': 'Imperio mogol', 'Aztec Empire': 'Imperio azteca', 'Inca Empire': 'Imperio inca', 'Mali Empire': 'Imperio de Malí',
  'Songhai Empire': 'Imperio songhai', 'Abbasid Caliphate': 'Califato abasí', 'Seljuk Empire': 'Imperio selyúcida', 'Timurid Empire': 'Imperio timúrida',
  'Viceroyalty of New Spain': 'Virreinato de Nueva España', 'Viceroyalty of Peru': 'Virreinato del Perú',
  'Viceroyalty of the Río de la Plata': 'Virreinato del Río de la Plata', 'Viceroyalty of New Granada': 'Virreinato de Nueva Granada',
  'Portuguese Empire': 'Imperio portugués', 'Spanish Empire': 'Imperio español', 'British Empire': 'Imperio británico',
  'Kingdom of Great Britain': 'Reino de Gran Bretaña', 'Great Britain': 'Gran Bretaña', 'Hellenic League': 'Liga helénica',
  'Athens': 'Atenas', 'Sparta': 'Esparta', 'Phoenicians': 'Fenicios', 'Phoenicia': 'Fenicia', 'Assyria': 'Asiria', 'Babylonia': 'Babilonia',
  'Hittite Empire': 'Imperio hitita', 'Hittites': 'Hititas', 'Etruscans': 'Etruscos', 'Germans': 'Germanos', 'Germanic tribes': 'Pueblos germánicos',
};
const HISTORICOS_NORM = new Map(Object.entries(HISTORICOS).map(([en, es]) => [normalizar(en), es]));

/** Nombre en español de un estado del atlas histórico (o el original si no se conoce). */
export function nombreHistorico(nombre: string): string {
  return HISTORICOS_NORM.get(normalizar(nombre)) ?? nombre;
}
