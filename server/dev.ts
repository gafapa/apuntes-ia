// Arranque del servidor en desarrollo (sin Electron). La interfaz la sirve Vite en :5173.
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from './index';

const datos = process.env.APUNTES_DATOS ?? path.join(os.homedir(), 'Documents', 'Apuntes IA (desarrollo)');

crearServidor({
  archivoAjustes: path.join(datos, '.ajustes-dev.json'),
  carpetaDatosPorDefecto: datos,
  puerto: 4317,
  dirBin: path.resolve('resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux'),
}).then(({ url }) => console.log(`Servidor en ${url} · datos en ${datos}`));
