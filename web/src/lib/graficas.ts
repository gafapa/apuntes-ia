// Gráficas de los bloques ```grafica (en YAML): funciones (con áreas para las integrales), líneas,
// barras, sectores, dispersión, climogramas y pirámides de población. Se dibujan como SVG propio,
// sin librerías de gráficos, para controlar el aspecto y que el resultado sea exacto.
import { load as cargarYaml } from 'js-yaml';

// ---------------------------------------------------------------------------
// Expresiones matemáticas (analizador propio: no ejecuta código, solo calcula)

type Nodo = (x: number) => number;

const FUNCIONES: Record<string, (a: number) => number> = {
  sin: Math.sin, sen: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
  asin: Math.asin, arcsin: Math.asin, acos: Math.acos, arccos: Math.acos, atan: Math.atan, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, raiz: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
};
const CONSTANTES: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E };

/** Convierte «f(x) = 2x^2 - 3sin(x)» en una función de x. Lanza un error si no se entiende. */
export function compilar(expresion: string): Nodo {
  const texto = expresion
    .replace(/^\s*(?:[a-zA-Z]\w*\s*\(\s*x\s*\)|y)\s*=/, '')
    .replace(/·|×/g, '*')
    .replace(/−/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .trim();
  const tokens = texto.match(/\d+(?:[.,]\d+)?(?:e[+-]?\d+)?|[a-zA-Zπ]\w*|[-+*/^()|]/g) ?? [];
  // Caracteres que no forman parte de ninguna pieza reconocida
  const resto = texto.replace(/\d+(?:[.,]\d+)?(?:e[+-]?\d+)?|[a-zA-Zπ]\w*|[-+*/^()|\s]/g, '');
  if (resto) throw new Error(`No entiendo «${resto}» en «${expresion}»`);
  let i = 0;
  const ver = () => tokens[i];
  const tomar = (t?: string) => {
    const x = tokens[i];
    if (t && x !== t) throw new Error(`Se esperaba «${t}» en «${expresion}»`);
    i++;
    return x;
  };
  const empiezaFactor = (t?: string) => !!t && (/^[\d(|]/.test(t) || /^[a-zA-Zπ]/.test(t));

  const suma = (): Nodo => {
    let a = producto();
    while (ver() === '+' || ver() === '-') {
      const op = tomar();
      const b = producto();
      const x = a;
      a = op === '+' ? (v) => x(v) + b(v) : (v) => x(v) - b(v);
    }
    return a;
  };
  const producto = (): Nodo => {
    let a = unario();
    for (;;) {
      if (ver() === '*' || ver() === '/') {
        const op = tomar();
        const b = unario();
        const x = a;
        a = op === '*' ? (v) => x(v) * b(v) : (v) => x(v) / b(v);
      } else if (empiezaFactor(ver()) && ver() !== '|') {
        // Multiplicación implícita: 2x, 3sin(x), (x+1)(x-1)
        const b = potencia();
        const x = a;
        a = (v) => x(v) * b(v);
      } else return a;
    }
  };
  const unario = (): Nodo => {
    if (ver() === '-') {
      tomar();
      const a = unario();
      return (v) => -a(v);
    }
    if (ver() === '+') {
      tomar();
      return unario();
    }
    return potencia();
  };
  const potencia = (): Nodo => {
    const base = primario();
    if (ver() === '^') {
      tomar();
      const exp = unario(); // asociativa por la derecha: 2^3^2 = 2^9
      return (v) => Math.pow(base(v), exp(v));
    }
    return base;
  };
  const primario = (): Nodo => {
    const t = tomar();
    if (t === undefined) throw new Error(`Expresión incompleta: «${expresion}»`);
    if (/^\d/.test(t)) {
      const n = Number(t.replace(',', '.'));
      return () => n;
    }
    if (t === '(') {
      const a = suma();
      tomar(')');
      return a;
    }
    if (t === '|') {
      const a = suma();
      tomar('|');
      return (v) => Math.abs(a(v));
    }
    const nombre = t.toLowerCase();
    if (nombre === 'x') return (v) => v;
    if (nombre in CONSTANTES) {
      const c = CONSTANTES[nombre];
      return () => c;
    }
    if (nombre in FUNCIONES) {
      const f = FUNCIONES[nombre];
      // sin(x) o sin x (sin paréntesis, solo el factor siguiente)
      const arg = ver() === '(' ? (tomar('('), (() => { const a = suma(); tomar(')'); return a; })()) : potencia();
      if (ver() === '^') {
        tomar();
        const exp = unario();
        return (v) => Math.pow(f(arg(v)), exp(v));
      }
      return (v) => f(arg(v));
    }
    throw new Error(`No conozco «${t}» en «${expresion}»`);
  };

  const r = suma();
  if (i < tokens.length) throw new Error(`Sobra «${tokens.slice(i).join(' ')}» en «${expresion}»`);
  return r;
}

// ---------------------------------------------------------------------------
// Utilidades de dibujo

const PALETA = ['#4f6bed', '#e4572e', '#17a589', '#f0a202', '#8e44ad', '#2e86c1', '#c0392b', '#7f8c8d'];
const MESES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

interface Tema {
  texto: string;
  suave: string;
  rejilla: string;
  eje: string;
  fondo: string;
}
const tema = (oscuro: boolean): Tema =>
  oscuro
    ? { texto: '#e5e7eb', suave: '#9ca3af', rejilla: '#374151', eje: '#9ca3af', fondo: 'transparent' }
    : { texto: '#1f2937', suave: '#6b7280', rejilla: '#e5e7eb', eje: '#4b5563', fondo: '#ffffff' };

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => {
  if (Math.abs(n) < 1e-10) return '0';
  const s = Math.abs(n) >= 1e5 || Math.abs(n) < 1e-3 ? n.toExponential(1) : String(Math.round(n * 1000) / 1000);
  return s.replace('.', ',').replace('-', '−');
};

/** Marcas «bonitas» entre a y b (1, 2, 5 × 10^n). */
function marcas(a: number, b: number, n = 6): number[] {
  if (!(b > a)) return [a];
  const paso0 = (b - a) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((p) => p >= paso0) ?? 10 * mag;
  const r: number[] = [];
  for (let v = Math.ceil(a / paso) * paso; v <= b + paso * 1e-9; v += paso) r.push(Math.round(v / paso) * paso);
  return r;
}

function lienzo(ancho: number, alto: number, t: Tema, cuerpo: string, titulo?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" font-family="Inter, Arial, Helvetica, sans-serif">
<rect width="100%" height="100%" fill="${t.fondo}"/>${titulo ? `<text x="${ancho / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="${t.texto}">${esc(titulo)}</text>` : ''}
${cuerpo}</svg>`;
}

function leyenda(items: { nombre: string; color: string; forma?: 'linea' | 'caja' }[], x: number, y: number, t: Tema): string {
  let dx = x;
  return items
    .map((it) => {
      const ancho = 28 + it.nombre.length * 6.6;
      const marca =
        it.forma === 'caja'
          ? `<rect x="${dx}" y="${y - 9}" width="14" height="10" fill="${it.color}" rx="2"/>`
          : `<line x1="${dx}" y1="${y - 4}" x2="${dx + 16}" y2="${y - 4}" stroke="${it.color}" stroke-width="2.5"/>`;
      const s = `${marca}<text x="${dx + 20}" y="${y}" font-size="12" fill="${t.texto}">${esc(it.nombre)}</text>`;
      dx += ancho;
      return s;
    })
    .join('');
}

interface Ejes {
  x0: number; x1: number; y0: number; y1: number; // rango de datos
  izq: number; der: number; arr: number; aba: number; // área de dibujo (px)
}
const px = (e: Ejes, x: number) => e.izq + ((x - e.x0) / (e.x1 - e.x0)) * (e.der - e.izq);
const py = (e: Ejes, y: number) => e.aba - ((y - e.y0) / (e.y1 - e.y0)) * (e.aba - e.arr);

/** Rejilla, ejes cartesianos (por el origen si está a la vista) y marcas. */
function ejesCartesianos(e: Ejes, t: Tema, etiquetaX?: string, etiquetaY?: string): string {
  const mx = marcas(e.x0, e.x1, 8);
  const my = marcas(e.y0, e.y1, 6);
  const ox = e.x0 <= 0 && e.x1 >= 0 ? px(e, 0) : e.izq;
  const oy = e.y0 <= 0 && e.y1 >= 0 ? py(e, 0) : e.aba;
  const rejilla = [
    ...mx.map((v) => `<line x1="${px(e, v)}" y1="${e.arr}" x2="${px(e, v)}" y2="${e.aba}" stroke="${t.rejilla}"/>`),
    ...my.map((v) => `<line x1="${e.izq}" y1="${py(e, v)}" x2="${e.der}" y2="${py(e, v)}" stroke="${t.rejilla}"/>`),
  ].join('');
  const ejes = `<line x1="${e.izq}" y1="${oy}" x2="${e.der + 6}" y2="${oy}" stroke="${t.eje}" stroke-width="1.3" marker-end="url(#flecha)"/>
<line x1="${ox}" y1="${e.aba}" x2="${ox}" y2="${e.arr - 6}" stroke="${t.eje}" stroke-width="1.3" marker-end="url(#flecha)"/>`;
  const textos = [
    ...mx.filter((v) => Math.abs(v) > 1e-12 || ox === e.izq).map((v) => `<text x="${px(e, v)}" y="${oy + 15}" text-anchor="middle" font-size="11" fill="${t.suave}">${num(v)}</text>`),
    ...my.filter((v) => Math.abs(v) > 1e-12 || oy === e.aba).map((v) => `<text x="${ox - 6}" y="${py(e, v) + 4}" text-anchor="end" font-size="11" fill="${t.suave}">${num(v)}</text>`),
    etiquetaX ? `<text x="${e.der + 4}" y="${oy - 8}" text-anchor="end" font-size="12" font-style="italic" fill="${t.texto}">${esc(etiquetaX)}</text>` : '',
    etiquetaY ? `<text x="${ox + 8}" y="${e.arr + 4}" font-size="12" font-style="italic" fill="${t.texto}">${esc(etiquetaY)}</text>` : '',
  ].join('');
  const defs = `<defs><marker id="flecha" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${t.eje}"/></marker></defs>`;
  return defs + rejilla + ejes + textos;
}

// ---------------------------------------------------------------------------
// Tipos de gráfica

interface FuncionSpec {
  expr: string;
  nombre?: string;
  color?: string;
  desde?: number;
  hasta?: number;
  discontinua?: boolean;
}

function grafFunciones(s: any, t: Tema): string {
  const ancho = 640;
  const alto = 420;
  const lista: FuncionSpec[] = (s.funciones ?? (s.funcion ? [s.funcion] : [])).map((f: any) =>
    typeof f === 'string' ? { expr: f } : { ...f, expr: String(f.expr ?? f.expresion ?? f.f ?? '') },
  );
  if (!lista.length) throw new Error('Falta «funciones»');
  const fns = lista.map((f, i) => ({
    ...f,
    f: compilar(f.expr),
    nombre: f.nombre ?? (f.expr.match(/^\s*([a-zA-Z]\w*\s*\(\s*x\s*\))\s*=/)?.[1] ?? f.expr),
    color: f.color ?? PALETA[i % PALETA.length],
  }));
  const [x0, x1] = (s.x ?? [-10, 10]).map(Number);
  // Muestreo y rango vertical automático (descartando valores extremos de las asíntotas)
  const N = 500;
  const muestras = fns.map((f) => {
    const a = Math.max(x0, f.desde ?? x0);
    const b = Math.min(x1, f.hasta ?? x1);
    return Array.from({ length: N + 1 }, (_, k) => {
      const x = a + ((b - a) * k) / N;
      return [x, f.f(x)] as [number, number];
    });
  });
  let y0: number;
  let y1: number;
  if (s.y) [y0, y1] = s.y.map(Number);
  else {
    const ys = muestras.flat().map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (p: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(p * (ys.length - 1))))];
    y0 = Math.min(0, q(0.02));
    y1 = Math.max(0, q(0.98));
    const m = (y1 - y0) * 0.08 || 1;
    y0 -= m;
    y1 += m;
  }
  const e: Ejes = { x0, x1, y0, y1, izq: 50, der: ancho - 24, arr: s.titulo ? 40 : 18, aba: alto - (fns.length > 1 || s.areas ? 52 : 30) };
  const clip = `<clipPath id="area-graf"><rect x="${e.izq}" y="${e.arr}" width="${e.der - e.izq}" height="${e.aba - e.arr}"/></clipPath>`;
  // Áreas (integrales): bajo una función o entre dos
  const areas = (s.areas ?? (s.area ? [s.area] : []))
    .map((a: any) => {
      const buscar = (ref: unknown) => (typeof ref === 'number' ? fns[ref - 1] : fns.find((f) => f.nombre === ref || f.expr === ref)) ?? fns[0];
      const f = buscar(a.funcion);
      const g = a.entre !== undefined ? buscar(a.entre) : undefined;
      const desde = Number(a.desde ?? x0);
      const hasta = Number(a.hasta ?? x1);
      const pasos = 200;
      const arriba: string[] = [];
      const abajo: string[] = [];
      for (let i = 0; i <= pasos; i++) {
        const x = desde + ((hasta - desde) * i) / pasos;
        arriba.push(`${px(e, x)},${py(e, Math.max(y0, Math.min(y1, f.f(x))))}`);
        abajo.unshift(`${px(e, x)},${py(e, Math.max(y0, Math.min(y1, g ? g.f(x) : 0)))}`);
      }
      const color = a.color ?? f.color;
      return `<polygon points="${[...arriba, ...abajo].join(' ')}" fill="${color}" fill-opacity="0.18" stroke="none"/>${
        a.etiqueta ? `<text x="${px(e, (desde + hasta) / 2)}" y="${py(e, (f.f((desde + hasta) / 2) + (g ? g.f((desde + hasta) / 2) : 0)) / 2) + 4}" text-anchor="middle" font-size="13" fill="${t.texto}">${esc(a.etiqueta)}</text>` : ''
      }`;
    })
    .join('');
  // Curvas: se cortan donde la función no existe o salta (asíntotas)
  const curvas = fns
    .map((f, i) => {
      const tramos: string[][] = [[]];
      let previo: number | undefined;
      for (const [x, y] of muestras[i]) {
        const salto = previo !== undefined && Math.abs(y - previo) > (y1 - y0) * 1.5;
        if (!Number.isFinite(y) || salto) {
          if (tramos[tramos.length - 1].length) tramos.push([]);
          previo = Number.isFinite(y) ? y : undefined;
          if (!Number.isFinite(y)) continue;
        }
        const yy = Math.max(y0 - (y1 - y0), Math.min(y1 + (y1 - y0), y));
        tramos[tramos.length - 1].push(`${px(e, x).toFixed(1)},${py(e, yy).toFixed(1)}`);
        previo = y;
      }
      return tramos
        .filter((tr) => tr.length > 1)
        .map((tr) => `<polyline points="${tr.join(' ')}" fill="none" stroke="${f.color}" stroke-width="2.4"${f.discontinua ? ' stroke-dasharray="7 5"' : ''} stroke-linejoin="round"/>`)
        .join('');
    })
    .join('');
  const verticales = (s.verticales ?? [])
    .map((v: any) => {
      const x = Number(typeof v === 'object' ? v.x : v);
      return `<line x1="${px(e, x)}" y1="${e.arr}" x2="${px(e, x)}" y2="${e.aba}" stroke="${t.suave}" stroke-dasharray="5 4"/>${
        typeof v === 'object' && v.etiqueta ? `<text x="${px(e, x) + 4}" y="${e.arr + 12}" font-size="11" fill="${t.suave}">${esc(v.etiqueta)}</text>` : ''
      }`;
    })
    .join('');
  const puntos = (s.puntos ?? [])
    .map((p: any) => {
      const [x, y, etq] = Array.isArray(p) ? p : [p.x, p.y, p.etiqueta];
      const yy = y ?? (fns[0] ? fns[0].f(Number(x)) : 0);
      return `<circle cx="${px(e, Number(x))}" cy="${py(e, Number(yy))}" r="4" fill="${t.texto}"/>${
        etq ? `<text x="${px(e, Number(x)) + 7}" y="${py(e, Number(yy)) - 7}" font-size="12" fill="${t.texto}">${esc(etq)}</text>` : ''
      }`;
    })
    .join('');
  const pie = fns.length > 1 ? leyenda(fns.map((f) => ({ nombre: f.nombre, color: f.color })), e.izq, alto - 14, t) : '';
  return lienzo(
    ancho,
    alto,
    t,
    `<defs>${clip}</defs>${ejesCartesianos(e, t, s.ejeX ?? 'x', s.ejeY ?? 'y')}<g clip-path="url(#area-graf)">${areas}${verticales}${curvas}${puntos}</g>${pie}`,
    s.titulo,
  );
}

