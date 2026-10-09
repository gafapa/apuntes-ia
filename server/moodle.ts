// Actividades en formato GIFT, el que importan Moodle y las plataformas basadas en él (Aules,
// EducaMadrid, Educamos…): Banco de preguntas › Importar › Formato GIFT. Cada bloque va en su
// propia subcategoría.
import { tipoDe, type BloqueActividad, type PreguntaActividad, type TipoActividad } from '../shared/actividades';

/** Escapa los caracteres especiales de GIFT y pasa las fórmulas $…$ a la notación de MathJax de Moodle. */
function texto(s: string): string {
  return String(s ?? '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, f: string) => `\\\\[${f}\\\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_m, f: string) => `\\\\(${f}\\\\)`)
    .replace(/([~=#{}:])/g, '\\$1')
    .replace(/\n/g, '\\n')
    .trim();
}

/** Nombre de la pregunta en el banco: sin fórmulas ni formato. */
const plano = (s: string) =>
  s
    .replace(/\$+([^$]+)\$+/g, '$1')
    .replace(/[*_`\\]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .replace(/([~=#{}:])/g, '\\$1');

function pregunta(tipo: TipoActividad, p: PreguntaActividad, n: number): string {
  const cabecera = `::${String(n).padStart(2, '0')}. ${plano(p.enunciado || 'Relaciona')}::[markdown]`;
  const fb = p.explicacion ? `#${texto(p.explicacion)}` : '';
  switch (tipo) {
    case 'test': {
      const c = typeof p.correcta === 'number' ? p.correcta : 0;
      return [`${cabecera}${texto(p.enunciado)} {`, ...(p.opciones ?? []).map((o, k) => `  ${k === c ? '=' : '~'}${texto(o)}${k === c ? fb : ''}`), '}'].join('\n');
    }
    case 'vf':
      return `${cabecera}${texto(p.enunciado)} {${p.correcta === false ? 'FALSE' : 'TRUE'}${fb}}`;
    case 'corta':
      return [`${cabecera}${texto(p.enunciado)} {`, ...(p.respuestas ?? []).map((r) => `  =${texto(r)}${fb}`), '}'].join('\n');
    case 'huecos': {
      // Palabra que falta: el hueco se sustituye por las respuestas aceptadas
      const [antes, ...resto] = p.enunciado.split(/_{3,}/);
      const respuestas = (p.respuestas ?? []).map((r) => `=${texto(r)}`).join(' ');
      return resto.length ? `${cabecera}${texto(antes)} {${respuestas}${fb}} ${texto(resto.join('___'))}` : `${cabecera}${texto(p.enunciado)} {${respuestas}${fb}}`;
    }
    case 'emparejar':
      return [`${cabecera}${texto(p.enunciado || 'Relaciona cada elemento con su pareja.')} {`, ...(p.pares ?? []).map(([a, b]) => `  =${texto(a)} -> ${texto(b)}`), '}'].join('\n');
    default:
      // Desarrollo y ejercicios: pregunta abierta, con la solución modelo como comentario general
      return `${cabecera}${texto(p.enunciado)} {${p.explicacion ? `####${texto(p.explicacion)}` : ''}}`;
  }
}

export function generarGift(bloques: BloqueActividad[], titulo: string): string {
  const raiz = titulo.replace(/[/\n]/g, ' ');
  const lineas: string[] = [`// Autoevaluación: ${titulo}`, '// Generado por Apuntes IA', ''];
  let n = 0;
  for (const b of bloques) {
    lineas.push(`$CATEGORY: $course$/top/${raiz}/${b.titulo.replace(/[/\n]/g, ' ')}`, '');
    for (const p of b.preguntas) {
      lineas.push(pregunta(tipoDe(p, b), p, ++n), '');
    }
  }
  return lineas.join('\n');
}
