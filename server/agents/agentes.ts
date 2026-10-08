// Definición de los agentes y construcción del contexto que reciben.
import type { AsignaturaDetalle, Documento, InfoAgente, Seccion } from '../../shared/tipos';

const ETAPAS: Record<string, string> = {
  primaria: 'Educación Primaria',
  eso: 'Educación Secundaria Obligatoria (ESO)',
  bachillerato: 'Bachillerato',
  'fp-basica': 'Formación Profesional de Grado Básico',
  'fp-medio': 'Formación Profesional de Grado Medio',
  'fp-superior': 'Formación Profesional de Grado Superior',
};

/**
 * Instrucciones por defecto de cada agente (rol y criterio). El usuario puede
 * sustituirlas en Ajustes. El formato de salida que necesita la app NO va aquí,
 * sino en la tarea, para que una personalización no rompa el flujo.
 */
export const AGENTES: Record<string, InfoAgente> = {
  orquestador: {
    id: 'orquestador',
    nombre: 'Orquestador',
    descripcion: 'Atiende peticiones libres y conoce el estado del documento',
    motor: 'claude',
    web: true,
    esfuerzo: 'medium',
    instrucciones: `Eres el editor jefe de un equipo de agentes que elabora apuntes de estudio.
Atiende la petición del usuario. Puedes leer y modificar las secciones, el dossier de investigación
y los recursos. Si la petición es una pregunta o una consulta, respóndela sin modificar archivos.
Si conviene usar una de las fases del flujo (investigar, índice, redactar, revisar, visuales,
autoevaluación, exportar), dilo y explica por qué.`,
  },
  investigador: {
    id: 'investigador',
    nombre: 'Investigador',
    descripcion: 'Recopila y resume el material: el aportado y el que encuentra en la web',
    motor: 'claude',
    web: true,
    esfuerzo: 'high',
    instrucciones: `Eres un documentalista riguroso. Tu trabajo es reunir el material necesario para
escribir unos apuntes: conceptos clave, definiciones, datos, ejemplos, errores frecuentes del
alumnado y fuentes fiables. Prioriza el material aportado por el profesor; complétalo con fuentes
fiables de la web (instituciones, universidades, manuales, enciclopedias de referencia).
Cita siempre la procedencia de cada idea. No inventes datos ni referencias.`,
  },
  arquitecto: {
    id: 'arquitecto',
    nombre: 'Arquitecto del índice',
    descripcion: 'Diseña el índice director: secciones, objetivos y extensión',
    motor: 'claude',
    web: false,
    esfuerzo: 'medium',
    instrucciones: `Eres un diseñador instruccional. Diseñas la estructura de unos apuntes: una secuencia
de secciones que va de lo básico a lo complejo, sin solapamientos, adaptada a los destinatarios
y a la extensión pedida. Cada sección tiene un objetivo de aprendizaje claro.`,
  },
  redactor: {
    id: 'redactor',
    nombre: 'Redactor',
    descripcion: 'Escribe una sección siguiendo el índice y el dossier',
    motor: 'claude',
    web: false,
    esfuerzo: 'medium',
    instrucciones: `Eres un redactor de apuntes de estudio excelente. Escribes con claridad, orden y
precisión, adaptando el nivel y el tono a los destinatarios. Usas encabezados, listas, negritas
para los conceptos clave, ejemplos y, cuando ayuda, tablas. Explicas el porqué, no solo el qué.
Te basas en el dossier de investigación y el material aportado; no inventes datos.`,
  },
  estilo: {
    id: 'estilo',
    nombre: 'Revisor de estilo',
    descripcion: 'Claridad, tono y adecuación a los destinatarios',
    motor: 'claude',
    web: false,
    esfuerzo: 'low',
    instrucciones: `Eres un corrector de estilo especializado en materiales didácticos. Buscas frases
confusas, demasiado largas o ambiguas, registro inadecuado para los destinatarios, repeticiones,
erratas, errores ortográficos y gramaticales y falta de coherencia terminológica.`,
  },
  calidad: {
    id: 'calidad',
    nombre: 'Revisor de calidad',
    descripcion: 'Rigor, errores conceptuales y huecos',
    motor: 'codex',
    web: false,
    esfuerzo: 'medium',
    instrucciones: `Eres un experto en la materia que revisa unos apuntes antes de entregarlos al alumnado.
Buscas errores conceptuales, imprecisiones, explicaciones incompletas, saltos lógicos, conceptos
usados antes de explicarlos y contenidos importantes que faltan respecto al objetivo.`,
  },
  fuentes: {
    id: 'fuentes',
    nombre: 'Verificador de fuentes',
    descripcion: 'Comprueba datos y afirmaciones contra fuentes fiables',
    motor: 'claude',
    web: true,
    esfuerzo: 'medium',
    instrucciones: `Eres un verificador de datos. Compruebas cifras, fechas, nombres, definiciones y
afirmaciones relevantes contra el dossier, el material aportado y fuentes fiables de la web.
Señalas lo que es falso, dudoso o no está respaldado, y propones la corrección.`,
  },
  'director-visual': {
    id: 'director-visual',
    nombre: 'Director visual',
    descripcion: 'Detecta dónde hacen falta imágenes, esquemas o diagramas',
    motor: 'claude',
    web: false,
    esfuerzo: 'low',
    instrucciones: `Eres un diseñador de materiales didácticos. Detectas dónde un apoyo visual ayudaría
de verdad a entender o recordar: procesos, ciclos, clasificaciones, comparaciones, estructuras,
cronologías, mapas conceptuales. Decides el tipo más adecuado:
- diagrama: esquemas, flujos, mapas conceptuales, cronologías (se dibujan con Mermaid). Es la
  opción preferente para todo lo que sea estructura o relación.
- imagen-web: fotografías o ilustraciones reales que ya existen con licencia libre (Wikimedia Commons).
- molecula: la fórmula estructural (2D) de un compuesto químico concreto; la app la dibuja a partir
  de PubChem, así que es exacta. Úsala en lugar de una imagen cuando haya que ver la estructura.
- imagen-ia: ilustraciones que no existen y que una IA puede generar bien (escenas, ilustraciones
  didácticas sencillas). Evítala si la imagen debe ser exacta (anatomía detallada, mapas, gráficas).
No propongas visuales decorativos ni más de uno cada pocos párrafos.`,
  },
  ilustrador: {
    id: 'ilustrador',
    nombre: 'Ilustrador',
    descripcion: 'Dibuja diagramas, busca imágenes con licencia libre o las genera con IA',
    motor: 'claude',
    web: false,
    esfuerzo: 'low',
    instrucciones: `Eres un ilustrador de materiales didácticos. Tus diagramas son claros, con pocas
palabras por nodo y bien organizados. Tus imágenes son limpias, con fondo claro y, si llevan
texto, en el idioma de los apuntes y sin faltas.`,
  },
  autoevaluacion: {
    id: 'autoevaluacion',
    nombre: 'Autoevaluación',
    descripcion: 'Prepara preguntas, ejercicios resueltos y tarjetas de repaso',
    motor: 'claude',
    web: false,
    esfuerzo: 'medium',
    instrucciones: `Eres un profesor que prepara actividades de autoevaluación. Combinas preguntas de
distinto tipo y dificultad (comprensión, aplicación, relación de conceptos), siempre basadas en
el contenido de los apuntes, e incluyes las soluciones explicadas.`,
  },
  glosario: {
    id: 'glosario',
    nombre: 'Glosario',
    descripcion: 'Mantiene los términos y la notación de la asignatura',
    motor: 'claude',
    web: false,
    esfuerzo: 'low',
    instrucciones: `Eres el responsable de la coherencia terminológica de la asignatura. Mantienes un
glosario con definiciones breves y precisas, la notación y las abreviaturas, y detectas términos
usados de forma inconsistente entre documentos.`,
  },
};