/** Líneas, barras o dispersión con categorías o valores en x. */
function grafSeries(s: any, t: Tema, tipo: 'lineas' | 'barras' | 'dispersion'): string {
  const ancho = 640;
  const alto = 400;
  const series: { nombre: string; valores: number[]; color: string; puntos?: [number, number][] }[] = (s.series ?? []).map((x: any, i: number) => ({
    nombre: String(x.nombre ?? `Serie ${i + 1}`),
    valores: (x.valores ?? []).map(Number),
    puntos: x.puntos,
    color: x.color ?? PALETA[i % PALETA.length],
  }));
  if (tipo === 'dispersion' && s.puntos) series.push({ nombre: s.nombre ?? 'Datos', valores: [], puntos: s.puntos, color: PALETA[0] });
  if (!series.length) throw new Error('Falta «series»');
  const cats: string[] = (s.categorias ?? series[0].valores.map((_, i) => String(i + 1))).map(String);
  const todos = tipo === 'dispersion' ? series.flatMap((x) => (x.puntos ?? []).map((p) => Number(p[1]))) : series.flatMap((x) => x.valores);
  let [y0, y1] = s.y ? s.y.map(Number) : [Math.min(0, ...todos), Math.max(...todos)];
  if (!s.y) y1 += (y1 - y0) * 0.08 || 1;
  const conLeyenda = series.length > 1;
  const e: Ejes = { x0: 0, x1: 1, y0, y1, izq: 56, der: ancho - 20, arr: s.titulo ? 42 : 18, aba: alto - (conLeyenda ? 64 : 44) };
  const my = marcas(y0, y1, 6);
  let cuerpo = my
    .map((v) => `<line x1="${e.izq}" y1="${py(e, v)}" x2="${e.der}" y2="${py(e, v)}" stroke="${t.rejilla}"/><text x="${e.izq - 6}" y="${py(e, v) + 4}" text-anchor="end" font-size="11" fill="${t.suave}">${num(v)}</text>`)
    .join('');
  cuerpo += `<line x1="${e.izq}" y1="${py(e, Math.max(y0, 0))}" x2="${e.der}" y2="${py(e, Math.max(y0, 0))}" stroke="${t.eje}"/>`;
  if (tipo === 'dispersion') {
    const xs = series.flatMap((x) => (x.puntos ?? []).map((p) => Number(p[0])));
    const [a, b] = s.x ? s.x.map(Number) : [Math.min(...xs), Math.max(...xs)];
    const ex: Ejes = { ...e, x0: a - (b - a) * 0.05, x1: b + (b - a) * 0.05 };
    cuerpo += marcas(ex.x0, ex.x1, 8).map((v) => `<text x="${px(ex, v)}" y="${e.aba + 16}" text-anchor="middle" font-size="11" fill="${t.suave}">${num(v)}</text>`).join('');
    cuerpo += series.map((se) => (se.puntos ?? []).map((p) => `<circle cx="${px(ex, Number(p[0]))}" cy="${py(ex, Number(p[1]))}" r="4" fill="${se.color}" fill-opacity="0.85"/>`).join('')).join('');
  } else {
    const banda = (e.der - e.izq) / cats.length;
    cuerpo += cats
      .map((c, i) => `<text x="${e.izq + banda * (i + 0.5)}" y="${e.aba + 16}" text-anchor="middle" font-size="11" fill="${t.suave}">${esc(c)}</text>`)
      .join('');
    if (tipo === 'barras') {
      const anchoBarra = (banda * 0.72) / series.length;
      cuerpo += series
        .map((se, k) =>
          se.valores
            .map((v, i) => {
              const x = e.izq + banda * i + banda * 0.14 + anchoBarra * k;
              const ya = py(e, Math.max(v, 0));
              const yb = py(e, Math.min(v, 0));
              return `<rect x="${x}" y="${ya}" width="${anchoBarra - 2}" height="${Math.max(0.5, yb - ya)}" fill="${se.color}" rx="2"/>`;
            })
            .join(''),
        )
        .join('');
    } else {
      cuerpo += series
        .map(
          (se) =>
            `<polyline points="${se.valores.map((v, i) => `${e.izq + banda * (i + 0.5)},${py(e, v)}`).join(' ')}" fill="none" stroke="${se.color}" stroke-width="2.4" stroke-linejoin="round"/>` +
            se.valores.map((v, i) => `<circle cx="${e.izq + banda * (i + 0.5)}" cy="${py(e, v)}" r="3.2" fill="${se.color}"/>`).join(''),
        )
        .join('');
    }
  }
  if (s.ejeY) cuerpo += `<text transform="translate(14 ${(e.arr + e.aba) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${t.texto}">${esc(s.ejeY)}</text>`;
  if (s.ejeX) cuerpo += `<text x="${(e.izq + e.der) / 2}" y="${e.aba + 34}" text-anchor="middle" font-size="12" fill="${t.texto}">${esc(s.ejeX)}</text>`;
  if (conLeyenda) cuerpo += leyenda(series.map((x) => ({ nombre: x.nombre, color: x.color, forma: tipo === 'barras' ? 'caja' : 'linea' })), e.izq, alto - 12, t);
  return lienzo(ancho, alto, t, cuerpo, s.titulo);
}

