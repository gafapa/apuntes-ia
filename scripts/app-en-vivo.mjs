// Modo «app en vivo»: abre la app de escritorio con recarga en caliente.
//   - Interfaz (web/): Vite la actualiza al guardar, sin recargar la ventana.
//   - Servidor (server/, shared/): tsx lo reinicia solo; los agentes en marcha no se cortan.
//   - Proceso principal (electron/): requiere cerrar y volver a lanzar `npm run app`.
// Usa los datos y ajustes reales de la app instalada (no pueden estar abiertas las dos a la vez).
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const URL_VITE = 'http://localhost:5173';
const procesos = [];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function lanzar(nombre, cmd, args, env = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  const prefijo = `[${nombre}] `;
  const volcar = (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, prefijo));
  p.stdout.on('data', volcar);
  p.stderr.on('data', volcar);
  procesos.push(p);
  return p;
}

function terminar(codigo = 0) {
  for (const p of procesos) {
    if (p.exitCode !== null) continue;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
    else p.kill();
  }
  setTimeout(() => process.exit(codigo), 300);
}
process.on('SIGINT', () => terminar());

async function esperar(url, ms = 60000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No responde ${url}`);
}

// 1. Proceso principal de Electron
await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
});

// 2. Servidor con recarga automática (datos reales) y 3. interfaz con Vite
lanzar('servidor', npx, ['tsx', 'watch', '--clear-screen=false', 'server/dev.ts'], { APUNTES_REAL: '1' });
lanzar('interfaz', npx, ['vite', '--strictPort']);

await Promise.all([esperar(`${URL_VITE}/`), esperar('http://127.0.0.1:4317/api/version')]).catch((e) => {
  console.error(`\n${e.message}. ¿Está abierta la app instalada? Ciérrala y vuelve a intentarlo.`);
  terminar(1);
});

// 4. Ventana de la app
const electron = lanzar('app', npx, ['electron', '.'], { APUNTES_EN_VIVO: URL_VITE });
electron.on('exit', () => terminar());
console.log('\nApp en vivo lista. Edita web/ o server/ y los cambios se aplican al guardar. Cierra la ventana para terminar.\n');