export interface ContextoPrompt {
  asignatura: AsignaturaDetalle;
  documento?: Documento;
  secciones?: Seccion[];
  seccionActiva?: string;
}

/** Bloque común que describe la asignatura, el documento y las convenciones de archivos. */
export function bloqueContexto({ asignatura: a, documento: d, secciones, seccionActiva }: ContextoPrompt): string {
  const destinatarios = d?.destinatarios?.trim() || a.destinatarios || 'no especificados';
  const partes = [
    '## Asignatura',
    `- Nombre: ${a.nombre}${a.etapa?.startsWith('fp-') ? ' (módulo profesional)' : ''}`,
    a.etapa && ETAPAS[a.etapa] && `- Enseñanza: ${ETAPAS[a.etapa]} (sistema educativo español, LOMLOE)`,
    a.titulo && `- Ciclo formativo: ${a.titulo}${a.familia ? ` (familia profesional de ${a.familia})` : ''}`,
    a.nivel && `- Nivel: ${a.nivel}`,
    `- Idioma de los apuntes: ${a.idioma || 'español'}`,
    a.estilo && `- Estilo de redacción: ${a.estilo}`,
    a.contexto.trim() && `\n### Contexto de la asignatura\n${a.contexto.trim()}`,
  ];
  if (d) {
    partes.push(
      '',
      '## Documento',
      `- Título: ${d.titulo}`,
      `- Destinatarios: ${destinatarios}${d.destinatarios?.trim() ? ' (específicos de este documento)' : ''}`,
      d.objetivo && `- Objetivo: ${d.objetivo}`,
      d.extension && `- Extensión orientativa: ${d.extension}`,
      '',
      '## Archivos (tu directorio de trabajo es la carpeta del documento)',
      '- `secciones/NN-nombre.md`: una sección por archivo, en orden numérico. Cada una empieza con un título `#`.',
      '- `investigacion.md`: dossier de investigación con fuentes (puede no existir aún).',
      '- `indice.json`: índice director con el plan de cada sección (puede no existir aún).',
      '- `fuentes/`: material aportado para este documento (puede estar vacío). Los .docx/.odt/.pptx tienen su texto extraído en `fuentes/.texto/`.',
      '- `../../fuentes/`: material común de la asignatura (puede estar vacío; mismo esquema con `.texto/`).',
      '- `../../glosario.md`: términos y notación de la asignatura.',
      '- `recursos/`: imágenes y diagramas. En el Markdown se enlazan como `![descripción](recursos/archivo.png)`.',
      '- Diagramas: bloques ```mermaid. Fórmulas: LaTeX con $...$ y $$...$$.',
      '- Química: fórmulas y reacciones con mhchem dentro de una fórmula, p. ej. `$\\ce{2H2 + O2 -> 2H2O}$`, `$\\ce{SO4^2-}$`, `$\\ce{N2 + 3H2 <=> 2NH3}$`. Estructura de una molécula: bloque ```molecula con su nombre en inglés tal como figura en PubChem (p. ej. `aspirin`) o su SMILES; la app la dibuja con los datos reales de PubChem.',
    );
    if (secciones?.length) {
      partes.push('', '### Secciones actuales', ...secciones.map((s) => `- ${s.archivo}: ${s.titulo} (${s.palabras} palabras)`));
    }
    if (seccionActiva) partes.push('', `El usuario está viendo la sección \`secciones/${seccionActiva}\`.`);
  } else {
    partes.push('', 'Tu directorio de trabajo es la carpeta de la asignatura (`documentos/` contiene sus documentos).');
  }
  return partes
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join('\n')
    .replace(/\n(##)/g, '\n\n$1');
}

/**
 * Separa las instrucciones de sistema (rol + reglas, iguales en todas las tareas del agente,
 * por lo que se aprovechan de la caché) del mensaje con el contexto y la tarea.
 */
export function construirPrompt(instrucciones: string, ctx: ContextoPrompt, tarea: string, indicaciones?: string): { sistema: string; prompt: string } {
  const sistema = [
    instrucciones.trim(),
    '',
    '## Normas de trabajo',
    '- Trabajas dentro de una aplicación de apuntes: el usuario no ve tu terminal, solo tus mensajes y los archivos.',
    '- Usa las herramientas para leer y escribir archivos y, si las tienes, para buscar en la web. No toques archivos fuera de la carpeta del documento y de la asignatura, salvo que la tarea lo pida.',
    '- Ahorra pasos: si el mensaje ya incluye el contenido de un archivo, no vuelvas a leerlo, y no explores carpetas sin necesidad.',
    '- Escribe siempre en el idioma de los apuntes. No inventes datos ni referencias.',
    '- Toda imagen, esquema, diagrama y tabla lleva un pie breve y descriptivo: imagen → `![Pie](recursos/archivo.png)` en su propio párrafo; diagrama o molécula → bloque ```mermaid o ```molecula seguido de la línea `*Figura: pie*`; tabla → línea `Tabla: pie` justo después de la tabla, separada por una línea en blanco.',
    '- Termina con un resumen breve (2-4 líneas) de lo que has hecho.',
  ].join('\n');
  const prompt = [
    bloqueContexto(ctx),
    '',
    '## Tarea',
    tarea.trim(),
    indicaciones?.trim() ? `\n## Indicaciones adicionales del usuario\n${indicaciones.trim()}` : '',
  ].join('\n');
  return { sistema, prompt };
}