function grafSectores(s: any, t: Tema): string {
  const datos: [string, number][] = s.datos
    ? Object.entries(s.datos).map(([k, v]) => [k, Number(v)])
    : (s.categorias ?? []).map((c: string, i: number) => [String(c), Number(s.valores?.[i] ?? 0)]);
  if (!datos.length) throw new Error('Faltan «datos»');
  const total = datos.reduce((a, [, v]) => a + v, 0) || 1;
  const ancho = 640;
  const alto = 380;
  const cx = 200;
  const cy = s.titulo ? 205 : 190;
  const r = 140;
  let ang = -Math.PI / 2;
  const sectores = datos
    .map(([nombre, v], i) => {
      const a = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(ang);
      const y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(ang + a);
      const y2 = cy + r * Math.sin(ang + a);
      const medio = ang + a / 2;
      const color = PALETA[i % PALETA.length];
      const pct = `${num(Math.round((v / total) * 1000) / 10)} %`;
      const camino = datos.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` : `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2},${y2} z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
      ang += a;
      const etiqueta = a > 0.25 ? `<text x="${cx + r * 0.62 * Math.cos(medio)}" y="${cy + r * 0.62 * Math.sin(medio) + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">${pct}</text>` : '';
      const fila = `<rect x="390" y="${70 + i * 24}" width="14" height="14" rx="2" fill="${color}"/><text x="412" y="${82 + i * 24}" font-size="13" fill="${t.texto}">${esc(nombre)} (${pct})</text>`;
      return camino + etiqueta + fila;
    })
    .join('');
  return lienzo(ancho, alto, t, sectores, s.titulo);
}

