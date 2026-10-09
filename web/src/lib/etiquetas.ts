// Imágenes con etiquetas (bloques ```etiquetas, en YAML): una imagen de recursos/ con nombres y
// flechas encima, p. ej. las partes de la célula o de un aparato. Las posiciones van en porcentaje
// del ancho y del alto de la imagen (0-100), así no dependen de su tamaño.
//   imagen: recursos/celula.png
//   etiquetas:
//     - { texto: Núcleo, x: 85, y: 20, a: [52, 48] }   # x, y: dónde va el texto; a: punto señalado
import { load as cargarYaml } from 'js-yaml';
import type { OpcionesBloque } from './bloques';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function cargar(url: string): Promise<{ dataUrl: string; ancho: number; alto: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se encuentra la imagen (${r.status})`);
  const blob = await r.blob();
  const dataUrl = await new Promise<string>((ok, mal) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result));
    l.onerror = () => mal(new Error('No se pudo leer la imagen'));
    l.readAsDataURL(blob);
  });
  const img = new Image();
  await new Promise<void>((ok, mal) => {
    img.onload = () => ok();
    img.onerror = () => mal(new Error('La imagen está dañada'));
    img.src = dataUrl;
  });
  return { dataUrl, ancho: img.naturalWidth, alto: img.naturalHeight };
}

export async function dibujarEtiquetas(contenido: string, op: OpcionesBloque): Promise<string> {
  let s: any;
  try {
    s = cargarYaml(contenido);
  } catch (e) {
    throw new Error(`YAML no válido: ${(e as Error).message.split('\n')[0]}`);
  }
  const ruta = String(s?.imagen ?? '').replace(/^\.\//, '');
  if (!ruta || /^https?:/.test(ruta)) throw new Error('Indica «imagen: recursos/archivo»');
  const url = op.base ? `${op.base}/${ruta.split('/').map(encodeURIComponent).join('/')}` : ruta;
  const img = await cargar(url);
  // Margen alrededor para las etiquetas que caen fuera de la imagen
  const ANCHO_IMG = 560;
  const escala = ANCHO_IMG / img.ancho;
  const altoImg = img.alto * escala;
  const margen = 110;
  const ancho = ANCHO_IMG + margen * 2;
  const arriba = s.titulo ? 38 : 16;
  const alto = altoImg + arriba + 16;
  const X = (p: number) => margen + (p / 100) * ANCHO_IMG;
  const Y = (p: number) => arriba + (p / 100) * altoImg;
  const c = op.oscuro ? { texto: '#111827', caja: '#ffffff', linea: '#f9fafb', fondo: 'transparent', titulo: '#e5e7eb' } : { texto: '#111827', caja: '#ffffff', linea: '#111827', fondo: '#ffffff', titulo: '#111827' };
  let cuerpo = `<image x="${margen}" y="${arriba}" width="${ANCHO_IMG}" height="${altoImg}" href="${img.dataUrl}"/>`;
  for (const e of s.etiquetas ?? []) {
    const tx = X(Number(e.x));
    const ty = Y(Number(e.y));
    const texto = String(e.texto ?? '');
    const anchoTexto = texto.length * 7.4 + 14;
    if (Array.isArray(e.a)) {
      const ax = X(Number(e.a[0]));
      const ay = Y(Number(e.a[1]));
      // Línea con contorno claro, para que se vea sobre fondos oscuros y claros
      cuerpo += `<line x1="${tx}" y1="${ty}" x2="${ax}" y2="${ay}" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/><line x1="${tx}" y1="${ty}" x2="${ax}" y2="${ay}" stroke="#111827" stroke-width="1.8"/><circle cx="${ax}" cy="${ay}" r="4" fill="#111827" stroke="#ffffff" stroke-width="1.5"/>`;
    }
    cuerpo += `<rect x="${tx - anchoTexto / 2}" y="${ty - 11}" width="${anchoTexto}" height="22" rx="5" fill="${c.caja}" stroke="#374151" stroke-width="1"/>`;
    cuerpo += `<text x="${tx}" y="${ty + 4.5}" text-anchor="middle" font-size="13" font-weight="600" fill="${c.texto}">${esc(texto)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" font-family="Inter, Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="${c.fondo}"/>${
    s.titulo ? `<text x="${ancho / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${c.titulo}">${esc(s.titulo)}</text>` : ''
  }${cuerpo}</svg>`;
}
