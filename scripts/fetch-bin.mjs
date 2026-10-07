// Descarga Pandoc y Typst (binarios únicos) para incluirlos en el instalador.
// Uso: node scripts/fetch-bin.mjs [win|mac|linux]   (por defecto, el sistema actual)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const plataforma = process.argv[2] ?? { win32: 'win', darwin: 'mac' }[process.platform] ?? 'linux';
const destino = path.resolve('resources-bin', plataforma);
const exe = plataforma === 'win' ? '.exe' : '';

const PROGRAMAS = [
  {
    nombre: 'pandoc',
    repo: 'jgm/pandoc',
    licencia: 'https://raw.githubusercontent.com/jgm/pandoc/main/COPYRIGHT',
    recurso: {
      win: /windows-x86_64\.zip$/,
      mac: /arm64-macOS\.zip$/,
      linux: /linux-amd64\.tar\.gz$/,
    }[plataforma],
  },
  {
    nombre: 'typst',
    repo: 'typst/typst',
    licencia: 'https://raw.githubusercontent.com/typst/typst/main/LICENSE',
    recurso: {
      win: /x86_64-pc-windows-msvc\.zip$/,
      mac: /aarch64-apple-darwin\.tar\.xz$/,
      linux: /x86_64-unknown-linux-musl\.tar\.xz$/,
    }[plataforma],
  },
];

async function descargar(url, archivo) {
  const r = await fetch(url, { headers: { 'User-Agent': 'apuntes-ia-build' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(archivo, Buffer.from(await r.arrayBuffer()));
}

/** Busca un archivo por nombre dentro de un directorio (recursivo). */
function buscar(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = buscar(p, nombre);
      if (r) return r;
    } else if (e.name === nombre) return p;
  }
}

fs.mkdirSync(destino, { recursive: true });
const versiones = {};

for (const prog of PROGRAMAS) {
  const final = path.join(destino, prog.nombre + exe);
  const rel = await (await fetch(`https://api.github.com/repos/${prog.repo}/releases/latest`, { headers: { 'User-Agent': 'apuntes-ia-build' } })).json();
  versiones[prog.nombre] = rel.tag_name;
  if (fs.existsSync(final) && fs.existsSync(path.join(destino, `.${prog.nombre}-${rel.tag_name}`))) {
    console.log(`${prog.nombre} ${rel.tag_name} ya descargado`);
    continue;
  }
  const recurso = rel.assets?.find((a) => prog.recurso.test(a.name));
  if (!recurso) throw new Error(`No se encuentra el binario de ${prog.nombre} para ${plataforma}`);
  console.log(`Descargando ${recurso.name}…`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `apuntes-${prog.nombre}-`));
  const comprimido = path.join(tmp, recurso.name);
  await descargar(recurso.browser_download_url, comprimido);
  // bsdtar (incluido en Windows 10+ y macOS) descomprime zip, tar.gz y tar.xz
  // En Windows se usa el tar del sistema: el de Git Bash no entiende rutas "C:\..."
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', comprimido, '-C', tmp]);
  const binario = buscar(tmp, prog.nombre + exe);
  if (!binario) throw new Error(`No se encuentra ${prog.nombre}${exe} dentro de ${recurso.name}`);
  fs.copyFileSync(binario, final);
  if (!exe) fs.chmodSync(final, 0o755);
  await descargar(prog.licencia, path.join(destino, `LICENCIA-${prog.nombre}.txt`));
  for (const f of fs.readdirSync(destino)) if (f.startsWith(`.${prog.nombre}-`)) fs.rmSync(path.join(destino, f));
  fs.writeFileSync(path.join(destino, `.${prog.nombre}-${rel.tag_name}`), '');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Binarios listos en', destino, versiones);