/** Climograma: precipitación en barras (eje izquierdo) y temperatura en línea (eje derecho). */
function grafClimograma(s: any, t: Tema): string {
  const temp: number[] = (s.temperatura ?? []).map(Number);
  const prec: number[] = (s.precipitacion ?? s.precipitación ?? []).map(Number);
  if (temp.length !== 12 || prec.length !== 12) throw new Error('El climograma necesita 12 temperaturas y 12 precipitaciones');
  const ancho = 640;
  const alto = 420;
  // Escala habitual de Gaussen: P = 2T (así se ve la aridez donde la línea supera a las barras)
  const tMin = Math.min(0, Math.floor(Math.min(...temp) / 5) * 5);
  const tMax = Math.max(Math.ceil(Math.max(...temp, Math.max(...prec) / 2) / 5) * 5, 30);
  const e: Ejes = { x0: 0, x1: 12, y0: tMin, y1: tMax, izq: 56, der: ancho - 56, arr: 52, aba: alto - 60 };
  const pp = (p: number) => py(e, p / 2);
  const banda = (e.der - e.izq) / 12;
  let cuerpo = '';
  for (const v of marcas(tMin, tMax, 7)) {
    cuerpo += `<line x1="${e.izq}" y1="${py(e, v)}" x2="${e.der}" y2="${py(e, v)}" stroke="${t.rejilla}"/>`;
    cuerpo += `<text x="${e.der + 6}" y="${py(e, v) + 4}" font-size="11" fill="#c0392b">${num(v)}</text>`;
    if (v >= 0) cuerpo += `<text x="${e.izq - 6}" y="${py(e, v) + 4}" text-anchor="end" font-size="11" fill="#2e86c1">${num(v * 2)}</text>`;
  }
  cuerpo += prec.map((p, i) => `<rect x="${e.izq + banda * i + banda * 0.15}" y="${pp(p)}" width="${banda * 0.7}" height="${Math.max(0, pp(0) - pp(p))}" fill="#5dade2" rx="2"/>`).join('');
  cuerpo += `<line x1="${e.izq}" y1="${py(e, 0)}" x2="${e.der}" y2="${py(e, 0)}" stroke="${t.eje}"/>`;
  cuerpo += `<polyline points="${temp.map((v, i) => `${e.izq + banda * (i + 0.5)},${py(e, v)}`).join(' ')}" fill="none" stroke="#c0392b" stroke-width="2.6"/>`;
  cuerpo += temp.map((v, i) => `<circle cx="${e.izq + banda * (i + 0.5)}" cy="${py(e, v)}" r="3.2" fill="#c0392b"/>`).join('');
  cuerpo += MESES.map((m, i) => `<text x="${e.izq + banda * (i + 0.5)}" y="${e.aba + 16}" text-anchor="middle" font-size="12" fill="${t.suave}">${m}</text>`).join('');
  cuerpo += `<text x="${e.izq}" y="${e.arr - 10}" font-size="12" fill="#2e86c1">P (mm)</text><text x="${e.der}" y="${e.arr - 10}" text-anchor="end" font-size="12" fill="#c0392b">T (°C)</text>`;
  const tm = temp.reduce((a, b) => a + b, 0) / 12;
  const pt = prec.reduce((a, b) => a + b, 0);
  cuerpo += `<text x="${ancho / 2}" y="${alto - 18}" text-anchor="middle" font-size="12" fill="${t.texto}">Temperatura media anual: ${num(Math.round(tm * 10) / 10)} °C · Precipitación total: ${num(Math.round(pt))} mm</text>`;
  return lienzo(ancho, alto, t, cuerpo, s.titulo ?? (s.lugar ? `Climograma de ${s.lugar}` : undefined));
}

