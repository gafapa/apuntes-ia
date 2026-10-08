// Genera shared/catalogo/fp.json a partir del catálogo oficial de títulos de FP del
// Ministerio de Educación, Formación Profesional y Deportes (https://www.todofp.es).
// Uso: node scripts/catalogo-fp.mjs
import fs from 'node:fs';

const BASE = 'https://www.todofp.es';
const RAIZ = `${BASE}/que-estudiar/familias-profesionales.html`;

const entidades = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª', nbsp: ' ', amp: '&', quot: '"', laquo: '«', raquo: '»', ndash: '–', mdash: '—', iexcl: '¡', iquest: '¿', middot: '·', ccedil: 'ç', agrave: 'à', egrave: 'è', ograve: 'ò' };
const decodificar = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, e) => entidades[e] ?? m)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function pagina(url) {
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ApuntesIA/1.0 (catálogo educativo)' } });
      if (r.ok) return await r.text();
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`No se pudo descargar ${url}`);
}

const pausa = () => new Promise((r) => setTimeout(r, 250));

function nivelDe(nombre) {
  if (/^T[íi]tulo Profesional B[áa]sico/i.test(nombre)) return 'fp-basica';
  if (/^T[ée]cnico Superior/i.test(nombre)) return 'fp-superior';
  if (/^T[ée]cnico (en|de)/i.test(nombre)) return 'fp-medio';
  return null; // cursos de especialización y otros
}

const raiz = await pagina(RAIZ);
const familias = [...new Set([...raiz.matchAll(/href="(\/que-estudiar\/familias-profesionales\/[a-z0-9-]+\.html)"/g)].map((m) => m[1]))];
console.log(`${familias.length} familias profesionales`);

const resultado = { fuente: RAIZ, generado: new Date().toISOString().slice(0, 10), familias: [] };

for (const urlFamilia of familias) {
  const html = await pagina(BASE + urlFamilia);
  const nombreFamilia = decodificar(html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? urlFamilia);
  const prefijo = urlFamilia.replace(/\.html$/, '/');
  // Enlaces a títulos: <a href="/.../familia/titulo.html">Nombre del título</a>
  const titulos = new Map();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1];
    if (!href.startsWith(prefijo) || href.includes('/curriculos-ccaa') || !href.endsWith('.html')) continue;
    const nombre = decodificar(m[2]);
    if (!nombre || !nivelDe(nombre)) continue;
    titulos.set(href, nombre);
  }
  const familia = { nombre: nombreFamilia, titulos: [] };
  for (const [href, nombre] of titulos) {
    await pausa();
    const ficha = await pagina(BASE + href);
    const horas = ficha.match(/<p class="horas">\s*(\d+)\s*h/)?.[1];
    const i = ficha.search(/<h2>Plan de formaci/);
    let modulos = [];
    if (i >= 0) {
      const ul = ficha.slice(i).match(/<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
      modulos = [...ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((x) => decodificar(x[1]).replace(/\.$/, ''))
        .filter((x) => x && !/^Incluye una fase|^M[óo]dulo profesional optativo/i.test(x))
        .map((x) => {
          const c = x.match(/^(\d{4})\.\s*(.+)$/);
          return c ? { codigo: c[1], nombre: c[2] } : { nombre: x };
        });
    }
    familia.titulos.push({ nombre, nivel: nivelDe(nombre), horas: horas ? Number(horas) : undefined, url: BASE + href, modulos });
    process.stdout.write(`  ${nivelDe(nombre)}  ${nombre} (${modulos.length} módulos)\n`);
  }
  familia.titulos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  resultado.familias.push(familia);
}

resultado.familias.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
fs.mkdirSync('shared/catalogo', { recursive: true });
fs.writeFileSync('shared/catalogo/fp.json', JSON.stringify(resultado, null, 1) + '\n');
const total = resultado.familias.reduce((n, f) => n + f.titulos.length, 0);
console.log(`\n${total} títulos guardados en shared/catalogo/fp.json`);
