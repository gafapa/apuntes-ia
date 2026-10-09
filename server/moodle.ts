// Autoevaluación en formato GIFT, el que importan Moodle y las plataformas basadas en él (Aules,
// EducaMadrid, Educamos…): Banco de preguntas › Importar › Formato GIFT.

export interface PreguntaAutoevaluacion {
  tipo: 'test' | 'vf' | 'corta' | 'desarrollo';
  enunciado: string;
  opciones?: string[]; // test
  correcta?: number | boolean; // test: índice (desde 0); vf: true/false
  respuestas?: string[]; // corta: respuestas aceptadas
  explicacion?: string; // retroalimentación o respuesta modelo
}

/** Escapa los caracteres especiales de GIFT y pasa las fórmulas $…$ a la notación de MathJax de Moodle. */
function texto(s: string): string {
  return String(s ?? '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, f: string) => `\\\\[${f}\\\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_m, f: string) => `\\\\(${f}\\\\)`)
    .replace(/([~=#{}:])/g, '\\$1')
    .replace(/\n/g, '\\n')
    .trim();
}

export function generarGift(preguntas: PreguntaAutoevaluacion[], titulo: string): string {
  const lineas: string[] = [`// Autoevaluación: ${titulo}`, `// Generado por Apuntes IA`, '', `$CATEGORY: $course$/top/${titulo.replace(/[/\n]/g, ' ')}`, ''];
  preguntas.forEach((p, i) => {
    // El nombre (lo que se ve en el banco de preguntas) va sin fórmulas ni formato
    const plano = p.enunciado.replace(/\$+([^$]+)\$+/g, '$1').replace(/[*_`\\]/g, '').replace(/\s+/g, ' ').slice(0, 60);
    const nombre = `::${String(i + 1).padStart(2, '0')}. ${plano.replace(/([~=#{}:])/g, '\\$1')}::[markdown]${texto(p.enunciado)}`;
    const fb = p.explicacion ? `#${texto(p.explicacion)}` : '';
    if (p.tipo === 'test' && p.opciones?.length) {
      const correcta = typeof p.correcta === 'number' ? p.correcta : 0;
      lineas.push(`${nombre} {`);
      p.opciones.forEach((o, k) => lineas.push(`  ${k === correcta ? '=' : '~'}${texto(o)}${k === correcta ? fb : ''}`));
      lineas.push('}');
    } else if (p.tipo === 'vf') {
      lineas.push(`${nombre} {${p.correcta === false ? 'FALSE' : 'TRUE'}${fb}}`);
    } else if (p.tipo === 'corta' && p.respuestas?.length) {
      lineas.push(`${nombre} {`, ...p.respuestas.map((r) => `  =${texto(r)}${fb}`), '}');
    } else {
      // Desarrollo (o corta sin respuestas cerradas): pregunta abierta, con la respuesta modelo como comentario
      lineas.push(`${nombre} {${fb ? `####${texto(p.explicacion!)}` : ''}}`);
    }
    lineas.push('');
  });
  return lineas.join('\n');
}
