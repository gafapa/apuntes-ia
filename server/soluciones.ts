// Soluciones de los ejercicios: en los apuntes van en bloques
//   ::: solucion
//   …
//   :::
// justo después del enunciado. Al exportar se dejan en el texto, se llevan a un solucionario al
// final del documento o se quitan (versión para el alumnado sin soluciones).

export type ModoSoluciones = 'texto' | 'final' | 'ninguna';

const PATRON = /^:::+[ \t]*soluci[oó]n(?:es)?[ \t]*\n([\s\S]*?)\n:::+[ \t]*$/gim;

/** ¿Tiene el texto algún bloque de solución? */
export const tieneSoluciones = (md: string) => new RegExp(PATRON.source, 'im').test(md);

export function prepararSoluciones(md: string, modo: ModoSoluciones = 'texto', titulo = 'Solucionario', salto = ''): string {
  if (modo === 'texto') {
    // Como cita destacada que empieza por «Solución.»
    return md.replace(PATRON, (_m, cuerpo: string) => {
      const lineas = cuerpo.trim().split('\n');
      lineas[0] = `**Solución.** ${lineas[0]}`;
      return lineas.map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
    });
  }
  if (modo === 'ninguna') return md.replace(PATRON, '').replace(/\n{3,}/g, '\n\n');
  // Al final: cada solución se numera y en su lugar queda una referencia
  const soluciones: { n: number; apartado: string; cuerpo: string }[] = [];
  // El apartado de cada solución es el último título que aparece antes de ella
  const titulos = [...md.matchAll(/^#{1,4}\s+(.+?)\s*(?:\{[^}]*\})?\s*$/gm)].map((m) => ({ pos: m.index ?? 0, texto: m[1] }));
  const cuerpo = md.replace(PATRON, (_m, texto: string, pos: number) => {
    const n = soluciones.length + 1;
    const anterior = titulos.filter((t) => t.pos < pos).pop();
    soluciones.push({ n, apartado: anterior?.texto ?? '', cuerpo: texto.trim() });
    return `*(Solución en el solucionario, n.º ${n})*`;
  });
  if (!soluciones.length) return md;
  const final = soluciones.map((s) => `**Solución ${s.n}**${s.apartado ? ` (${s.apartado})` : ''}\n\n${s.cuerpo}`).join('\n\n');
  return `${cuerpo.trimEnd()}\n\n${salto}\n\n# ${titulo} {.unnumbered}\n\n${final}\n`;
}
