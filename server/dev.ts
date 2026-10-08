// Arranque del servidor sin Electron (lo recarga `tsx watch` al cambiar el código).
//
// - `npm run dev`: datos de prueba en «Documentos/Apuntes IA (desarrollo)».
// - `npm run app`: modo «app en vivo» con los datos y ajustes reales de la app instalada.
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from './index';

/** Carpeta de ajustes de Electron (app.getPath('userData')) para «Apuntes IA». */
function carpetaUsuarioElectron() {
  const nombre = 'Apuntes IA';
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), nombre);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', nombre);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), nombre);
}

const real = process.env.APUNTES_REAL === '1';
const datos = process.env.APUNTES_DATOS ?? path.join(os.homedir(), 'Documents', real ? 'Apuntes IA' : 'Apuntes IA (desarrollo)');
const archivoAjustes = real ? path.join(carpetaUsuarioElectron(), 'ajustes.json') : path.join(datos, '.ajustes-dev.json');

crearServidor({
  archivoAjustes,
  carpetaDatosPorDefecto: datos,
  puerto: 4317,
  dirBin: path.resolve('resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux'),
  version: real ? 'en vivo' : 'desarrollo',
  dirTrabajos: real ? undefined : path.join(datos, '.trabajos'),
}).catch((e) => {
  console.error(e?.code === 'EADDRINUSE' ? 'El puerto 4317 está ocupado: ya hay otro servidor de Apuntes IA abierto.' : e);
  process.exit(1);
}).then((servidor) => {
  if (!servidor) return;
  console.log(`Servidor en ${servidor.url} · ajustes en ${archivoAjustes}`);
  // Al reiniciarse (tsx watch) o cerrarse, se cierran los agentes; se relanzan al arrancar de nuevo
  const salir = () => servidor.cerrar().finally(() => process.exit(0));
  process.once('SIGTERM', salir);
  process.once('SIGINT', salir);
});
