// Servidor MCP (stdio) que da a los agentes acceso al índice de las fuentes:
// buscar fragmentos relevantes, listar las fuentes y leer una página concreta.
// Con el argumento --imagenes, también busca imágenes con licencia libre en museos y bibliotecas.
// Lo lanzan Claude Code y Codex como proceso hijo. Argumentos: [--imagenes] etiqueta=carpeta_de_fuentes ...
// Las claves de las colecciones que las piden llegan en APUNTES_CLAVES_IMAGENES (JSON).
import { buscar, formatear, leerPagina, listar } from './rag';
import { buscarImagenes, credito, descargarImagen, referenciaApa, type ClavesImagenes } from './imagenesWeb';

const carpetas: Record<string, string> = {};
let conImagenes = false;
let dirRecursos: string | undefined; // --recursos=<carpeta>: permite guardar imágenes en el documento
for (const a of process.argv.slice(2)) {
  if (a === '--imagenes') conImagenes = true;
  if (a.startsWith('--recursos=')) {
    dirRecursos = a.slice('--recursos='.length);
    continue;
  }
  const i = a.indexOf('=');
  if (i > 0) carpetas[a.slice(0, i)] = a.slice(i + 1);
}
let claves: ClavesImagenes = {};
try {
  claves = JSON.parse(process.env.APUNTES_CLAVES_IMAGENES ?? '{}');
} catch {}

const HERRAMIENTA_IMAGENES = {
  name: 'buscar_imagenes',
  description:
    'Busca imágenes con licencia libre (dominio público, CC0, CC BY, CC BY-SA) en museos, bibliotecas y archivos: ' +
    'Wikimedia Commons, Europeana (con Hispana y fondos españoles), Met, Art Institute of Chicago, Cleveland, Wellcome, Smithsonian y Openverse. ' +
    'Ideal para fuentes primarias de historia y arte: retratos, pinturas, grabados, mapas antiguos, fotografías de época, objetos. ' +
    'Cada resultado trae título, autor, fecha, institución, licencia, URL de la imagen y de su ficha.',
  inputSchema: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'Qué buscar, EN INGLÉS (los museos catalogan en inglés): p. ej. "Battle of Lepanto", "Philip II of Spain portrait"' },
      consulta_local: { type: 'string', description: 'La misma búsqueda en español (o el idioma de los apuntes) para Commons y los fondos españoles de Europeana: p. ej. "batalla de Lepanto"' },
    },
    required: ['consulta'],
  },
};

const HERRAMIENTA_GUARDAR = {
  name: 'guardar_imagen',
  description:
    'Descarga una imagen (la URL «imagen:» de un resultado de buscar_imagenes) a la carpeta recursos/ del documento y devuelve ' +
    'la ruta para enlazarla en el Markdown: ![pie](recursos/archivo.jpg) y, debajo, en su propio párrafo, la línea «referencia» (APA 7) que acompaña al resultado.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL directa de la imagen' },
      nombre: { type: 'string', description: 'Nombre corto del archivo, sin extensión, p. ej. "batalla-lepanto"' },
    },
    required: ['url', 'nombre'],
  },
};

const HERRAMIENTAS_FUENTES = [
  {
    name: 'buscar_en_fuentes',
    description:
      'Busca en el material aportado (PDF, documentos, páginas guardadas) los fragmentos más relevantes para una consulta. ' +
      'Úsala en lugar de leer documentos enteros. Devuelve cada fragmento con su archivo y página para citarlo.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar: conceptos, términos o una pregunta' },
        max: { type: 'number', description: 'Número de fragmentos (por defecto 6, máximo 15)' },
        archivo: { type: 'string', description: 'Opcional: buscar solo en este archivo' },
      },
      required: ['consulta'],
    },
  },
  {
    name: 'listar_fuentes',
    description: 'Lista las fuentes indexadas con su número de páginas y cómo empiezan.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'leer_pagina',
    description: 'Devuelve el texto completo de una página de un PDF (o de todo el archivo si no es un PDF). Útil para ampliar un fragmento encontrado.',
    inputSchema: {
      type: 'object',
      properties: {
        archivo: { type: 'string' },
        pagina: { type: 'number' },
      },
      required: ['archivo'],
    },
  },
];

