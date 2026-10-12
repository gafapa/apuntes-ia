// Bloques de actividades de autoevaluación: cada bloque se genera por separado (un tipo, una
// cantidad, una dificultad y unas secciones) y se marca para incluirlo o no en los apuntes. Su
// texto se genera aquí, igual para la vista previa y para la exportación.
import { hashTexto } from './hash';

export type TipoActividad = 'test' | 'vf' | 'corta' | 'desarrollo' | 'ejercicio' | 'emparejar' | 'huecos';
export type Dificultad = 'basica' | 'media' | 'avanzada' | 'mixta';

export const TIPOS_ACTIVIDAD: { id: TipoActividad; nombre: string; ayuda: string }[] = [
  { id: 'test', nombre: 'Tipo test', ayuda: 'Cuatro opciones, una correcta' },
  { id: 'vf', nombre: 'Verdadero o falso', ayuda: 'Afirmaciones para juzgar' },
  { id: 'corta', nombre: 'Respuesta corta', ayuda: 'Una palabra, un dato o una frase' },
  { id: 'huecos', nombre: 'Completar huecos', ayuda: 'Frases con una palabra que falta' },
  { id: 'emparejar', nombre: 'Relacionar', ayuda: 'Unir cada elemento con su pareja' },
  { id: 'desarrollo', nombre: 'Desarrollo', ayuda: 'Preguntas abiertas de explicar o relacionar' },
  { id: 'ejercicio', nombre: 'Ejercicios prácticos', ayuda: 'Problemas o casos para resolver' },
];

export const DIFICULTADES: { id: Dificultad; nombre: string }[] = [
  { id: 'basica', nombre: 'Básica' },
  { id: 'media', nombre: 'Media' },
  { id: 'avanzada', nombre: 'Avanzada' },
  { id: 'mixta', nombre: 'Mixta (de menos a más)' },
];

export interface PreguntaActividad {
  tipo?: TipoActividad; // en los bloques antiguos (de un solo tipo) falta: es el del bloque
  enunciado: string; // en «huecos», el hueco se marca con ___
  opciones?: string[]; // test
  correcta?: number | boolean; // test: índice desde 0; vf: verdadero o falso
  respuestas?: string[]; // corta y huecos: respuestas aceptadas
  pares?: [string, string][]; // emparejar
  explicacion?: string; // explicación de la respuesta o solución resuelta
}

export interface OpcionesActividad {
  /** Cuántas preguntas de cada tipo (un bloque puede mezclar varios tipos). */
  tipos: Partial<Record<TipoActividad, number>>;
  /** Bloques antiguos, de un solo tipo. */
  tipo?: TipoActividad;
  cantidad?: number;
  dificultad: Dificultad;
  secciones: string[]; // vacío: todo el documento
  soluciones: boolean; // incluir las soluciones explicadas
  titulo?: string;
  indicaciones?: string;
}

export interface BloqueActividad {
  /** Original imported Markdown, preserved independently of generated question formatting. */
  importedContent?: { markdown: string; solutionsMarkdown?: string };
  id: string;
  titulo: string;
  opciones: OpcionesActividad;
  estado: 'generando' | 'lista' | 'error';
  error?: string;
  incluir: boolean; // si va en los apuntes
  preguntas: PreguntaActividad[];
  creado: string;
  actualizado: string;
}

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';

