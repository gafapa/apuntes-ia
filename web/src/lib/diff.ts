// Diferencias palabra a palabra (LCS) para mostrar las sugerencias de los revisores.

export type Trozo = { tipo: 'igual' | 'quitado' | 'puesto'; texto: string };

function fichas(s: string) {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

export function diferencias(antes: string, despues: string): Trozo[] {
  const a = fichas(antes);
  const b = fichas(despues);
  // Textos muy largos: no merece la pena el LCS completo
  if (a.length * b.length > 400_000) {
    return [
      { tipo: 'quitado', texto: antes },
      { tipo: 'puesto', texto: despues },
    ];
  }
  const n = a.length;
  const m = b.length;
  const tabla = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabla[i][j] = a[i] === b[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
    }
  }
  const res: Trozo[] = [];
  const meter = (tipo: Trozo['tipo'], texto: string) => {
    const ultimo = res[res.length - 1];
    if (ultimo?.tipo === tipo) ultimo.texto += texto;
    else res.push({ tipo, texto });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      meter('igual', a[i]);
      i++;
      j++;
    } else if (tabla[i + 1][j] >= tabla[i][j + 1]) {
      meter('quitado', a[i++]);
    } else {
      meter('puesto', b[j++]);
    }
  }
  while (i < n) meter('quitado', a[i++]);
  while (j < m) meter('puesto', b[j++]);
  return res;
}

export type Linea = { tipo: 'igual' | 'quitado' | 'puesto'; texto: string; trozos?: Trozo[] };

/**
 * Diferencias línea a línea (para comparar secciones enteras). Cuando una línea cambia por otra
 * parecida, se marcan además las palabras que cambian dentro de ella.
 */
export function diferenciasLineas(antes: string, despues: string): Linea[] {
  const a = antes.replace(/\r\n?/g, '\n').split('\n');
  const b = despues.replace(/\r\n?/g, '\n').split('\n');
  // Lo común al principio y al final no entra en la tabla (las secciones suelen cambiar poco)
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fa = a.length;
  let fb = b.length;
  while (fa > ini && fb > ini && a[fa - 1] === b[fb - 1]) {
    fa--;
    fb--;
  }
  const ma = a.slice(ini, fa);
  const mb = b.slice(ini, fb);
  const res: Linea[] = a.slice(0, ini).map((texto) => ({ tipo: 'igual', texto }));
  const n = ma.length;
  const m = mb.length;
  if (n * m > 4_000_000) {
    res.push(...ma.map((texto) => ({ tipo: 'quitado' as const, texto })), ...mb.map((texto) => ({ tipo: 'puesto' as const, texto })));
  } else {
    const tabla = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) tabla[i][j] = ma[i] === mb[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    const tramo: Linea[] = [];
    const cerrarTramo = () => {
      // Quitadas y puestas seguidas: se emparejan para resaltar las palabras
      const q = tramo.filter((l) => l.tipo === 'quitado');
      const p = tramo.filter((l) => l.tipo === 'puesto');
      if (q.length && q.length === p.length) {
        q.forEach((l, k) => {
          const t = diferencias(l.texto, p[k].texto);
          const iguales = t.filter((x) => x.tipo === 'igual').reduce((s, x) => s + x.texto.trim().length, 0);
          if (iguales > 0.4 * Math.max(l.texto.length, p[k].texto.length)) {
            l.trozos = t.filter((x) => x.tipo !== 'puesto');
            p[k].trozos = t.filter((x) => x.tipo !== 'quitado');
          }
        });
      }
      res.push(...q, ...p);
      tramo.length = 0;
    };
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        cerrarTramo();
        res.push({ tipo: 'igual', texto: ma[i] });
        i++;
        j++;
      } else if (j >= m || (i < n && tabla[i + 1][j] >= tabla[i][j + 1])) tramo.push({ tipo: 'quitado', texto: ma[i++] });
      else tramo.push({ tipo: 'puesto', texto: mb[j++] });
    }
    cerrarTramo();
  }
  res.push(...a.slice(fa).map((texto) => ({ tipo: 'igual' as const, texto })));
  return res;
}
