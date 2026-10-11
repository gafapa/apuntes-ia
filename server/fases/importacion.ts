// Mejorar unos apuntes existentes: importarlos, transcribir un PDF y el diagnóstico.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EntradaIndice,
  Indice,
  Profundidad,
  Trabajo,
  AccionDiagnostico,
  AreaDiagnostico,
  Diagnostico,
  Importacion,
  ModoMejora,
  ProblemaDiagnostico,
} from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../shared/tipos';
import { ErrorUsuario, slug } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { contarPalabras } from '../texto';
import { aMarkdown, formatoDe, leerPdf, limpiar, partirEnSecciones, type SeccionImportada } from '../importar';
import { claveSeccion } from '../historial';
import { FlujoActividades } from './actividades';

export class FlujoImportacion extends FlujoActividades {

  // ---------------------------------------------------------------------------
  // Unos apuntes existentes: importarlos y diagnosticarlos

  /**
   * Crea un documento a partir de unos apuntes (Word, LibreOffice, Markdown o PDF). En modo
   * conservador se convierten en las secciones del documento (y su índice); en los otros, son la
   * fuente principal de un índice nuevo, que se pide enseguida al arquitecto.
   */
  async importar(
    asig: string,
    archivo: { ruta: string; nombre: string },
    op: { titulo?: string; objetivo?: string; destinatarios?: string; modo?: ModoMejora; estiloOriginal?: boolean; diagnosticar?: boolean },
  ) {
    const formato = formatoDe(archivo.nombre);
    if (!formato) throw new ErrorUsuario('Formato no admitido: usa Word (.docx), LibreOffice (.odt), Markdown (.md, o .zip con sus imágenes) o PDF');
    const modo: ModoMejora = op.modo === 'reestructurar' || op.modo === 'reescribir' ? op.modo : 'conservador';
    const nombre = archivo.nombre.replace(/[\\/:*?"<>|]/g, '_');
    const sinExtension = path.basename(nombre, path.extname(nombre)).replace(/[-_]+/g, ' ').trim();
    // Primero se lee y se convierte (en una carpeta temporal): si falla, no se crea el documento
    const tmpRecursos = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-recursos-'));
    try {
      const pdf = formato === 'pdf' ? await leerPdf(archivo.ruta) : undefined;
      const convertido = formato === 'pdf' ? undefined : await aMarkdown(archivo.ruta, nombre, this.dep.dirBin, tmpRecursos);
      if (convertido && contarPalabras(convertido.texto) < 30) throw new ErrorUsuario('El archivo apenas tiene texto: no hay apuntes que importar');
      const partido = convertido && modo === 'conservador' ? partirEnSecciones(convertido.texto, sinExtension || 'Apuntes') : undefined;
      const estiloOriginal = (formato === 'docx' || formato === 'odt') && !!op.estiloOriginal;
      const documento = await this.almacen.crearDocumento(asig, {
        titulo: op.titulo?.trim() || convertido?.titulo || partido?.titulo || sinExtension || 'Apuntes importados',
        objetivo: op.objetivo ?? '',
        destinatarios: op.destinatarios ?? '',
        importado: {
          archivo: nombre,
          formato,
          modo,
          fecha: new Date().toISOString(),
          ...(estiloOriginal ? { estiloOriginal, estiloCuerpo: convertido?.estiloCuerpo, estiloTabla: convertido?.estiloTabla } : {}),
        },
      });
      const doc = documento.id;
      try {
        const dir = this.almacen.dirDocumento(asig, doc);
        await fs.mkdir(path.join(dir, 'original'), { recursive: true });
        await fs.copyFile(archivo.ruta, path.join(dir, 'original', nombre));
        if (estiloOriginal) await fs.copyFile(archivo.ruta, path.join(dir, `plantilla.${formato}`));
        await fs.cp(tmpRecursos, path.join(dir, 'recursos'), { recursive: true, force: true });
        const avisos = [...(convertido?.avisos ?? [])];
        let secciones = 0;
        let trabajos = 0;
        if (pdf) {
          // El PDF va a las fuentes del documento: los agentes lo consultan y se indexa para buscar en él
          await fs.copyFile(archivo.ruta, path.join(this.almacen.dirFuentes(asig, doc), nombre));
          if (modo === 'conservador') {
            await this.transcribirPdf(asig, doc, nombre, pdf, !!op.diagnosticar);
            trabajos++;
            avisos.push('Las imágenes del PDF no se pueden extraer: el transcriptor deja una marca donde había cada una, para sustituirla en la fase de visuales.');
          }
        } else if (partido) {
          secciones = await this.crearSeccionesImportadas(asig, doc, partido.secciones, nombre);
        } else if (convertido) {
          await fs.writeFile(path.join(this.almacen.dirFuentes(asig, doc), 'apuntes-originales.md'), convertido.texto, 'utf8');
        }
        if (modo !== 'conservador') {
          await this.proponerIndice(asig, doc);
          trabajos++;
        } else if (op.diagnosticar && !pdf) {
          await this.diagnosticar(asig, doc);
          trabajos++;
        }
        return { documento, secciones, imagenes: convertido?.imagenes ?? 0, trabajos, avisos };
      } catch (e) {
        // Un documento a medio importar no sirve: se quita (a la papelera)
        await this.almacen.eliminarDocumento(asig, doc).catch(() => {});
        throw e;
      }
    } finally {
      await fs.rm(tmpRecursos, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Escribe las secciones importadas, su copia original (para comparar) y el índice ya aprobado. */
  protected async crearSeccionesImportadas(asig: string, doc: string, lista: SeccionImportada[], origen: string) {
    return this.conCandado(`${asig}/${doc}/secciones`, async () => {
      const dir = this.almacen.dirDocumento(asig, doc);
      const usados = new Set<string>();
      const entradas: EntradaIndice[] = [];
      let profundidad: Profundidad = 1;
      for (const [i, s] of lista.entries()) {
        let base = slug(s.titulo);
        for (let n = 2; usados.has(base); n++) base = `${slug(s.titulo)}-${n}`;
        usados.add(base);
        const archivo = `${String(i + 1).padStart(2, '0')}-${base}.md`;
        await this.almacen.guardarSeccion(asig, doc, archivo, s.texto);
        const original = path.join(dir, 'original', 'secciones', `${claveSeccion(archivo)}.md`);
        await fs.mkdir(path.dirname(original), { recursive: true });
        await fs.writeFile(original, s.texto, 'utf8');
        if (s.apartados.length) profundidad = Math.max(profundidad, s.apartados.some((a) => a.apartados.length) ? 3 : 2) as Profundidad;
        entradas.push({ id: randomUUID().slice(0, 8), titulo: s.titulo, objetivo: '', contenidos: [], apartados: s.apartados, extension: '', visuales: '', archivo });
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', {
        profundidad,
        entradas,
        notas: `Estructura de los apuntes importados de «${origen}».`,
        aprobado: true,
        actualizado: new Date().toISOString(),
      } satisfies Indice);
      return lista.length;
    });
  }

  /** Un agente transcribe el PDF a Markdown con su estructura; al terminar se reparte en secciones. */
  protected async transcribirPdf(asig: string, doc: string, nombre: string, pdf: { paginas: number; texto: string }, diagnosticar: boolean) {
    const salida = this.salida('transcripcion', 'md');
    const textoPlano = this.salida('pdf-texto', 'md');
    await fs.mkdir(path.join(this.almacen.dirDocumento(asig, doc), '.agentes'), { recursive: true });
    await fs.writeFile(path.join(this.almacen.dirDocumento(asig, doc), textoPlano), pdf.texto, 'utf8');
    return this.lanzar({
      agente: 'transcriptor',
      asignatura: asig,
      documento: doc,
      titulo: `Transcribir «${nombre}»`,
      paso: 'importacion',
      fuentes: false,
      tarea: `Transcribe a Markdown los apuntes del PDF \`fuentes/${nombre}\` (${pdf.paginas} páginas). Léelo con la herramienta de lectura de archivos; si no puedes leer PDF, usa \`${textoPlano}\`, que tiene el texto de cada página sin formato (y úsalo también para comprobar que no se te escapa nada).

Escribe el resultado COMPLETO en \`${salida}\`:
- Un encabezado \`#\` por cada tema o bloque principal, y \`##\` y \`###\` para los apartados, según la jerarquía del PDF. Sin numeración manual en los títulos.
- Listas, negritas y cursivas como en el original; tablas en Markdown con barras (\`| a | b |\`); fórmulas en LaTeX (\`$…$\` y \`$$…$$\`).
- Quita la portada, el índice o sumario, las cabeceras y pies de página, los números de página y los guiones de corte de palabra.
- Donde haya una imagen, figura o gráfico, escribe en su lugar una línea \`> [Figura: descripción breve de lo que muestra y su pie, si lo tiene]\`.
- No resumas, no corrijas, no reordenes ni añadas nada: es el texto del autor.
Transcribe el documento entero aunque sea largo (si hace falta, escribe el archivo por partes, añadiendo al final). No toques ningún otro archivo.`,
      post: { tipo: 'transcripcion', datos: { salida, nombre, diagnosticar } },
    });
  }

  protected async postTranscripcion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const rel = String(datos.salida);
    const texto = await fs.readFile(path.join(this.almacen.dirDocumento(asig, doc), rel), 'utf8').catch(() => '');
    if (contarPalabras(texto) < 30) throw new PedirAlAgente('La transcripción está vacía o no se ha escrito', `No has escrito la transcripción en \`${rel}\` (o está casi vacía). Escríbela completa en ese archivo.`);
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const partido = partirEnSecciones(limpiar(texto), documento.titulo);
    const n = await this.crearSeccionesImportadas(asig, doc, partido.secciones, String(datos.nombre));
    if (datos.diagnosticar) await this.diagnosticar(asig, doc).catch(() => {});
    return `PDF transcrito: ${n} ${n === 1 ? 'sección' : 'secciones'}${datos.diagnosticar ? '. Empieza el diagnóstico.' : ''}`;
  }

  /** El agente de diagnóstico lee todo el documento y escribe un informe (no toca el texto). */
  async diagnosticar(asig: string, doc: string, indicaciones?: string) {
    if (this.ocupado('diagnostico', asig, doc)) throw new ErrorUsuario('Ya se está haciendo un diagnóstico');
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo));
    if (!secciones.some((s) => s.palabras > 20)) throw new ErrorUsuario('El documento todavía no tiene texto que diagnosticar');
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const curriculo = await this.almacen.leerCurriculo(asig);
    const salida = this.salida('diagnostico');
    return this.lanzar({
      agente: 'diagnostico',
      asignatura: asig,
      documento: doc,
      titulo: 'Diagnóstico de los apuntes',
      paso: 'diagnostico',
      incluir: { secciones: secciones.map((s) => s.archivo) },
      indicaciones,
      tarea: `Haz un diagnóstico de estos apuntes${documento.importado ? ` (son unos apuntes existentes del profesor, importados de «${documento.importado.archivo}»)` : ''}. NO modifiques ningún archivo.
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo}, ${s.palabras} palabras)`).join('\n')}

Evalúa:
- contenido: errores, imprecisiones y lo que falta para el objetivo y los destinatarios;
- actualidad: datos, normativa o tecnologías desactualizados;
- estructura: secuencia, solapamientos, secciones demasiado largas o pobres;
- estilo: claridad, nivel y tono para los destinatarios;
${curriculo.trim() ? '- curriculo: criterios del currículo oficial (abajo) que corresponden a este tema y no se tratan;\n' : ''}- visuales: dónde ayudaría un esquema, una imagen, una tabla o una gráfica;
- actividades: si faltan ejercicios, ejemplos resueltos o autoevaluación;
- formato: tablas mal construidas, restos de la conversión, marcas de figuras sin imagen.

Escribe el resultado en \`${salida}\` con este JSON exacto:

{
  "resumen": "3-5 frases con la valoración general",
  "puntosFuertes": ["lo que hay que conservar", "..."],
  "problemas": [
    { "area": "contenido | actualidad | estructura | estilo | curriculo | visuales | actividades | formato", "seccion": "archivo de la sección, o cadena vacía si es general", "descripcion": "qué pasa y qué conviene hacer, concreto (cita el pasaje)", "gravedad": "baja | media | alta" }
  ],
  "recomendacion": "conservador | reestructurar | reescribir",
  "motivoRecomendacion": "por qué"
}

Recomendación: «conservador» si basta con corregir y completar sobre el texto actual; «reestructurar» si el contenido es bueno pero la organización no; «reescribir» si conviene rehacerlos usándolos como fuente. Entre 5 y 25 problemas, de más a menos importante.${
        curriculo.trim() ? `\n\n===== Currículo oficial de la asignatura (curriculo.md) =====\n${curriculo.slice(0, 30_000)}\n===== fin del currículo =====` : ''
      }`,
      post: { tipo: 'diagnostico', datos: { salida } },
    });
  }

  protected async postDiagnostico(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const r = await this.leerSalida<Partial<Diagnostico> & { problemas?: Partial<ProblemaDiagnostico>[] }>(asig, doc, String(datos.salida));
    if (!r.resumen || !Array.isArray(r.problemas)) throw new PedirAlAgente('El diagnóstico no tiene el formato pedido', `El archivo ${datos.salida} no tiene el formato pedido (faltan «resumen» o «problemas»). Escríbelo de nuevo.`);
    const archivos = new Set((await this.almacen.listarSecciones(asig, doc)).map((s) => s.archivo));
    const areas: AreaDiagnostico[] = ['contenido', 'actualidad', 'estructura', 'estilo', 'curriculo', 'visuales', 'actividades', 'formato'];
    const acciones: Partial<Record<AreaDiagnostico, AccionDiagnostico>> = {
      contenido: 'calidad',
      actualidad: 'fuentes',
      estructura: 'indice',
      estilo: 'estilo',
      curriculo: 'curriculo',
      visuales: 'visuales',
      actividades: 'actividades',
    };
    const problemas: ProblemaDiagnostico[] = r.problemas
      .filter((p) => p?.descripcion)
      .map((p) => {
        const area = areas.includes(p.area as AreaDiagnostico) ? (p.area as AreaDiagnostico) : 'contenido';
        const seccion = String(p.seccion ?? '').replace(/^secciones\//, '');
        return {
          id: randomUUID().slice(0, 8),
          area,
          ...(archivos.has(seccion) ? { seccion } : {}),
          descripcion: String(p.descripcion),
          gravedad: p.gravedad === 'alta' || p.gravedad === 'baja' ? p.gravedad : 'media',
          ...(acciones[area] ? { accion: acciones[area] } : {}),
        };
      });
    const modos: ModoMejora[] = ['conservador', 'reestructurar', 'reescribir'];
    const diagnostico: Diagnostico = {
      resumen: String(r.resumen),
      puntosFuertes: (r.puntosFuertes ?? []).map(String).filter(Boolean),
      problemas,
      recomendacion: modos.includes(r.recomendacion as ModoMejora) ? (r.recomendacion as ModoMejora) : 'conservador',
      motivoRecomendacion: String(r.motivoRecomendacion ?? ''),
      actualizado: new Date().toISOString(),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'diagnostico.json', diagnostico);
    const altas = problemas.filter((p) => p.gravedad === 'alta').length;
    return `Diagnóstico listo: ${problemas.length} ${problemas.length === 1 ? 'aspecto' : 'aspectos'} que mejorar${altas ? ` (${altas} importantes)` : ''}`;
  }

  /**
   * Cambia de modo unos apuntes importados en modo conservador: el texto actual pasa a ser la fuente
   * principal y el arquitecto propone un índice nuevo (las secciones actuales se conservan hasta
   * que se apruebe y se redacte el nuevo).
   */
  async cambiarModo(asig: string, doc: string, modo: ModoMejora) {
    if (modo === 'conservador') throw new ErrorUsuario('Para seguir sobre el texto actual no hace falta cambiar nada');
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const textos = (await this.almacen.textoCompleto(asig, doc)).filter((x) => !ARCHIVO_AUTOEVALUACION.test(x.archivo));
    if (!textos.length) throw new ErrorUsuario('El documento no tiene texto');
    await fs.writeFile(path.join(this.almacen.dirFuentes(asig, doc), 'apuntes-originales.md'), textos.map((x) => x.texto.trim()).join('\n\n'), 'utf8');
    const importado: Importacion = documento.importado
      ? { ...documento.importado, modo, formato: documento.importado.formato === 'pdf' ? 'md' : documento.importado.formato }
      : { archivo: 'apuntes-originales.md', formato: 'md', modo, fecha: new Date().toISOString() };
    await this.almacen.actualizarDocumento(asig, doc, { importado });
    return this.proponerIndice(asig, doc);
  }
}
