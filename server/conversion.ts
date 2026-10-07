// Extrae el texto de documentos de oficina (docx, odt, pptx…) con Pandoc para que los agentes
// puedan leerlos. Los PDF e imágenes los leen los agentes directamente.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CONVERTIBLES: Record<string, string> = {
  '.docx': 'docx',
  '.odt': 'odt',
  '.pptx': 'pptx',
  '.epub': 'epub',
  '.rtf': 'rtf',
  '.html': 'html',
  '.htm': 'html',
  '.xlsx': 'xlsx',
};

export function rutaPandoc(dirBin: string) {
  return path.join(dirBin, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc');
}

export function ejecutarBinario(exe: string, args: string[], cwd?: string, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split(/\r?\n/).slice(-6).join('\n')));
      else resolve(stdout);
    });
  });
}

/** Convierte a Markdown (en `.texto/`) los archivos de una carpeta de fuentes que lo necesiten. */
export async function asegurarTextos(dirFuentes: string, dirBin: string) {
  if (!existsSync(dirFuentes)) return;
  const pandoc = rutaPandoc(dirBin);
  if (!existsSync(pandoc)) return;
  const dirTexto = path.join(dirFuentes, '.texto');
  for (const e of await fs.readdir(dirFuentes, { withFileTypes: true })) {
    const formato = CONVERTIBLES[path.extname(e.name).toLowerCase()];
    if (!e.isFile() || !formato) continue;
    const origen = path.join(dirFuentes, e.name);
    const destino = path.join(dirTexto, `${e.name}.md`);
    const [so, sd] = await Promise.all([fs.stat(origen), fs.stat(destino).catch(() => null)]);
    if (sd && sd.mtimeMs >= so.mtimeMs) continue;
    await fs.mkdir(dirTexto, { recursive: true });
    try {
      await ejecutarBinario(pandoc, ['-f', formato, '-t', 'gfm', '--wrap=none', origen, '-o', destino]);
    } catch (err) {
      await fs.writeFile(destino, `(No se pudo extraer el texto de ${e.name}: ${(err as Error).message})\n`, 'utf8');
    }
  }
  // Quitar textos de archivos que ya no existen
  if (existsSync(dirTexto)) {
    for (const f of await fs.readdir(dirTexto)) {
      if (!existsSync(path.join(dirFuentes, f.replace(/\.md$/, '')))) await fs.rm(path.join(dirTexto, f), { force: true });
    }
  }
}
