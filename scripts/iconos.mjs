// Genera los iconos de la app a partir de build/icono.svg y build/icono-pequeno.svg (la versión
// simplificada para 32 px o menos). Se ejecuta con Electron, que dibuja el SVG en un canvas:
//   npm run iconos
// Escribe build/icon.png (1024), build/icon.ico (16-256), web/public/icono.png y docs/icono.png.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const grande = fs.readFileSync(path.join(raiz, 'build', 'icono.svg'), 'utf8');
const pequeno = fs.readFileSync(path.join(raiz, 'build', 'icono-pequeno.svg'), 'utf8');
// Por debajo de 128 px los renglones de las páginas solo ensucian
const sinRenglones = grande.replace(/<g id="renglones"[\s\S]*?<\/g>\s*/, '');
const svgPara = (lado) => (lado <= 32 ? pequeno : lado < 128 ? sinRenglones : grande);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const ventana = new BrowserWindow({ show: false });
  await ventana.loadURL('data:text/html,<canvas></canvas>');
  /** PNG de `lado` px dibujado por Chromium. */
  const png = async (lado) => {
    const url = await ventana.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svgPara(lado)).toString('base64'))};
      await img.decode();
      const c = document.querySelector('canvas');
      c.width = c.height = ${lado};
      const g = c.getContext('2d');
      g.clearRect(0, 0, ${lado}, ${lado});
      g.drawImage(img, 0, 0, ${lado}, ${lado});
      return c.toDataURL('image/png');
    })()`);
    return Buffer.from(url.split(',')[1], 'base64');
  };

  const escribir = (ruta, datos) => {
    fs.writeFileSync(path.join(raiz, ruta), datos);
    console.log(`${ruta} (${datos.length} bytes)`);
  };
  escribir('build/icon.png', await png(1024));
  escribir('web/public/icono.png', await png(128));
  escribir('docs/icono.png', await png(256));

  // .ico con las imágenes en PNG (Windows Vista y posteriores)
  const lados = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const imagenes = [];
  for (const lado of lados) imagenes.push(await png(lado));
  const cabecera = Buffer.alloc(6 + 16 * lados.length);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(lados.length, 4);
  let desplazamiento = cabecera.length;
  lados.forEach((lado, i) => {
    const e = 6 + 16 * i;
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e);
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e + 1);
    cabecera.writeUInt16LE(1, e + 4); // planos
    cabecera.writeUInt16LE(32, e + 6); // bits por píxel
    cabecera.writeUInt32LE(imagenes[i].length, e + 8);
    cabecera.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += imagenes[i].length;
  });
  escribir('build/icon.ico', Buffer.concat([cabecera, ...imagenes]));
  app.quit();
});
