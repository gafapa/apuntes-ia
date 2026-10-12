// Buscador de fuentes: un agente busca en la web y propone fuentes; el usuario elige cuáles
// añadir y el servidor las descarga a la carpeta de fuentes (PDF tal cual, páginas web
// convertidas a Markdown con Pandoc, vídeos como ficha con el enlace).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResultadoBusqueda, TipoBusqueda } from '../shared/tipos';
import { ErrorUsuario, slug } from './store';
import { ejecutarBinario, rutaPandoc } from './conversion';
import { extraerJson } from './texto';
import { fetchPublicResource, readResponseLimited } from './remoteResources';

export const ARCHIVO_RESULTADOS = 'busqueda-fuentes.json';

// Algunos sitios rechazan peticiones que no parecen de un navegador
const CABECERAS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7',
};

/** Comprueba que un enlace responde (la IA a veces inventa o copia mal las URL). */
async function enlaceVivo(url: string): Promise<{ ok: boolean; motivo?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetchPublicResource(url, { method: 'GET', signal: ctrl.signal, headers: { ...CABECERAS, Range: 'bytes=0-2047' } });
    await r.body?.cancel().catch(() => {});
    if (r.status === 404 || r.status === 410) return { ok: false, motivo: `no existe (${r.status})` };
    return { ok: true, motivo: r.ok || r.status === 206 ? undefined : `el sitio respondió ${r.status}` };
  } catch {
    return { ok: false, motivo: 'no responde' };
  } finally {
    clearTimeout(t);
  }
}

export const DESCRIPCION_TIPO: Record<TipoBusqueda, string> = {
  cualquiera: 'cualquier tipo de fuente fiable (artículos, manuales, páginas institucionales, recursos educativos, vídeos)',
  academico: 'artículos académicos, capítulos de libros y manuales universitarios, preferentemente de acceso abierto (PDF)',
  educativo: 'recursos educativos: materiales de instituciones educativas, apuntes universitarios, portales oficiales y recursos de libre uso',
  video: 'vídeos educativos de calidad (canales de universidades, divulgadores reconocidos, instituciones)',
};

export async function leerResultados(dir: string): Promise<ResultadoBusqueda[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, ARCHIVO_RESULTADOS), 'utf8'));
  } catch {
    return [];
  }
}

export async function guardarResultados(dir: string, lista: ResultadoBusqueda[]) {
  const destino = path.join(dir, ARCHIVO_RESULTADOS);
  const tmp = path.join(dir, `.tmp-${Date.now()}-${ARCHIVO_RESULTADOS}`);
  await fs.writeFile(tmp, JSON.stringify(lista, null, 2));
  await fs.rename(tmp, destino);
}