/** Orden estable (no aleatorio en cada exportación) para la columna derecha de «relacionar». */
function barajar<T>(lista: T[], semilla: string): T[] {
  return lista
    .map((x, i) => ({ x, k: hashTexto(`${semilla}-${i}`) }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((e) => e.x);
}

/** Cantidad de cada tipo pedida para un bloque (también para los antiguos, de un solo tipo). */
export function tiposDe(op: OpcionesActividad): [TipoActividad, number][] {
  const tipos = op.tipos && Object.keys(op.tipos).length ? op.tipos : op.tipo ? { [op.tipo]: op.cantidad ?? 0 } : {};
  return TIPOS_ACTIVIDAD.map((t) => [t.id, Math.max(0, Math.round(Number(tipos[t.id]) || 0))] as [TipoActividad, number]).filter(([, n]) => n > 0);
}

/** Tipo de una pregunta (en los bloques antiguos, el del bloque). */
export const tipoDe = (p: PreguntaActividad, b: BloqueActividad): TipoActividad => p.tipo ?? b.opciones.tipo ?? 'test';

/** «5 tipo test · 3 verdadero o falso». */
export function resumenTipos(op: OpcionesActividad): string {
  return tiposDe(op)
    .map(([t, n]) => `${n} ${TIPOS_ACTIVIDAD.find((x) => x.id === t)!.nombre.toLowerCase()}`)
    .join(' · ');
}

/** Markdown de un bloque: preguntas y, si se piden, sus soluciones en un bloque «::: solucion». */
export function bloqueAMarkdown(b: BloqueActividad, nivel = 2): string {
  if (b.importedContent) {
    const solutions = b.opciones.soluciones && b.importedContent.solutionsMarkdown;
    return `${'#'.repeat(nivel)} ${b.titulo}\n\n${b.importedContent.markdown}${solutions ? `\n\n::: solucion\n${b.importedContent.solutionsMarkdown}\n:::` : ''}`;
  }
  const partes: string[] = [`${'#'.repeat(nivel)} ${b.titulo}`];
  const soluciones: string[] = [];
  // Con varios tipos, cada grupo lleva su rótulo (las preguntas se numeran seguidas en todo el bloque)
  const mezcla = new Set(b.preguntas.map((p) => tipoDe(p, b))).size > 1;
  let anterior: TipoActividad | undefined;
  b.preguntas.forEach((p, i) => {
    const n = i + 1;
    const t = tipoDe(p, b);
    if (mezcla && t !== anterior) {
      partes.push(`**${TIPOS_ACTIVIDAD.find((x) => x.id === t)!.nombre}**`, '');
      anterior = t;
    }
    if (t === 'emparejar' && p.pares?.length) {
      const derecha = barajar(p.pares.map((x) => x[1]), b.id + i);
      partes.push(
        `${n}. ${p.enunciado || 'Relaciona cada elemento de la izquierda con el de la derecha.'}`,
        '',
        '| | Columna A | | Columna B |',
        '|---|---|---|---|',
        ...p.pares.map((par, k) => `| ${k + 1} | ${par[0]} | ${LETRAS[k]} | ${derecha[k]} |`),
      );
      soluciones.push(`${n}. ${p.pares.map((par, k) => `${k + 1}-${LETRAS[derecha.indexOf(par[1])]}`).join(', ')}${p.explicacion ? `. ${p.explicacion}` : ''}`);
    } else if (t === 'test' && p.opciones?.length) {
      // Letra en negrita: «a)» suelto lo toma Pandoc como inicio de una lista con letras
      partes.push(`${n}. ${p.enunciado}`, ...p.opciones.map((o, k) => `    - **${LETRAS[k]})** ${o}`));
      const c = typeof p.correcta === 'number' ? p.correcta : 0;
      soluciones.push(`${n}. **${LETRAS[c]})** ${p.opciones[c] ?? ''}${p.explicacion ? ` — ${p.explicacion}` : ''}`);
    } else if (t === 'vf') {
      partes.push(`${n}. ${p.enunciado} **(V / F)**`);
      soluciones.push(`${n}. **${p.correcta === false ? 'Falso' : 'Verdadero'}**${p.explicacion ? `. ${p.explicacion}` : ''}`);
    } else {
      partes.push(`${n}. ${p.enunciado}`);
      const resp = p.respuestas?.length ? p.respuestas.join(' / ') : '';
      if (resp || p.explicacion) soluciones.push(`${n}. ${resp ? `**${resp}**` : ''}${resp && p.explicacion ? '. ' : ''}${p.explicacion ?? ''}`);
    }
    partes.push('');
  });
  let md = partes.join('\n').trim();
  if (b.opciones.soluciones && soluciones.length) md += `\n\n::: solucion\n${soluciones.join('\n\n')}\n:::`;
  return md;
}

/** Sección de autoevaluación con los bloques marcados para incluir (vacío si no hay ninguno). */
export function actividadesAMarkdown(bloques: BloqueActividad[], titulo = 'Autoevaluación'): string {
  const incluidos = bloques.filter((b) => b.incluir && b.estado === 'lista' && b.preguntas.length);
  if (!incluidos.length) return '';
  return `# ${titulo}\n\n${incluidos.map((b) => bloqueAMarkdown(b)).join('\n\n')}`;
}
