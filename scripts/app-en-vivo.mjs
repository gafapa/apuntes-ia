// Modo «app en vivo»: abre la app de escritorio con recarga en caliente.
//   - Interfaz (web/): Vite la actualiza al guardar, sin recargar la ventana.
//   - Servidor (server/, shared/): tsx lo reinicia solo; los agentes en marcha no se cortan.
//   - Proceso principal (electron/): requiere cerrar y volver a lanzar `npm run app`.
// Usa los datos y ajustes reales de la app instalada (no pueden estar abiertas las dos a la vez).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compilarMcp } from './compilar-mcp.mjs';

const URL_VITE = 'http://localhost:5173';
const procesos = [];
const require = createRequire(import.meta.url);
let serverReady = false;
let stopping = false;

function lanzar(nombre, cmd, args, env = {}) {
  const environment = { ...process.env, ...env };
  if (nombre === 'app') delete environment.ELECTRON_RUN_AS_NODE;
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: environment, windowsHide: nombre !== 'app' });
  const prefijo = `[${nombre}] `;
  const volcar = (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, prefijo));
  p.stdout.on('data', volcar);
  p.stderr.on('data', volcar);
  procesos.push(p);
  p.once('error', error => {
    console.error(`Failed to start ${nombre}: ${error.message}`);
    void terminar(1);
  });
  return p;
}

async function terminar(codigo = 0) {
  if (stopping) return;
  stopping = true;
  if (serverReady) {
    try { await fetch('http://127.0.0.1:4317/api/cola/guardar', { method: 'POST', signal: AbortSignal.timeout(5000) }); }
    catch { console.error('Could not flush the live server before shutdown'); }
  }
  await Promise.all(procesos.filter(child => child.pid && child.exitCode === null).map(child => new Promise(resolve => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.once('close', resolve);
      killer.once('error', resolve);
    } else {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.kill();
    }
  })));
  process.exit(codigo);
}
process.on('SIGINT', () => terminar());
process.on('SIGTERM', () => terminar());

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

// 0. Los puertos deben estar libres: si no, la app podría hablar con otro servidor (p. ej. uno
//    de desarrollo con datos de prueba) sin que se note
for (const url of ['http://127.0.0.1:4317/api/version', `${URL_VITE}/`]) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    console.error(`\nYa hay algo escuchando en ${new URL(url).host}. Cierra la otra instancia (npm run dev, otra app en vivo…) y vuelve a intentarlo.`);
    process.exit(1);
  } catch {}
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
await compilarMcp();

// 2. Servidor con recarga automática (datos reales) y 3. interfaz con Vite
lanzar('servidor', process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'watch', '--clear-screen=false', 'server/dev.ts'], { APUNTES_REAL: '1' });
lanzar('interfaz', process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--strictPort']);

await Promise.all([esperar(`${URL_VITE}/`), esperar('http://127.0.0.1:4317/api/version')]).catch((e) => {
  console.error(`\n${e.message}. ¿Está abierta la app instalada? Ciérrala y vuelve a intentarlo.`);
  return terminar(1);
});

const { version } = await (await fetch('http://127.0.0.1:4317/api/version')).json();
if (version !== 'en vivo') {
  console.error('\nEl servidor que responde no es el de la app en vivo (¿hay otro abierto?). Ciérralo y vuelve a intentarlo.');
  await terminar(1);
  await new Promise(() => {}); // no abrir la ventana mientras se cierra todo
}
serverReady = true;

// 4. Ventana de la app
const electron = lanzar('app', require('electron'), ['.'], { APUNTES_EN_VIVO: URL_VITE });
electron.on('exit', () => terminar());
console.log('\nApp en vivo lista. Edita web/ o server/ y los cambios se aplican al guardar. Cierra la ventana para terminar.\n');
