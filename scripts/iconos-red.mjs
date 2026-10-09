// Genera web/src/lib/iconosRed.json: un paquete pequeño de iconos de red (Material Design Icons,
// licencia Apache 2.0) con nombres en español, para los diagramas Mermaid (p. ej. «red:router»).
// Uso: node scripts/iconos-red.mjs (requiere @iconify-json/mdi, dependencia de desarrollo).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mdi = JSON.parse(readFileSync(require.resolve('@iconify-json/mdi/icons.json'), 'utf8'));
const NOMBRES = {
  router: 'router-network', 'router-wifi': 'router-wireless', switch: 'switch', servidor: 'server', 'servidor-red': 'server-network',
  pc: 'desktop-classic', ordenador: 'desktop-tower-monitor', portatil: 'laptop', tablet: 'tablet', movil: 'cellphone',
  telefono: 'phone-voip', impresora: 'printer', cortafuegos: 'wall-fire', internet: 'cloud', nube: 'cloud', ap: 'access-point',
  wifi: 'access-point-network', 'base-datos': 'database', nas: 'nas', disco: 'harddisk', dns: 'dns', web: 'web', red: 'lan',
  cable: 'ethernet', usuario: 'account', edificio: 'office-building', casa: 'home', escudo: 'shield', tv: 'television',
};
const icons = {};
for (const [nombre, id] of Object.entries(NOMBRES)) {
  const icono = mdi.icons[id];
  if (!icono) throw new Error(`Falta ${id}`);
  icons[nombre] = { body: icono.body };
}
writeFileSync(new URL('../web/src/lib/iconosRed.json', import.meta.url), JSON.stringify({ prefix: 'red', width: 24, height: 24, icons }));
console.log(`${Object.keys(icons).length} iconos`);
