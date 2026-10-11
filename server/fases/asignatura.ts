// Tareas de la asignatura: buscador de fuentes, currículo oficial y glosario.
import type { ResultadoBusqueda, TipoBusqueda } from '../../shared/tipos';
import { ErrorUsuario } from '../store';
import { DESCRIPCION_TIPO, descargarFuente, guardarResultados, leerResultados } from '../buscador';
import { FlujoImportacion } from './importacion';

export class FlujoAsignatura extends FlujoImportacion {

  // ---------------------------------------------------------------------------
  // Buscador de fuentes (para la asignatura o para un documento)

  protected dirBusqueda(asig: string, doc?: string) {
    return doc ? this.almacen.dirDocumento(asig, doc) : this.almacen.dirAsignatura(asig);
  }

  async buscarFuentes(asig: string, doc: string | undefined, consulta: string, tipo: TipoBusqueda = 'cualquiera') {
    if (!consulta.trim()) throw new ErrorUsuario('Escribe qué fuentes buscas');
    if (this.ocupado('fuentes', asig, doc)) throw new ErrorUsuario('Ya hay una búsqueda en curso');
    const salida = this.salida('fuentes');
    const ya = (await leerResultados(this.dirBusqueda(asig, doc))).map((r) => r.url);
    return this.lanzar({
      agente: 'investigador',
      asignatura: asig,
      documento: doc,
      titulo: `Buscar fuentes: ${consulta.trim().slice(0, 80)}`,
      paso: 'fuentes',
      esfuerzo: 'low', // basta con buscar y elegir; la app comprueba los enlaces
      tarea: `Busca en la web fuentes para elaborar los apuntes${doc ? ' de este documento' : ' de esta asignatura'} sobre: «${consulta.trim()}».
Tipo de fuentes: ${DESCRIPCION_TIPO[tipo] ?? DESCRIPCION_TIPO.cualquiera}.

- Entre 5 y 10 resultados, los mejores, adecuados al nivel y a los destinatarios.
- Solo fuentes fiables y verificables (instituciones, universidades, editoriales, revistas, organismos oficiales, divulgadores reconocidos). Nada de webs de trabajos copiados ni contenido generado sin autoría.
- Usa la búsqueda web y elige a partir de los resultados. NO abras las páginas para comprobarlas: la aplicación verifica después cada enlace. Ábrelas solo si necesitas averiguar la URL directa de un PDF.
- Copia las URL tal cual aparecen en los resultados. Prefiere contenidos de acceso libre.
${ya.length ? `- No repitas estas URL, ya propuestas antes:\n${ya.slice(0, 40).map((u) => `  - ${u}`).join('\n')}\n` : ''}
No descargues nada ni modifiques otros archivos. Escribe los resultados en \`${salida}\` con este JSON exacto:

{
  "resultados": [
    {
      "titulo": "Título del recurso",
      "url": "https://…",
      "autor": "autor u organización",
      "tipo": "pdf | web | video | articulo | libro",
      "descripcion": "qué contiene y para qué sirve en estos apuntes (1-2 frases)",
      "fiabilidad": "por qué es fiable (breve)",
      "idioma": "es, en…",
      "licencia": "si se conoce (CC BY, dominio público…), si no, cadena vacía"
    }
  ]
}`,
      post: { tipo: 'busqueda', datos: { salida, consulta: consulta.trim() } },
    });
  }

  async resultadosBusqueda(asig: string, doc?: string) {
    return leerResultados(this.dirBusqueda(asig, doc));
  }

  protected async cambiarResultado(asig: string, doc: string | undefined, id: string, cambios: Partial<ResultadoBusqueda>) {
    const dir = this.dirBusqueda(asig, doc);
    return this.conCandado(`${dir}/busqueda`, async () => {
      const lista = await leerResultados(dir);
      const r = lista.find((x) => x.id === id);
      if (!r) throw new ErrorUsuario('Resultado no encontrado', 404);
      Object.assign(r, cambios);
      await guardarResultados(dir, lista);
      return r;
    });
  }

