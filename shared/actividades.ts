// Bloques de actividades de autoevaluación: cada bloque se genera por separado (un tipo, una
// cantidad, una dificultad y unas secciones) y se marca para incluirlo o no en los apuntes. Su
// texto se genera aquí, igual para la vista previa y para la exportación. Los tipos de pregunta y
// su texto son los mismos en los exámenes (examenes.ts).

export type TipoActividad =
  | 'test'
  | 'multiple'
  | 'numerica'
  | 'vf'
  | 'vfjustificada'
  | 'corta'
  | 'huecos'
  | 'banco'
  | 'tabla'
  | 'emparejar'
  | 'ordenar'
  | 'clasificar'
  | 'error'
  | 'definicion'
  | 'abierta'
  | 'desarrollo'
  | 'ejercicio'
  | 'esquema'
  | 'redaccion'
  | 'caso'
  | 'datos'
  | 'comentario';
export type Dificultad = 'basica' | 'media' | 'avanzada' | 'mixta';

/** Tipos de pregunta: los de respuesta cerrada se corrigen con una clave; los abiertos, con criterio (o rúbrica). */
export const TIPOS_ACTIVIDAD: { id: TipoActividad; nombre: string; ayuda: string; abierta?: boolean }[] = [
  { id: 'test', nombre: 'Tipo test', ayuda: 'Cuatro opciones, una correcta' },
  { id: 'multiple', nombre: 'Respuesta múltiple', ayuda: 'Varias opciones correctas' },
  { id: 'numerica', nombre: 'Respuesta numérica', ayuda: 'Un cálculo con su resultado y unidades' },
  { id: 'vf', nombre: 'Verdadero o falso', ayuda: 'Afirmaciones para juzgar' },
  { id: 'vfjustificada', nombre: 'V o F justificada', ayuda: 'Verdadero o falso, explicando por qué' },
  { id: 'corta', nombre: 'Respuesta corta', ayuda: 'Una palabra, un dato o una frase' },
  { id: 'huecos', nombre: 'Completar huecos', ayuda: 'Frases con una palabra que falta' },
  { id: 'banco', nombre: 'Texto con huecos', ayuda: 'Un párrafo con varios huecos y un banco de palabras' },
  { id: 'tabla', nombre: 'Completar tabla', ayuda: 'Una tabla con casillas vacías' },
  { id: 'emparejar', nombre: 'Relacionar', ayuda: 'Unir cada elemento con su pareja' },
  { id: 'ordenar', nombre: 'Ordenar', ayuda: 'Pasos, etapas o fechas en su orden' },
  { id: 'clasificar', nombre: 'Clasificar', ayuda: 'Repartir elementos en categorías' },
  { id: 'error', nombre: 'Encuentra el error', ayuda: 'Una afirmación o resolución con un error que corregir' },
  { id: 'definicion', nombre: 'Definiciones', ayuda: 'Definir conceptos con precisión', abierta: true },
  { id: 'abierta', nombre: 'Pregunta abierta', ayuda: 'Respuesta breve y razonada, en unas líneas', abierta: true },
  { id: 'desarrollo', nombre: 'Desarrollo', ayuda: 'Temas o preguntas largas de explicar y relacionar', abierta: true },
  { id: 'ejercicio', nombre: 'Ejercicios prácticos', ayuda: 'Problemas para resolver', abierta: true },
  { id: 'esquema', nombre: 'Dibujo o esquema', ayuda: 'Dibujar, representar o completar un esquema', abierta: true },
  { id: 'redaccion', nombre: 'Redacción', ayuda: 'Producción escrita o argumentación con extensión pedida', abierta: true },
  { id: 'caso', nombre: 'Caso práctico', ayuda: 'Una situación real con varios apartados', abierta: true },
  { id: 'datos', nombre: 'Análisis de datos', ayuda: 'Interpretar una tabla o unos datos', abierta: true },
  { id: 'comentario', nombre: 'Comentario de texto', ayuda: 'Un fragmento y preguntas sobre él', abierta: true },
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
  opciones?: string[]; // test y respuesta múltiple; banco: palabras de más (distractores)
  correcta?: number | boolean; // test: índice desde 0; vf: verdadero o falso
  correctas?: number[]; // respuesta múltiple: índices de las correctas
  respuestas?: string[]; // corta y huecos: respuestas aceptadas; error: la versión corregida; ejercicio: resultado; banco y tabla: lo de cada hueco, en orden
  pares?: [string, string][]; // emparejar
  elementos?: string[]; // ordenar: en el orden correcto (se muestran desordenados)
  categorias?: { nombre: string; elementos: string[] }[]; // clasificar
  material?: string; // comentario y datos: el texto, la tabla o los datos que acompañan al enunciado; tabla: la tabla con casillas ___
  valor?: number; // numérica: el resultado
  tolerancia?: number; // numérica: margen admitido (±)
  unidades?: string; // numérica
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

export const LETRAS = 'abcdefghijklmnopqrstuvwxyz';

/** Hash de 32 bits bien mezclado (FNV-1a con un paso final): cadenas parecidas dan valores muy distintos. */
function mezcla(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Orden estable (el mismo en cada exportación) para lo que se desordena: «relacionar», «ordenar», modelo B… */
export function barajar<T>(lista: T[], semilla: string): T[] {
  return lista
    .map((x, i) => ({ x, k: mezcla(`${semilla}-${i}`) }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.x);
}

export const esAbierta = (t: TipoActividad) => !!TIPOS_ACTIVIDAD.find((x) => x.id === t)?.abierta;

/** Preguntas que se corrigen por partes (las demás tienen una sola respuesta, o una breve). */
const AGRUPADAS: TipoActividad[] = ['emparejar', 'ordenar', 'clasificar', 'banco', 'tabla'];
const LARGAS: TipoActividad[] = ['abierta', 'desarrollo', 'ejercicio', 'esquema', 'redaccion', 'caso', 'datos', 'comentario'];

/** Máximo de preguntas de un tipo en un bloque de actividades. */
export const maximoTipo = (t: TipoActividad) => (AGRUPADAS.includes(t) ? 5 : LARGAS.includes(t) ? 10 : 25);

/** Cantidad de cada tipo pedida para un bloque (también para los antiguos, de un solo tipo). */
export function tiposDe(op: OpcionesActividad): [TipoActividad, number][] {
  const tipos = op.tipos && Object.keys(op.tipos).length ? op.tipos : op.tipo ? { [op.tipo]: op.cantidad ?? 0 } : {};
  return TIPOS_ACTIVIDAD.map((t) => [t.id, Math.max(0, Math.round(Number(tipos[t.id]) || 0))] as [TipoActividad, number]).filter(([, n]) => n > 0);
}

/** ¿Tiene la pregunta los campos que pide su tipo? (lo que escribe la IA se comprueba antes de guardarlo) */
export function preguntaValida(p: PreguntaActividad): boolean {
  const tipo = p.tipo;
  if (!tipo || !TIPOS_ACTIVIDAD.some((t) => t.id === tipo)) return false;
  if (!p.enunciado && tipo !== 'emparejar' && tipo !== 'ordenar' && tipo !== 'clasificar' && tipo !== 'tabla') return false;
  const opciones = p.opciones?.length ?? 0;
  switch (tipo) {
    case 'test':
      return opciones >= 2 && typeof p.correcta === 'number' && p.correcta >= 0 && p.correcta < opciones;
    case 'multiple':
      return opciones >= 3 && !!p.correctas?.length && p.correctas.every((c) => Number.isInteger(c) && c >= 0 && c < opciones) && new Set(p.correctas).size === p.correctas.length;
    case 'vf':
    case 'vfjustificada':
      return typeof p.correcta === 'boolean';
    case 'corta':
    case 'error':
      return (p.respuestas?.length ?? 0) > 0;
    case 'huecos':
      return (p.respuestas?.length ?? 0) > 0 && /_{3,}/.test(p.enunciado);
    case 'emparejar':
      return (p.pares?.length ?? 0) >= 2 && p.pares!.every((x) => Array.isArray(x) && x.length === 2);
    case 'ordenar':
      return (p.elementos?.length ?? 0) >= 3;
    case 'clasificar':
      return (p.categorias?.length ?? 0) >= 2 && p.categorias!.every((c) => c?.nombre && c.elementos?.length);
    case 'datos':
    case 'comentario':
      return !!p.material?.trim();
    case 'numerica':
      return typeof p.valor === 'number' && Number.isFinite(p.valor);
    case 'banco':
      return (p.respuestas?.length ?? 0) >= 2 && cuantosHuecos(p.enunciado) === p.respuestas!.length;
    case 'tabla':
      return !!p.material && (p.respuestas?.length ?? 0) >= 1 && cuantosHuecos(p.material) === p.respuestas!.length;
    default:
      return true;
  }
}

const cuantosHuecos = (s: string) => (s.match(/_{3,}/g) ?? []).length;

/** Tipo de una pregunta (en los bloques antiguos, el del bloque). */
export const tipoDe = (p: PreguntaActividad, b: BloqueActividad): TipoActividad => p.tipo ?? b.opciones.tipo ?? 'test';

/** «5 tipo test · 3 verdadero o falso». */
export function resumenTipos(op: OpcionesActividad): string {
  return tiposDe(op)
    .map(([t, n]) => `${n} ${TIPOS_ACTIVIDAD.find((x) => x.id === t)!.nombre.toLowerCase()}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Texto de las preguntas (actividades y exámenes)

const huecos = (s: string) => s.replace(/_{3,}/g, '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_');
/** Raya para escribir una respuesta corta en la misma línea. */
const HUECO_LARGO = '\\_'.repeat(36);
/** Huecos numerados: (1) ____, (2) ____… */
const numerarHuecos = (s: string) => {
  let k = 0;
  return s.replace(/_{3,}/g, () => `**(${++k})** ${'\\_'.repeat(10)}`);
};
/** 2.5 → «2,5». */
const numero = (n: number) => String(n).replace('.', ',');
const celda = (s: string) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
/** Apartados a), b)… escritos seguidos: cada uno en su párrafo. */
const apartados = (s: string) => s.replace(/[ \t]+(?=[a-h]\)\s)/g, '\n\n');

/** Elementos de «clasificar», todos juntos y en un orden estable. */
const elementosClasificar = (p: PreguntaActividad, semilla: string) =>
  barajar(
    (p.categorias ?? []).flatMap((c) => c.elementos),
    semilla,
  );

/**
 * Enunciado de una pregunta para el alumnado: la línea que va tras el número y lo que va debajo
 * (opciones, tablas, el texto que comentar…). `semilla` fija el orden de lo que se desordena.
 */
export function partesPregunta(p: PreguntaActividad, tipo: TipoActividad, semilla: string): { enunciado: string; resto: string[] } {
  switch (tipo) {
    case 'test':
      return { enunciado: p.enunciado, resto: (p.opciones ?? []).map((o, k) => `- **${LETRAS[k]})** ${o}`) };
    case 'multiple':
      // (salvo que el enunciado ya lo diga)
      return { enunciado: /varias|todas las/i.test(p.enunciado) ? p.enunciado : `${p.enunciado} *(puede haber varias correctas)*`, resto: (p.opciones ?? []).map((o, k) => `- **${LETRAS[k]})** ${o}`) };
    case 'vf':
      return { enunciado: `${p.enunciado} **(V / F)**`, resto: [] };
    case 'vfjustificada':
      return { enunciado: `${p.enunciado} **(V / F)**${/justific/i.test(p.enunciado) ? '' : ' Justifica tu respuesta.'}`, resto: [] };
    case 'huecos':
      return { enunciado: huecos(p.enunciado), resto: [] };
    case 'numerica':
      return { enunciado: p.enunciado, resto: [`**Resultado:** ${'\\_'.repeat(16)}${p.unidades ? ` ${p.unidades}` : ''}`] };
    case 'banco':
      return {
        enunciado: p.opciones?.length ? 'Completa el texto con estas palabras (sobran algunas):' : 'Completa el texto con estas palabras:',
        resto: [`**Palabras:** ${barajar([...(p.respuestas ?? []), ...(p.opciones ?? [])], semilla).join(' · ')}`, '', ...numerarHuecos(p.enunciado).split('\n').map((l) => (l.trim() ? `> ${l}` : '>'))],
      };
    case 'tabla':
      return { enunciado: p.enunciado || 'Completa la tabla.', resto: [numerarHuecos(p.material ?? '')] };
    case 'emparejar': {
      const pares = p.pares ?? [];
      const derecha = barajar(pares.map((x) => x[1]), semilla);
      return {
        enunciado: p.enunciado || 'Relaciona cada elemento de la columna A con su pareja de la columna B.',
        resto: ['| | Columna A | | Columna B |', '|---|---|---|---|', ...pares.map((par, k) => `| ${k + 1} | ${celda(par[0])} | ${LETRAS[k]} | ${celda(derecha[k])} |`)],
      };
    }
    case 'ordenar':
      return {
        enunciado: p.enunciado || 'Ordena estos elementos.',
        resto: [...barajar(p.elementos ?? [], semilla).map((x, k) => `- **${LETRAS[k]})** ${x}`), '', `**Orden:** ${HUECO_LARGO}`],
      };
    case 'clasificar':
      return {
        enunciado: p.enunciado || 'Clasifica estos elementos.',
        resto: [...elementosClasificar(p, semilla).map((x, k) => `- **${k + 1}.** ${x}`), '', ...(p.categorias ?? []).flatMap((c) => [`**${c.nombre}:** ${HUECO_LARGO}`, ''])],
      };
    case 'comentario':
      return {
        enunciado: 'Lee el texto y responde:',
        resto: [...(p.material ?? '').trim().split('\n').map((l) => (l.trim() ? `> ${l}` : '>')), '', apartados(p.enunciado)],
      };
    case 'datos':
      return { enunciado: 'Analiza los datos y responde:', resto: [(p.material ?? '').trim(), '', apartados(p.enunciado)] };
    case 'caso':
      return { enunciado: apartados(p.enunciado), resto: [] };
    default:
      return { enunciado: p.enunciado, resto: [] };
  }
}

/** Respuesta en una línea (para la clave de corrección y las soluciones); vacía en las abiertas sin resultado. */
export function respuestaPregunta(p: PreguntaActividad, tipo: TipoActividad, semilla: string): string {
  switch (tipo) {
    case 'test': {
      const c = typeof p.correcta === 'number' ? p.correcta : 0;
      return `${LETRAS[c]}) ${p.opciones?.[c] ?? ''}`;
    }
    case 'multiple':
      return [...(p.correctas ?? [])]
        .sort((a, b) => a - b)
        .map((c) => `${LETRAS[c]}) ${p.opciones?.[c] ?? ''}`)
        .join('; ');
    case 'vf':
    case 'vfjustificada':
      return p.correcta === false ? 'Falso' : 'Verdadero';
    case 'numerica':
      return typeof p.valor === 'number' ? `${numero(p.valor)}${p.unidades ? ` ${p.unidades}` : ''}${p.tolerancia ? ` (± ${numero(p.tolerancia)})` : ''}` : '';
    case 'banco':
    case 'tabla':
      return (p.respuestas ?? []).map((r, k) => `(${k + 1}) ${r}`).join('; ');
    case 'emparejar': {
      const pares = p.pares ?? [];
      const derecha = barajar(pares.map((x) => x[1]), semilla);
      return pares.map((par, k) => `${k + 1}-${LETRAS[derecha.indexOf(par[1])]}`).join(', ');
    }
    case 'ordenar': {
      const mostrados = barajar(p.elementos ?? [], semilla);
      return (p.elementos ?? []).map((x) => LETRAS[mostrados.indexOf(x)]).join(' → ');
    }
    case 'clasificar': {
      const mostrados = elementosClasificar(p, semilla);
      return (p.categorias ?? []).map((c) => `${c.nombre}: ${c.elementos.map((x) => mostrados.indexOf(x) + 1).sort((a, b) => a - b).join(', ')}`).join(' · ');
    }
    default:
      return p.respuestas?.length ? p.respuestas.join(' / ') : '';
  }
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
    const semilla = b.id + i;
    const { enunciado, resto } = partesPregunta(p, t, semilla);
    // Lo que va debajo, sangrado para que siga dentro del elemento de la lista numerada
    const sangrado = resto.flatMap((l) => l.split('\n')).map((l) => (l ? `    ${l}` : ''));
    partes.push(`${n}. ${enunciado}`, ...(sangrado.length ? ['', ...sangrado] : []));
    const resp = respuestaPregunta(p, t, semilla);
    const explicacion = p.explicacion ?? '';
    const punto = resp && explicacion ? (/[.!?]$/.test(resp) ? ' ' : '. ') : '';
    if (resp || explicacion) soluciones.push(`${n}. ${resp ? `**${resp}**` : ''}${punto}${explicacion}`);
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
