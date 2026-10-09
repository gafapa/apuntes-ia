// Tiras de pictogramas de ARASAAC (Gobierno de Aragón) para los bloques ```pictogramas: una palabra
// por línea («palabra» o «palabra: texto que se muestra»). Muy usados en Primaria y en la atención
// a alumnado con necesidades educativas. Su licencia (CC BY-NC-SA) obliga a citar la autoría: el
// crédito va dentro de la propia imagen.
import type { OpcionesBloque } from './bloques';

const CREDITO = 'Pictogramas: Sergio Palao. Origen: ARASAAC (https://arasaac.org). Licencia: CC BY-NC-SA. Propiedad: Gobierno de Aragón (España)';
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function comoDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error ?? `No se pudo obtener el pictograma (${r.status})`);
  }
  const blob = await r.blob();
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result));
    lector.onerror = () => mal(new Error('No se pudo leer el pictograma'));
    lector.readAsDataURL(blob);
  });
}

export async function dibujarPictogramas(contenido: string, op: OpcionesBloque): Promise<string> {
  // Opciones en las primeras líneas: «idioma: en», «columnas: 6», «titulo: …»
  const opciones: Record<string, string> = {};
  const palabras: { buscar: string; texto: string }[] = [];
  for (const linea of contenido.split('\n').map((l) => l.trim().replace(/^[-*]\s+/, '')).filter(Boolean)) {
    const m = linea.match(/^(idioma|columnas|titulo|título)\s*:\s*(.+)$/i);
    if (m) {
      opciones[m[1].toLowerCase().replace('título', 'titulo')] = m[2].trim();
      continue;
    }
    const [buscar, texto] = linea.includes(':') ? [linea.slice(0, linea.indexOf(':')), linea.slice(linea.indexOf(':') + 1)] : [linea, linea];
    palabras.push({ buscar: buscar.trim(), texto: (texto || buscar).trim() });
  }
  if (!palabras.length) throw new Error('Escribe una palabra por línea');
  const idioma = (opciones.idioma ?? 'es').slice(0, 2).toLowerCase();
  const imagenes = await Promise.all(palabras.map((p) => comoDataUrl(`/api/arasaac?idioma=${idioma}&palabra=${encodeURIComponent(p.buscar)}`)));
  const columnas = Math.max(1, Math.min(8, Number(opciones.columnas) || Math.min(palabras.length, 6)));
  const CELDA = 132;
  const filas = Math.ceil(palabras.length / columnas);
  const arriba = opciones.titulo ? 38 : 10;
  const ancho = columnas * CELDA + 20;
  const alto = arriba + filas * (CELDA + 28) + 26;
  const c = op.oscuro ? { texto: '#e5e7eb', marco: '#4b5563', fondo: 'transparent', tarjeta: '#ffffff' } : { texto: '#111827', marco: '#d1d5db', fondo: '#ffffff', tarjeta: '#ffffff' };
  let cuerpo = '';
  palabras.forEach((p, i) => {
    const x = 10 + (i % columnas) * CELDA;
    const y = arriba + Math.floor(i / columnas) * (CELDA + 28);
    cuerpo += `<rect x="${x + 4}" y="${y}" width="${CELDA - 8}" height="${CELDA + 20}" rx="10" fill="${c.tarjeta}" stroke="${c.marco}"/>`;
    cuerpo += `<image x="${x + 12}" y="${y + 6}" width="${CELDA - 24}" height="${CELDA - 24}" href="${imagenes[i]}"/>`;
    // Letra más pequeña si el texto es largo, para que quepa en la tarjeta
    const tam = Math.max(9, Math.min(15, ((CELDA - 16) / Math.max(1, p.texto.length)) * 1.6));
    cuerpo += `<text x="${x + CELDA / 2}" y="${y + CELDA + 6}" text-anchor="middle" font-size="${tam.toFixed(1)}" font-weight="600" fill="#111827">${esc(p.texto.toUpperCase())}</text>`;
  });
  cuerpo += `<text x="${ancho / 2}" y="${alto - 8}" text-anchor="middle" font-size="9" fill="${c.texto}" opacity="0.75">${esc(CREDITO)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" font-family="Inter, Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="${c.fondo}"/>${
    opciones.titulo ? `<text x="${ancho / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${c.texto}">${esc(opciones.titulo)}</text>` : ''
  }${cuerpo}</svg>`;
}
