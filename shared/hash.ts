/** djb2: identificador estable y corto para un texto (lo usan el servidor y la interfaz). */
export function hashTexto(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Bloques ```mermaid de un Markdown, con su código y el pie de figura que los sigue (si lo hay). */
export const PATRON_MERMAID = /```mermaid[^\n]*\n([\s\S]*?)```(?:[ \t]*\n\s*\n?[ \t]*\*Figura:\s*([^*\n]+)\*)?/g;
