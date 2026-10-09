// Análisis sintáctico de los bloques ```sintaxis, en notación de corchetes:
//   [O [Suj:SN [Det El] [N perro]] [Pred:SV [NV ladra]]]
// Por defecto se dibuja «en cajas», como se hace en los institutos: la oración arriba y, debajo de
// sus palabras, una línea por constituyente con su etiqueta (los más internos, más cerca del texto).
// Con la línea «estilo: arbol», como árbol (diagrama arbóreo).

interface Nodo {
  etiqueta?: string; // sin etiqueta: es una palabra
  palabra?: string;
  hijos: Nodo[];
  // calculado al dibujar
  desde?: number;
  hasta?: number; // índices de la primera y la última palabra
  altura?: number;
}

function analizar(texto: string): Nodo {
  const tokens = texto.match(/\[|\]|[^\s[\]]+/g) ?? [];
  let i = 0;
  const nodo = (): Nodo => {
    if (tokens[i] !== '[') return { palabra: tokens[i++], hijos: [] };
    i++;
    const etiqueta = tokens[i];
    if (!etiqueta || etiqueta === '[' || etiqueta === ']') throw new Error('Cada corchete debe empezar por su etiqueta: [SN …]');
    i++;
    const hijos: Nodo[] = [];
    while (i < tokens.length && tokens[i] !== ']') hijos.push(nodo());
    if (tokens[i] !== ']') throw new Error(`Falta cerrar el corchete de «${etiqueta}»`);
    i++;
    if (!hijos.length) throw new Error(`«${etiqueta}» no tiene contenido`);
    return { etiqueta, hijos };
  };
  if (!tokens.length) throw new Error('El análisis está vacío');
  const raiz = tokens[0] === '[' ? nodo() : { etiqueta: '', hijos: [] as Nodo[] };
  if (i < tokens.length) {
    // Varios constituyentes sueltos: se agrupan
    const resto: Nodo[] = [raiz];
    while (i < tokens.length) resto.push(nodo());
    return { etiqueta: '', hijos: resto };
  }
  return raiz;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let lienzoMedidas: CanvasRenderingContext2D | null | undefined;
function medir(texto: string, tamano: number, negrita = false): number {
  lienzoMedidas ??= document.createElement('canvas').getContext('2d');
  if (!lienzoMedidas) return texto.length * tamano * 0.55;
  lienzoMedidas.font = `${negrita ? '600 ' : ''}${tamano}px Inter, Arial, Helvetica, sans-serif`;
  return lienzoMedidas.measureText(texto).width;
}

/** Palabras en orden e índices de cada nodo; altura = distancia a las palabras. */
function preparar(n: Nodo, palabras: string[]): void {
  if (n.palabra !== undefined) {
    n.desde = n.hasta = palabras.length;
    n.altura = 0;
    palabras.push(n.palabra);
    return;
  }
  for (const h of n.hijos) preparar(h, palabras);
  n.desde = n.hijos[0].desde;
  n.hasta = n.hijos[n.hijos.length - 1].hasta;
  n.altura = 1 + Math.max(...n.hijos.map((h) => (h.palabra !== undefined ? 0 : h.altura!)));
}

function nodos(n: Nodo): Nodo[] {
  return n.palabra !== undefined ? [] : [n, ...n.hijos.flatMap(nodos)];
}

export function dibujarSintaxis(contenido: string, oscuro = false): string {
  const lineas = contenido.split('\n');
  const opciones = Object.fromEntries(
    lineas.filter((l) => /^\s*(estilo|titulo)\s*:/.test(l)).map((l) => [l.split(':')[0].trim(), l.slice(l.indexOf(':') + 1).trim()]),
  );
  const expresion = lineas.filter((l) => !/^\s*(estilo|titulo)\s*:/.test(l)).join(' ');
  const raiz = analizar(expresion);
  const palabras: string[] = [];
  preparar(raiz, palabras);
  const c = oscuro ? { texto: '#e5e7eb', linea: '#9ca3af', etiqueta: '#a5b4fc', fondo: 'transparent' } : { texto: '#111827', linea: '#4b5563', etiqueta: '#3730a3', fondo: '#ffffff' };
  const titulo = opciones.titulo;
  const arriba = titulo ? 40 : 14;
  const TAM = 16;
  const HUECO = 18;
  // Posición de cada palabra (centrada en su hueco y sin que las etiquetas se pisen)
  const anchos = palabras.map((p) => Math.max(medir(p, TAM, true), 24));
  const xs: number[] = [];
  let x = 24;
  for (const a of anchos) {
    xs.push(x);
    x += a + HUECO;
  }
  const ancho = Math.max(x + 6, titulo ? medir(titulo, 15, true) + 40 : 0);
  const svg = (cuerpo: string, alto: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" font-family="Inter, Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="${c.fondo}"/>${
      titulo ? `<text x="${ancho / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${c.texto}">${esc(titulo)}</text>` : ''
    }${cuerpo}</svg>`;

  if (/arbol|árbol/i.test(opciones.estilo ?? '')) {
    // Árbol: las palabras abajo y cada nodo centrado sobre sus hijos
    const prof = (n: Nodo): number => (n.palabra !== undefined ? 0 : 1 + Math.max(...n.hijos.map(prof)));
    const total = prof(raiz);
    const FILA = 46;
    const alto = arriba + total * FILA + 34;
    const pos = new Map<Nodo, [number, number]>();
    const colocar = (n: Nodo, nivel: number): number => {
      if (n.palabra !== undefined) {
        const cx = xs[n.desde!] + anchos[n.desde!] / 2;
        pos.set(n, [cx, arriba + total * FILA + 14]);
        return cx;
      }
      const cx = n.hijos.map((h) => colocar(h, nivel + 1)).reduce((a, b) => a + b, 0) / n.hijos.length;
      pos.set(n, [cx, arriba + 16 + nivel * FILA]);
      return cx;
    };
    colocar(raiz, 0);
    let cuerpo = '';
    for (const [n, [px, py]] of pos) {
      for (const h of n.hijos) {
        const [hx, hy] = pos.get(h)!;
        cuerpo += `<line x1="${px}" y1="${py + 5}" x2="${hx}" y2="${hy - 15}" stroke="${c.linea}" stroke-width="1.2"/>`;
      }
      cuerpo +=
        n.palabra !== undefined
          ? `<text x="${px}" y="${py}" text-anchor="middle" font-size="${TAM}" font-weight="600" fill="${c.texto}">${esc(n.palabra)}</text>`
          : n.etiqueta
            ? `<text x="${px}" y="${py}" text-anchor="middle" font-size="13" fill="${c.etiqueta}">${esc(n.etiqueta)}</text>`
            : '';
    }
    return svg(cuerpo, alto);
  }

  // En cajas: oración arriba y una línea por constituyente debajo de sus palabras
  const lista = nodos(raiz).filter((n) => n.etiqueta);
  const maxAltura = Math.max(1, ...lista.map((n) => n.altura!));
  const yPalabras = arriba + 18;
  const FILA = 36;
  const alto = yPalabras + 12 + maxAltura * FILA + 8;
  let cuerpo = palabras
    .map((p, i) => `<text x="${xs[i] + anchos[i] / 2}" y="${yPalabras}" text-anchor="middle" font-size="${TAM}" font-weight="600" fill="${c.texto}">${esc(p)}</text>`)
    .join('');
  for (const n of lista) {
    const y = yPalabras + 12 + (n.altura! - 1) * FILA;
    const x1 = xs[n.desde!] - 4;
    const x2 = xs[n.hasta!] + anchos[n.hasta!] + 4;
    cuerpo += `<path d="M${x1},${y - 5} L${x1},${y} L${x2},${y} L${x2},${y - 5}" fill="none" stroke="${c.linea}" stroke-width="1.3"/>`;
    cuerpo += `<text x="${(x1 + x2) / 2}" y="${y + 15}" text-anchor="middle" font-size="12.5" fill="${c.etiqueta}">${esc(n.etiqueta)}</text>`;
  }
  return svg(cuerpo, alto);
}