/** Pirámide de población: hombres a la izquierda y mujeres a la derecha, de jóvenes (abajo) a mayores. */
function grafPiramide(s: any, t: Tema): string {
  const grupos: string[] = (s.grupos ?? []).map(String);
  const h: number[] = (s.hombres ?? []).map(Number);
  const m: number[] = (s.mujeres ?? []).map(Number);
  if (!grupos.length || h.length !== grupos.length || m.length !== grupos.length) throw new Error('La pirámide necesita «grupos», «hombres» y «mujeres» con el mismo número de valores');
  const ancho = 640;
  const fila = Math.max(12, Math.min(22, 360 / grupos.length));
  const arr = s.titulo ? 50 : 26;
  const alto = arr + fila * grupos.length + 54;
  const centro = ancho / 2;
  const hueco = 34;
  const maxV = Math.max(...h, ...m);
  const mx = marcas(0, maxV, 4);
  const tope = mx[mx.length - 1] || maxV;
  const escala = (centro - hueco - 30) / tope;
  const unidad = s.unidad ?? '';
  let cuerpo = '';
  for (const v of mx) {
    for (const lado of [-1, 1]) {
      const x = centro + lado * (hueco + v * escala);
      cuerpo += `<line x1="${x}" y1="${arr}" x2="${x}" y2="${arr + fila * grupos.length}" stroke="${t.rejilla}"/><text x="${x}" y="${arr + fila * grupos.length + 15}" text-anchor="middle" font-size="10.5" fill="${t.suave}">${num(v)}${unidad}</text>`;
    }
  }
  grupos.forEach((g, i) => {
    const y = arr + fila * (grupos.length - 1 - i);
    cuerpo += `<rect x="${centro - hueco - h[i] * escala}" y="${y + 1}" width="${h[i] * escala}" height="${fila - 2}" fill="#4f81bd"/>`;
    cuerpo += `<rect x="${centro + hueco}" y="${y + 1}" width="${m[i] * escala}" height="${fila - 2}" fill="#d9707d"/>`;
    cuerpo += `<text x="${centro}" y="${y + fila / 2 + 4}" text-anchor="middle" font-size="${Math.min(11, fila - 2)}" fill="${t.texto}">${esc(g)}</text>`;
  });
  cuerpo += `<text x="${centro - hueco - 4}" y="${alto - 14}" text-anchor="end" font-size="13" font-weight="600" fill="#4f81bd">Hombres</text><text x="${centro + hueco + 4}" y="${alto - 14}" font-size="13" font-weight="600" fill="#d9707d">Mujeres</text>`;
  return lienzo(ancho, alto, t, cuerpo, s.titulo);
}

/** SVG de un bloque ```grafica (YAML). `oscuro`: colores para la vista previa en modo oscuro. */
export function dibujarGrafica(contenido: string, oscuro = false): string {
  let s: any;
  try {
    s = cargarYaml(contenido);
  } catch (e) {
    throw new Error(`YAML no válido: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!s || typeof s !== 'object') throw new Error('La gráfica está vacía');
  const t = tema(oscuro);
  const tipo = String(s.tipo ?? (s.funciones || s.funcion ? 'funcion' : 'lineas')).toLowerCase();
  switch (tipo) {
    case 'funcion':
    case 'funciones':
      return grafFunciones(s, t);
    case 'lineas':
    case 'líneas':
      return grafSeries(s, t, 'lineas');
    case 'barras':
      return grafSeries(s, t, 'barras');
    case 'dispersion':
    case 'dispersión':
      return grafSeries(s, t, 'dispersion');
    case 'sectores':
    case 'tarta':
      return grafSectores(s, t);
    case 'climograma':
      return grafClimograma(s, t);
    case 'piramide':
    case 'pirámide':
      return grafPiramide(s, t);
    default:
      throw new Error(`Tipo de gráfica desconocido: «${tipo}»`);
  }
}
