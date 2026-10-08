// Química en los apuntes:
// - Fórmulas y reacciones con la notación mhchem dentro de las fórmulas: $\ce{2H2 + O2 -> 2H2O}$.
//   La vista previa (KaTeX + extensión mhchem) la entiende; para exportar, Pandoc no, así que se
//   traduce a LaTeX normal con la librería oficial de mhchem y se simplifica.
// - Estructuras de moléculas: bloques ```molecula con el nombre (en inglés, como en PubChem) o el
//   SMILES, seguidos opcionalmente de la línea «*Figura: pie*».
// La traducción de mhchem para exportar está en server/quimica.ts.

/** Bloques ```molecula, con su contenido y el pie de figura que los sigue (si lo hay). */
export const PATRON_MOLECULA = /```molecula[^\n]*\n([\s\S]*?)```(?:[ \t]*\n\s*\n?[ \t]*\*Figura:\s*([^*\n]+)\*)?/g;

/** Lo que identifica a una molécula en un bloque: la primera línea no vacía. */
export function consultaMolecula(contenido: string) {
  return contenido.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}
