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
