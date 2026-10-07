// Definición de los agentes y construcción del contexto que reciben.
import type { AsignaturaDetalle, Documento, Motor, Seccion } from '../../shared/tipos';

export interface DefinicionAgente {
  id: string;
  nombre: string;
  descripcion: string;
  motor: Motor;
  instrucciones: string;
}

export const AGENTES: Record<string, DefinicionAgente> = {
  asistente: {
    id: 'asistente',
    nombre: 'Asistente',
    descripcion: 'Atiende peticiones libres sobre el documento',
    motor: 'claude',
    instrucciones: `Eres el asistente de redacción de apuntes. Atiende la petición del usuario
sobre este documento. Puedes leer, crear y modificar las secciones y recursos del documento.
Si la petición es una pregunta, respóndela sin modificar archivos.`,
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
    `- Nombre: ${a.nombre}`,
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
      `- Destinatarios: ${destinatarios}${d.destinatarios?.trim() ? ' (específico de este documento)' : ''}`,
      d.objetivo && `- Objetivo: ${d.objetivo}`,
      d.extension && `- Extensión orientativa: ${d.extension}`,
      '',
      '## Archivos (tu directorio de trabajo es la carpeta del documento)',
      '- `secciones/NN-nombre.md`: una sección por archivo, en orden numérico. Cada una empieza con un título `#`.',
      '- `fuentes/`: material aportado para este documento (puede estar vacío).',
      '- `../../fuentes/`: material común de la asignatura (puede estar vacío).',
      '- `../../glosario.md`: términos y notación de la asignatura.',
      '- `recursos/`: imágenes y diagramas. En el Markdown se enlazan como `![descripción](recursos/archivo.png)`.',
      '- Diagramas: preferiblemente bloques ```mermaid. Fórmulas: LaTeX con $...$ y $$...$$.',
    );
    if (secciones?.length) {
      partes.push('', '### Secciones actuales', ...secciones.map((s) => `- ${s.archivo}: ${s.titulo} (${s.palabras} palabras)`));
    }
    if (seccionActiva) partes.push('', `El usuario está viendo la sección \`secciones/${seccionActiva}\`.`);
  }
  return partes.filter((p): p is string => typeof p === 'string' && p !== '').join('\n').replace(/\n(##)/g, '\n\n$1');
}

export function construirPrompt(agente: DefinicionAgente, ctx: ContextoPrompt, tarea: string): string {
  return [
    agente.instrucciones.trim(),
    '',
    'Trabajas dentro de una aplicación de apuntes; el usuario no ve tu terminal, solo tus mensajes y los archivos.',
    'No ejecutes comandos ni toques archivos fuera de la carpeta del documento y de la asignatura.',
    'Termina con un resumen breve (2-4 líneas) de lo que has hecho.',
    '',
    bloqueContexto(ctx),
    '',
    '## Tarea',
    tarea.trim(),
  ].join('\n');
}