  async anadirFuente(asig: string, doc: string | undefined, id: string) {
    const r = (await leerResultados(this.dirBusqueda(asig, doc))).find((x) => x.id === id);
    if (!r) throw new ErrorUsuario('Resultado no encontrado', 404);
    try {
      const archivo = await descargarFuente(r, this.almacen.dirFuentes(asig, doc), this.dep.dirBin ?? '');
      await this.prepararFuentes(asig, doc);
      return this.cambiarResultado(asig, doc, id, { estado: 'anadida', archivo, error: undefined });
    } catch (e) {
      await this.cambiarResultado(asig, doc, id, { error: (e as Error).message });
      throw e;
    }
  }

  async descartarResultado(asig: string, doc: string | undefined, id: string) {
    return this.cambiarResultado(asig, doc, id, { estado: 'descartada' });
  }

  async limpiarBusqueda(asig: string, doc?: string) {
    const dir = this.dirBusqueda(asig, doc);
    return this.conCandado(`${dir}/busqueda`, async () => {
      await guardarResultados(dir, (await leerResultados(dir)).filter((r) => r.estado === 'anadida'));
    });
  }

  // ---------------------------------------------------------------------------
  // Glosario de la asignatura

  /** Busca el currículo oficial de la asignatura y lo transcribe en curriculo.md. */
  async buscarCurriculo(asig: string, indicaciones?: string) {
    if (this.ocupado('curriculo', asig, undefined)) throw new ErrorUsuario('Ya se está buscando el currículo');
    const a = await this.almacen.obtenerAsignatura(asig);
    const fp = a.etapa?.startsWith('fp-');
    return this.lanzar({
      agente: 'curriculo',
      asignatura: asig,
      titulo: 'Buscar el currículo oficial',
      paso: 'curriculo',
      web: true,
      indicaciones,
      tarea: `Busca el currículo oficial de esta asignatura y transcríbelo en \`curriculo.md\`.
${
  fp
    ? `Es un módulo de Formación Profesional: localiza el real decreto del título${a.titulo ? ` «${a.titulo}»` : ''} en el BOE y, dentro de él, el módulo «${a.nombre}». Transcribe sus **resultados de aprendizaje** con sus **criterios de evaluación** (RA1 con a), b), c)…) y, si el decreto los incluye, los contenidos básicos y la duración.`
    : `Es una materia de ${a.nivel || 'la enseñanza indicada'}: localiza el real decreto de enseñanzas mínimas (LOMLOE) que corresponda y transcribe, para ESTE curso, las **competencias específicas**, los **criterios de evaluación** (con su numeración, p. ej. 1.1, 1.2) y los **saberes básicos**.`
}
${
  a.comunidad
    ? `La comunidad autónoma es ${a.comunidad}: busca también su decreto u orden propios y, si concretan o amplían el currículo estatal, usa su versión e indícalo.`
    : 'Si no se indica la comunidad autónoma, usa la norma estatal.'
}
Formato de \`curriculo.md\`:
- \`# Currículo oficial: <asignatura>\`
- Una línea \`Fuente:\` con la norma (nombre, fecha) y su enlace al BOE o al boletín autonómico.
- Los apartados del currículo con su numeración original, transcritos literalmente (sin resumir).
Usa solo fuentes oficiales (boe.es, boletines autonómicos, webs de las consejerías o del ministerio). Si no encuentras la norma con seguridad, escríbelo en el archivo en lugar de inventar. No toques otros archivos.`,
      post: { tipo: 'curriculo', datos: {} },
    });
  }

  async glosario(asig: string, indicaciones?: string) {
    if (this.ocupado('glosario', asig, undefined)) throw new ErrorUsuario('Ya se está actualizando el glosario');
    return this.lanzar({
      agente: 'glosario',
      asignatura: asig,
      titulo: 'Actualizar el glosario',
      paso: 'glosario',
      indicaciones,
      tarea: `Actualiza el glosario de la asignatura en \`glosario.md\` a partir de todos los documentos (\`documentos/*/secciones/*.md\`) y de su contexto.
- Formato: \`# Glosario\` y, en orden alfabético, una entrada por término: \`**Término**: definición breve y precisa.\` Añade al final \`## Notación y abreviaturas\` si procede.
- Conserva las entradas existentes (mejóralas si hace falta) y añade las nuevas.
- Si detectas el mismo concepto con nombres o notaciones distintas entre documentos, indícalo al final en \`## Incoherencias detectadas\` señalando dónde aparece cada variante.
Solo escribe en \`glosario.md\`; no modifiques los documentos.`,
    });
  }
}
