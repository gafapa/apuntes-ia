// Compila el proceso principal de Electron (con el servidor) a dist/main.cjs.
// Las dependencias de node_modules no se empaquetan: electron-builder las incluye.
import { build } from 'esbuild';

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