/** Incorpora lo que ha escrito el agente: valida, quita duplicados y conserva lo anterior. */
export async function incorporarResultados(dir: string, salidaAgente: string, consulta: string): Promise<number> {
  let r: { resultados?: Partial<ResultadoBusqueda>[] };
  try {
    r = extraerJson(await fs.readFile(salidaAgente, 'utf8'));
  } catch {
    throw new Error('El agente no ha escrito los resultados en el formato pedido. Respóndele para que lo corrija.');
  }
  const actuales = await leerResultados(dir);
  const urls = new Set(actuales.map((x) => x.url));
  const candidatos = (r.resultados ?? []).filter((x) => /^https?:\/\//.test(String(x.url ?? '').trim()) && x.titulo && !urls.has(String(x.url).trim()));
  // Comprobación de enlaces en paralelo: los rotos se descartan
  const vivos = await Promise.all(candidatos.map((x) => enlaceVivo(String(x.url).trim())));
  let n = 0;
  for (const [i, x] of candidatos.entries()) {
    const url = String(x.url ?? '').trim();
    if (!vivos[i].ok || urls.has(url)) continue;
    urls.add(url);
    actuales.unshift({
      id: randomUUID().slice(0, 8),
      consulta,
      titulo: String(x.titulo).trim(),
      url,
      autor: String(x.autor ?? '').trim(),
      tipo: ['pdf', 'web', 'video', 'articulo', 'libro'].includes(String(x.tipo)) ? (x.tipo as ResultadoBusqueda['tipo']) : 'web',
      descripcion: String(x.descripcion ?? '').trim(),
      fiabilidad: String(x.fiabilidad ?? '').trim(),
      idioma: String(x.idioma ?? '').trim(),
      licencia: String(x.licencia ?? '').trim(),
      estado: 'propuesta',
      error: vivos[i].motivo ? `Aviso: ${vivos[i].motivo}; puede que no se pueda descargar` : undefined,
      creado: new Date().toISOString(),
    });
    n++;
  }
  await guardarResultados(dir, actuales);
  return n;
}

/** Descarga un resultado a la carpeta de fuentes y devuelve el nombre del archivo guardado. */
export async function descargarFuente(r: ResultadoBusqueda, dirFuentes: string, dirBin: string): Promise<string> {
  await fs.mkdir(dirFuentes, { recursive: true });
  const base = slug(r.titulo).slice(0, 60) || 'fuente';
  const libre = (ext: string) => {
    let nombre = `${base}.${ext}`;
    for (let i = 2; existsSync(path.join(dirFuentes, nombre)); i++) nombre = `${base}-${i}.${ext}`;
    return nombre;
  };
  const cabecera = [
    `# ${r.titulo}`,
    '',
    `> Fuente: ${r.url}`,
    r.autor && `> Autor: ${r.autor}`,
    r.licencia && `> Licencia: ${r.licencia}`,
    `> Consultado el ${new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    '',
  ]
    .filter((x): x is string => typeof x === 'string' && x !== '')
    .join('\n');

  // Vídeos: no se pueden descargar ni leer; se guarda una ficha con el enlace y el resumen
  if (r.tipo === 'video' || /youtube\.com|youtu\.be|vimeo\.com/.test(r.url)) {
    const nombre = libre('md');
    await fs.writeFile(path.join(dirFuentes, nombre), `${cabecera}\n\n**Vídeo.** ${r.descripcion}\n`, 'utf8');
    return nombre;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  let resp: Response;
  try {
    resp = await fetchPublicResource(r.url, { signal: ctrl.signal, headers: CABECERAS });
  } catch (e) {
    clearTimeout(t);
    throw new ErrorUsuario(`No se pudo descargar: ${(e as Error).message}`);
  }
  try {
    if (resp.status === 401 || resp.status === 403)
      throw new ErrorUsuario('El sitio no permite descargas automáticas. Ábrela en el navegador y, si te interesa, guárdala y súbela a mano.');
    if (!resp.ok) throw new ErrorUsuario(`No se pudo descargar (error ${resp.status}). Ábrela en el navegador y súbela a mano si te interesa.`);
    const tipo = resp.headers.get('content-type') ?? '';
    const datos = await readResponseLimited(resp, 40 * 1024 * 1024);
    if (datos.length > 40 * 1024 * 1024) throw new ErrorUsuario('El archivo es demasiado grande (más de 40 MB)');

    if (/pdf/i.test(tipo) || datos.subarray(0, 5).toString() === '%PDF-') {
      const nombre = libre('pdf');
      await fs.writeFile(path.join(dirFuentes, nombre), datos);
      return nombre;
    }
    if (/html|xml/i.test(tipo)) {
      // Página web → Markdown legible para los agentes
      // Pandoc espera UTF-8: se respeta la codificación declarada por el sitio
      const charset =
        tipo.match(/charset=([\w-]+)/i)?.[1] ?? datos.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
      let texto: string;
      try {
        texto = new TextDecoder(charset.toLowerCase()).decode(datos);
      } catch {
        texto = datos.toString('utf8');
      }
      const html = path.join(dirFuentes, `.tmp-${randomUUID().slice(0, 6)}.html`);
      await fs.writeFile(html, texto.replace(/<meta[^>]+charset=[^>]*>/gi, '<meta charset="utf-8">'), 'utf8');
      try {
        const md = await ejecutarBinario(rutaPandoc(dirBin), ['-f', 'html', '-t', 'gfm-raw_html', '--wrap=none', html]);
        const limpio = md.replace(/\n{3,}/g, '\n\n').trim();
        if (limpio.length < 200) throw new ErrorUsuario('La página no tiene texto aprovechable (puede requerir JavaScript o registro).');
        const nombre = libre('md');
        await fs.writeFile(path.join(dirFuentes, nombre), `${cabecera}\n\n${limpio}\n`, 'utf8');
        return nombre;
      } finally {
        await fs.rm(html, { force: true });
      }
    }
    const ext = /png/.test(tipo) ? 'png' : /jpe?g/.test(tipo) ? 'jpg' : /plain/.test(tipo) ? 'txt' : /word|officedocument/.test(tipo) ? 'docx' : '';
    if (!ext) throw new ErrorUsuario(`Tipo de archivo no admitido (${tipo || 'desconocido'})`);
    const nombre = libre(ext);
    await fs.writeFile(path.join(dirFuentes, nombre), datos);
    return nombre;
  } finally {
    clearTimeout(t);
  }
}