const HERRAMIENTAS = [
  ...(Object.keys(carpetas).length ? HERRAMIENTAS_FUENTES : []),
  ...(conImagenes ? [HERRAMIENTA_IMAGENES] : []),
  ...(conImagenes && dirRecursos ? [HERRAMIENTA_GUARDAR] : []),
];

async function llamar(nombre: string, args: Record<string, unknown>): Promise<string> {
  if (nombre === 'guardar_imagen' && dirRecursos) {
    const base =
      String(args.nombre ?? 'imagen')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'imagen';
    try {
      const archivo = await descargarImagen(String(args.url ?? ''), dirRecursos, base);
      return `Guardada en recursos/${archivo}. Enlázala como ![pie](recursos/${archivo}) y, debajo, en su propio párrafo, copia tal cual la «referencia» del resultado (Tomado de …).`;
    } catch (e) {
      return `No se pudo descargar: ${(e as Error).message} Prueba con otra imagen.`;
    }
  }
  if (nombre === 'buscar_imagenes') {
    const r = await buscarImagenes(String(args.consulta ?? ''), { consultaLocal: args.consulta_local ? String(args.consulta_local) : undefined, claves });
    if (!r.resultados.length) return 'No se han encontrado imágenes con licencia libre. Prueba con otros términos (en inglés para los museos).';
    return r.resultados
      .slice(0, 30)
      .map(
        (x) =>
          `- [${x.id}] ${credito(x)}${x.ancho ? ` (${x.ancho}×${x.alto} px)` : ''}\n  imagen: ${x.imagen}\n  ficha: ${x.pagina}\n  referencia: ${referenciaApa(x)}`,
      )
      .join('\n');
  }
  if (nombre === 'buscar_en_fuentes') {
    const r = await buscar(carpetas, String(args.consulta ?? ''), Math.min(15, Number(args.max) || 6), args.archivo ? String(args.archivo) : undefined);
    return r.length ? formatear(r) : 'No se han encontrado fragmentos relevantes. Prueba con otros términos.';
  }
  if (nombre === 'listar_fuentes') {
    const l = await listar(carpetas);
    return l.length
      ? l.map((f) => `- ${f.carpeta === 'asignatura' ? '../../fuentes/' : 'fuentes/'}${f.archivo}${f.paginas ? ` (${f.paginas} págs.)` : ''}: ${f.inicio}…`).join('\n')
      : 'No hay fuentes indexadas.';
  }
  if (nombre === 'leer_pagina') {
    const archivo = String(args.archivo ?? '').replace(/^(\.\.\/\.\.\/)?fuentes\//, '');
    const texto = await leerPagina(carpetas, archivo, args.pagina === undefined ? undefined : Number(args.pagina));
    return texto ? texto.slice(0, 20000) : 'No se ha encontrado esa página o archivo.';
  }
  throw new Error(`Herramienta desconocida: ${nombre}`);
}

function responder(id: unknown, result?: unknown, error?: { code: number; message: string }) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
}

let resto = '';
let pendientes = 0;
let finEntrada = false;
const quizasSalir = () => finEntrada && pendientes === 0 && process.exit(0);
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (d: string) => {
  resto += d;
  const lineas = resto.split('\n');
  resto = lineas.pop() ?? '';
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    let m: { id?: unknown; method?: string; params?: any };
    try {
      m = JSON.parse(linea);
    } catch {
      continue;
    }
    if (m.id === undefined) continue; // notificaciones (p. ej. notifications/initialized)
    pendientes++;
    try {
      switch (m.method) {
        case 'initialize':
          responder(m.id, {
            protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'fuentes', version: '1.0.0' },
          });
          break;
        case 'ping':
          responder(m.id, {});
          break;
        case 'tools/list':
          responder(m.id, { tools: HERRAMIENTAS });
          break;
        case 'tools/call': {
          const texto = await llamar(m.params?.name, m.params?.arguments ?? {});
          responder(m.id, { content: [{ type: 'text', text: texto }] });
          break;
        }
        default:
          responder(m.id, undefined, { code: -32601, message: `Método no admitido: ${m.method}` });
      }
    } catch (e) {
      responder(m.id, { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
    } finally {
      pendientes--;
      quizasSalir();
    }
  }
});
process.stdin.on('end', () => {
  finEntrada = true;
  quizasSalir();
});
