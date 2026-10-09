// Flujo de trabajo de un documento: lanza los agentes de cada fase y procesa sus resultados.
//
// Reparto de responsabilidades para que varios agentes trabajen a la vez sin pisarse:
// - Cada redactor escribe solo su sección; el investigador, solo investigacion.md.
// - Los agentes que proponen cosas (índice, sugerencias, visuales) escriben un JSON propio
//   en .agentes/ y es el servidor quien lo valida y lo incorpora (único escritor).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Ajustes,
  Apartado,
  EntradaIndice,
  Esfuerzo,
  EstadoFlujo,
  Indice,
  Motor,
  PasoFlujo,
  PreguntaInvestigacion,
  Profundidad,
  ResultadoBusqueda,
  TipoBusqueda,
  PropuestaVisual,
  MezclaVisuales,
  HerramientasChat,
  SeleccionTexto,
  ImagenFallida,
  Sugerencia,
  TipoRevision,
  TipoVisual,
  Trabajo,
} from '../shared/tipos';
import { ARCHIVO_AUTOEVALUACION, permisosEfectivos, type Permisos } from '../shared/tipos';
import { Almacen, ErrorUsuario, slug } from './store';
import type { Cola, Postproceso } from './agents/cola';
import { PedirAlAgente } from './agents/cola';
import { dimensiones } from './imagenes';
import type { Moleculas } from './moleculas';
import { descargarImagen, referenciaApa, sitioWeb, type ResultadoImagen } from './imagenesWeb';
import { dibujarGrafica } from '../web/src/lib/graficas';
import { hashTexto } from '../shared/hash';
import { AGENTES, construirPrompt } from './agents/agentes';
import { ESFUERZOS, modeloDe, motorElegido } from './agents/modelos';
import { extraerJson, insertarTrasAncla, sustituirFragmento, buscarFragmento, contarPalabras } from './texto';
import { asegurarTextos } from './conversion';
import { DESCRIPCION_TIPO, descargarFuente, guardarResultados, incorporarResultados, leerResultados } from './buscador';
import { buscar as buscarRag, buscarEnTexto, formatear, hayIndice, indexar } from './rag';
import { elementosSinPie } from './pies';

interface Dependencias {
  almacen: () => Almacen;
  cola: Cola;
  ajustes: () => Ajustes;
  motoresListos: () => Set<Motor>;
  dirBin?: string;
  mcpFuentes?: { comando: string; args: string[]; env?: Record<string, string> };
  moleculas?: Moleculas;
}

interface Lanzamiento {
  agente: string;
  asignatura: string;
  documento?: string;
  titulo: string;
  tarea: string;
  indicaciones?: string;
  paso: PasoFlujo;
  seccion?: string;
  ref?: string;
  motor?: Motor; // forzar motor
  seccionActiva?: string;
  web?: boolean; // sobrescribe si el agente puede buscar en la web
  imagenes?: boolean; // herramienta de búsqueda de imágenes en museos y bibliotecas
  guardarImagenes?: boolean; // y la de descargarlas a recursos/ (para peticiones libres)
  fuentes?: boolean; // false: sin la búsqueda en las fuentes aunque estén indexadas
  esfuerzo?: Esfuerzo; // sobrescribe el esfuerzo del agente para esta tarea
  /** Contenido que se incluye en el mensaje para que el agente no tenga que leerlo (ahorra tokens). */
  incluir?: { dossier?: boolean; secciones?: string[]; glosario?: boolean; consulta?: string };
  post?: Postproceso;
}

const INDICE_VACIO: Indice = { profundidad: 1, entradas: [], notas: '', aprobado: false, actualizado: '' };

const profundidadValida = (p: unknown): Profundidad => (p === 2 || p === 3 ? p : 1);

/** Normaliza el árbol de apartados (de la IA o del usuario) hasta la profundidad indicada. */
function limpiarApartados(lista: unknown, niveles: number): Apartado[] {
  if (niveles <= 0 || !Array.isArray(lista)) return [];
  return lista
    .map((x) => (typeof x === 'string' ? { titulo: x } : (x as Partial<Apartado>)))
    .filter((x) => x && String(x.titulo ?? '').trim())
    .map((x) => ({
      id: x.id || randomUUID().slice(0, 8),
      titulo: String(x.titulo).trim(),
      apartados: limpiarApartados(x.apartados, niveles - 1),
    }));
}

/** Estructura de apartados como lista de encabezados Markdown, para el redactor. */
function estructuraMarkdown(apartados: Apartado[], nivel = 2): string[] {
  return apartados.flatMap((a) => [`${'  '.repeat(nivel - 2)}- ${'#'.repeat(nivel)} ${a.titulo}`, ...estructuraMarkdown(a.apartados, nivel + 1)]);
}

export class Flujo {
  private candados = new Map<string, Promise<unknown>>();

  constructor(private dep: Dependencias) {
    dep.cola.manejadores = {
      alTerminar: (t, post) => this.postprocesar(t, post),
      alFallar: (t, post) => this.alFallarPost(t, post),
    };
  }

  private get almacen() {
    return this.dep.almacen();
  }

  /** Ejecuta las operaciones sobre un mismo archivo de una en una. */
  private conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const previo = this.candados.get(clave) ?? Promise.resolve();
    const siguiente = previo.catch(() => {}).then(fn);
    this.candados.set(clave, siguiente);
    return siguiente;
  }

  motorPara(agente: string, forzado?: Motor): Motor {
    const info = AGENTES[agente];
    const listos = this.dep.motoresListos();
    if (forzado) {
      if (!listos.has(forzado)) throw new ErrorUsuario(`Esta tarea necesita ${forzado === 'codex' ? 'Codex' : 'Claude Code'}, que no está disponible`);
      return forzado;
    }
    if (info.soloMotor) return info.soloMotor;
    const preferido = motorElegido(this.dep.ajustes(), agente);
    if (listos.has(preferido) || listos.size === 0) return preferido;
    return [...listos][0];
  }

  instrucciones(agente: string) {
    return this.dep.ajustes().agentes[agente]?.instrucciones?.trim() || AGENTES[agente].instrucciones;
  }

  private ocupado(paso: PasoFlujo, asig: string, doc?: string, seccion?: string, ref?: string) {
    return this.dep.cola
      .listar()
      .some(
        (t) =>
          (t.estado === 'ejecutando' || t.estado === 'en-cola') &&
          t.paso === paso &&
          t.asignatura === asig &&
          t.documento === doc &&
          (seccion === undefined || t.seccion === seccion) &&
          (ref === undefined || t.ref === ref),
      );
  }

  /** Permisos efectivos de un documento (ficha de la asignatura y, encima, la del documento). */
  async permisos(asig: string, doc?: string) {
    const a = await this.almacen.obtenerAsignatura(asig);
    const d = doc ? await this.almacen.obtenerDocumento(asig, doc) : undefined;
    return permisosEfectivos(a.permisos, d?.permisos);
  }

  private async lanzar(l: Lanzamiento): Promise<Trabajo> {
    const asignatura = await this.almacen.obtenerAsignatura(l.asignatura);
    const documento = l.documento ? await this.almacen.obtenerDocumento(l.asignatura, l.documento) : undefined;
    const secciones = documento ? await this.almacen.listarSecciones(l.asignatura, documento.id) : undefined;
    const dirAsig = this.almacen.dirAsignatura(asignatura.id);
    const cwd = documento ? this.almacen.dirDocumento(asignatura.id, documento.id) : dirAsig;
    await fs.mkdir(path.join(cwd, '.agentes'), { recursive: true });
    const motor = this.motorPara(l.agente, l.motor);
    const referencia = await this.contenidoReferencia(asignatura.id, documento?.id, l.incluir);
    // Con fuentes indexadas, el agente recibe la herramienta de búsqueda en lugar de leer documentos enteros
    const carpetas = this.carpetasFuentes(asignatura.id, documento?.id);
    // Lo que la ficha de la asignatura (y la del documento) permite usar a los agentes
    const permisos = permisosEfectivos(asignatura.permisos, documento?.permisos);
    const imagenes = !!l.imagenes && permisos.busquedaImagenes;
    const conIndice = l.fuentes !== false && permisos.fuentes && !!this.dep.mcpFuentes && (await hayIndice(carpetas).catch(() => false));
    const avisoFuentes = conIndice
      ? '\n\n## Material aportado\nEstá indexado. Para consultarlo usa las herramientas `buscar_en_fuentes` (fragmentos relevantes con archivo y página), `listar_fuentes` y `leer_pagina`. No leas los PDF ni documentos largos enteros: busca lo que necesites. Cita la fuente (archivo y página) cuando uses un dato.'
      : '';
    const { sistema, prompt } = construirPrompt(
      this.instrucciones(l.agente),
      { asignatura, documento, secciones, seccionActiva: l.seccionActiva },
      l.tarea + avisoFuentes + textoRestricciones(permisos) + referencia,
      l.indicaciones,
    );
    // Modelo y esfuerzo del agente en el motor con el que va a trabajar (Ajustes › Agentes)
    const elegido = modeloDe(this.dep.ajustes(), l.agente, motor);
    return this.dep.cola.encolar({
      agente: l.agente,
      nombreAgente: AGENTES[l.agente].nombre,
      motor,
      titulo: l.titulo,
      asignatura: asignatura.id,
      documento: documento?.id,
      paso: l.paso,
      seccion: l.seccion,
      ref: l.ref,
      prompt,
      sistema,
      web: (l.web ?? AGENTES[l.agente].web) && permisos.busquedaWeb,
      // Algunas tareas sencillas piden menos esfuerzo que el del agente (p. ej. añadir pies)
      esfuerzo: l.esfuerzo && elegido.esfuerzo ? menorEsfuerzo(l.esfuerzo, elegido.esfuerzo) : elegido.esfuerzo,
      modelo: elegido.modelo,
      mcp:
        this.dep.mcpFuentes && (conIndice || imagenes)
          ? {
              ...this.dep.mcpFuentes,
              args: [
                ...this.dep.mcpFuentes.args,
                ...(imagenes ? ['--imagenes'] : []),
                ...(imagenes && l.guardarImagenes ? [`--recursos=${path.join(cwd, 'recursos')}`] : []),
                ...(conIndice ? Object.entries(carpetas).map(([k, v]) => `${k}=${v}`) : []),
              ],
              env: { ...this.dep.mcpFuentes.env, ...(imagenes ? { APUNTES_CLAVES_IMAGENES: JSON.stringify(this.dep.ajustes().claves ?? {}) } : {}) },
            }
          : undefined,
      cwd,
      dirsExtra: documento ? [dirAsig] : [],
      post: l.post,
    });
  }

  /**
   * Incluye en el mensaje el texto de los archivos que el agente va a necesitar. Leerlos con
   * herramientas cuesta una vuelta más por archivo, y en cada vuelta se reenvía todo el contexto.
   */
  private async contenidoReferencia(asig: string, doc: string | undefined, incluir?: Lanzamiento['incluir']): Promise<string> {
    if (!incluir || !doc) return '';
    const partes: string[] = [];
    const MAX_DOSSIER = 40_000;
    const MAX_SECCIONES = 90_000;
    if (incluir.dossier) {
      const d = await this.almacen.leerArchivoDoc(asig, doc, 'investigacion.md');
      // Dossier largo y tarea concreta: solo las partes relevantes (y siempre la lista de fuentes)
      if (incluir.consulta && d.length > 14_000) {
        const partes2 = buscarEnTexto(d, 'investigacion.md', incluir.consulta, 10);
        const fuentes = d.match(/\n## Fuentes[\s\S]*$/)?.[0] ?? '';
        partes.push(
          '===== investigacion.md (solo las partes relevantes para esta tarea; el dossier completo está en investigacion.md) =====',
          partes2.map((p) => (p.titulo ? `[${p.titulo}]\n${p.texto}` : p.texto)).join('\n\n[…]\n\n'),
          fuentes.trim(),
          '===== fin del extracto del dossier =====',
        );
      } else if (d.trim()) {
        partes.push(
          '===== investigacion.md =====',
          d.length > MAX_DOSSIER ? `${d.slice(0, MAX_DOSSIER)}\n[… recortado: lee investigacion.md si necesitas el resto]` : d,
          '===== fin de investigacion.md =====',
        );
      }
    }
    if (incluir.glosario) {
      const g = await this.almacen.leerGlosario(asig);
      if (g.replace(/^#\s*Glosario\s*/i, '').trim()) partes.push('===== ../../glosario.md =====', g.slice(0, 15_000), '===== fin del glosario =====');
    }
    if (incluir.secciones?.length) {
      const textos = (await this.almacen.textoCompleto(asig, doc)).filter((x) => incluir.secciones!.includes(x.archivo));
      const total = textos.reduce((n, x) => n + x.texto.length, 0);
      if (total <= MAX_SECCIONES) {
        for (const x of textos) partes.push(`===== secciones/${x.archivo} =====`, x.texto, `===== fin de secciones/${x.archivo} =====`);
      }
    }
    if (incluir.consulta) {
      const r = await buscarRag(this.carpetasFuentes(asig, doc), incluir.consulta, 6).catch(() => []);
      if (r.length) partes.push('===== Fragmentos del material aportado más relevantes para esta tarea =====', formatear(r), '===== fin de los fragmentos =====');
    }
    if (!partes.length) return '';
    return `\n\n## Contenido actual de los archivos (ya incluido: no hace falta que los leas)\n${partes.join('\n')}`;
  }

  /** Ruta (relativa a la carpeta del documento) para el resultado estructurado de un agente. */
  private salida(prefijo: string, ext = 'json') {
    return `.agentes/${prefijo}-${randomUUID().slice(0, 8)}.${ext}`;
  }

  private async leerSalida<T>(asig: string, doc: string, rel: string): Promise<T> {
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), rel);
    let texto: string;
    try {
      texto = await fs.readFile(ruta, 'utf8');
    } catch {
      throw new Error(`El agente no ha escrito el archivo de resultado (${rel}). Respóndele para que lo haga.`);
    }
    try {
      return extraerJson<T>(texto);
    } catch {
      throw new Error(`El archivo ${rel} no contiene JSON válido. Respóndele para que lo corrija.`);
    }
  }

  /** Extrae el texto de las fuentes y actualiza su índice de búsqueda. */
  async prepararFuentes(asig: string, doc?: string) {
    for (const dir of [this.almacen.dirFuentes(asig), ...(doc ? [this.almacen.dirFuentes(asig, doc)] : [])]) {
      if (this.dep.dirBin) await asegurarTextos(dir, this.dep.dirBin).catch(() => {});
      await indexar(dir).catch((e) => console.warn('No se pudo indexar', dir, e));
    }
  }

  /** Carpetas de fuentes visibles desde un documento (o una asignatura). */
  carpetasFuentes(asig: string, doc?: string): Record<string, string> {
    return { asignatura: this.almacen.dirFuentes(asig), ...(doc ? { documento: this.almacen.dirFuentes(asig, doc) } : {}) };
  }

  // ---------------------------------------------------------------------------
  // Estado

  async estado(asig: string, doc: string): Promise<EstadoFlujo> {
    const a = this.almacen;
    const info = await a.infoArchivoDoc(asig, doc, 'investigacion.md');
    const dossier = info ? await a.leerArchivoDoc(asig, doc, 'investigacion.md') : '';
    const secciones = await a.listarSecciones(asig, doc);
    const preguntas = (await a.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', [])).map((p) => ({
      ...p,
      respuesta: respuestaEnDossier(dossier, p.texto),
    }));
    return {
      investigacion: info ? { palabras: contarPalabras(dossier), actualizado: info.modificado } : undefined,
      preguntas,
      indice: (await a.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null)) ?? undefined,
      secciones,
      sugerencias: await a.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []),
      visuales: await a.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []),
      autoevaluacion: secciones.find((s) => ARCHIVO_AUTOEVALUACION.test(s.archivo))?.archivo,
      exportados: await a.listarExportados(asig, doc),
    };
  }

  // ---------------------------------------------------------------------------
  // Chat libre con el orquestador

  async chat(
    asig: string,
    doc: string | undefined,
    tarea: string,
    motor?: Motor,
    seccionActiva?: string,
    herramientas: HerramientasChat = {},
    seleccionTexto?: SeleccionTexto,
  ) {
    if (!tarea.trim()) throw new ErrorUsuario('Escribe qué quieres que haga');
    // Petición sobre un fragmento seleccionado en la vista previa: el agente no edita la sección,
    // escribe el fragmento nuevo y la app lo sustituye en su sitio (así no puede tocar nada más)
    let sobreSeleccion: { texto: string; post: Postproceso } | undefined;
    if (doc && seleccionTexto?.fragmento.trim()) {
      const sel = seleccionTexto;
      const salida = this.salida('seleccion', 'md');
      const parcial = sel.texto && sel.texto.replace(/\s+/g, ' ').length < sel.fragmento.replace(/\s+/g, ' ').length * 0.8;
      sobreSeleccion = {
        texto: `

## Selección
El usuario ha seleccionado este fragmento de \`secciones/${sel.seccion}\`${
          parcial ? ` (y, dentro de él, en concreto el texto «${sel.texto.slice(0, 1500)}»)` : ''
        }:

\`\`\`\`markdown
${sel.fragmento}
\`\`\`\`

Actúa SOLO sobre este fragmento; puedes leer la sección para entender el contexto.
- Si la petición pide cambiarlo (reescribir, ampliar, corregir, añadir algo junto a él, sustituir una imagen…), NO edites la sección: escribe en \`${salida}\` el fragmento nuevo completo, en Markdown, que sustituirá exactamente al de arriba (incluye también lo que no cambie). Nada más en ese archivo.
- Si es una pregunta o una consulta, respóndela sin escribir ningún archivo.`,
        post: { tipo: 'seleccion', datos: { salida, seccion: sel.seccion, fragmento: sel.fragmento } },
      };
    }
    let estado = '';
    if (doc) {
      const e = await this.estado(asig, doc);
      estado = [
        '\n## Estado del flujo',
        `- Investigación: ${e.investigacion ? `hecha (${e.investigacion.palabras} palabras en investigacion.md)` : 'no hecha'}`,
        `- Índice: ${e.indice ? `${e.indice.entradas.length} secciones${e.indice.aprobado ? ', aprobado' : ', pendiente de aprobar'}` : 'no existe'}`,
        `- Secciones redactadas: ${e.secciones.filter((s) => s.palabras > 40).length} de ${e.secciones.length}`,
        `- Sugerencias de revisión pendientes: ${e.sugerencias.filter((s) => s.estado === 'pendiente').length}`,
        `- Propuestas visuales pendientes: ${e.visuales.filter((v) => v.estado === 'propuesta').length}`,
      ].join('\n');
    }
    await this.prepararFuentes(asig, doc);
    const motorFinal = motor && this.dep.motoresListos().has(motor) ? motor : undefined;
    return this.lanzar({
      agente: 'orquestador',
      asignatura: asig,
      documento: doc,
      titulo: tarea.trim().split(/\r?\n/)[0].slice(0, 120),
      tarea: tarea + estado + (sobreSeleccion?.texto ?? ''),
      paso: 'chat',
      motor: motorFinal,
      seccionActiva: seleccionTexto?.seccion ?? seccionActiva,
      post: sobreSeleccion?.post,
      // Herramientas elegidas en el panel (por defecto: web y fuentes sí, imágenes no)
      web: herramientas.web ?? true,
      imagenes: !!herramientas.imagenes && !!this.dep.mcpFuentes,
      guardarImagenes: !!doc,
      fuentes: herramientas.fuentes ?? true,
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Investigación

  async investigar(asig: string, doc: string, indicaciones?: string, soloPreguntas = false) {
    if (this.ocupado('investigacion', asig, doc)) throw new ErrorUsuario('Ya hay una investigación en curso');
    await this.prepararFuentes(asig, doc);
    const existe = existsSync(path.join(this.almacen.dirDocumento(asig, doc), 'investigacion.md'));
    const pendientes = (await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', [])).filter(
      (p) => p.estado !== 'respondida',
    );
    if (soloPreguntas && !pendientes.length) throw new ErrorUsuario('No hay preguntas pendientes');
    const bloquePreguntas = pendientes.length
      ? `

### Preguntas del usuario
Responde también a estas preguntas. Para cada una, añade en \`investigacion.md\`, dentro de la sección \`## Preguntas investigadas\` (créala antes de \`## Fuentes\` si no existe), un apartado con este encabezado exacto y la respuesta debajo, citando las fuentes con [n]:
${pendientes.map((p) => `- \`### Pregunta: ${p.texto}\``).join('\n')}`
      : '';
    await this.marcarPreguntas(asig, doc, pendientes.map((p) => p.id), 'investigando');
    const tarea = soloPreguntas
      ? `Investiga las preguntas pendientes del usuario y añade las respuestas al dossier \`investigacion.md\`, sin rehacer el resto del dossier.
Consulta el material aportado (\`fuentes/\`, \`../../fuentes/\`) y fuentes fiables de la web. Añade las fuentes nuevas a la lista \`## Fuentes\` con su número [n]. No inventes datos ni referencias.${bloquePreguntas}`
      : null;
    return this.lanzar({
      agente: 'investigador',
      asignatura: asig,
      documento: doc,
      titulo: soloPreguntas ? `Investigar ${pendientes.length === 1 ? '1 pregunta' : `${pendientes.length} preguntas`}` : existe ? 'Ampliar la investigación' : 'Investigar el tema',
      paso: 'investigacion',
      indicaciones,
      post: { tipo: 'investigacion', datos: { preguntas: pendientes.map((p) => p.id) } },
      tarea: tarea ?? `Elabora el dossier de investigación del documento y guárdalo en \`investigacion.md\`${existe ? ' (ya existe: amplíalo y mejóralo, conservando lo valioso)' : ''}.

1. Revisa el material aportado en \`fuentes/\` y \`../../fuentes/\` si lo hay. Si tienes la herramienta \`buscar_en_fuentes\`, úsala (empieza con \`listar_fuentes\`) en lugar de leer los documentos enteros; si no, lee los archivos (para .docx, .odt y .pptx usa su versión de texto en \`.texto/\`). Las imágenes míralas directamente.
2. Busca en la web lo necesario para cubrir el objetivo del documento con rigor (entre 5 y 12 fuentes fiables).
3. Estructura del dossier (en Markdown):
   - \`# Dossier: <título del documento>\`
   - \`## Enfoque\`: qué deben aprender los destinatarios y cómo enfocarlo.
   - \`## Conceptos clave\`: definiciones precisas.
   - \`## Contenidos\`: organizados por bloques temáticos, con ideas, datos y ejemplos, citando la fuente con [n].
   - \`## Dificultades y errores frecuentes\` del alumnado.
   - \`## Ejemplos, aplicaciones y curiosidades\`.
   - \`## Ideas para apoyos visuales\`.
   - \`## Fuentes\`: lista numerada [n] con autor u organización, título, URL o nombre del archivo y fecha de consulta.
Marca con «(material aportado)» las ideas que procedan del material del profesor. No inventes datos ni referencias.${bloquePreguntas}`,
    });
  }

  // Preguntas de investigación (las escribe el usuario; el servidor es el único que guarda el archivo)

  async anadirPregunta(asig: string, doc: string, texto: string) {
    const limpio = texto.trim().replace(/\s+/g, ' ');
    if (!limpio) throw new ErrorUsuario('Escribe la pregunta');
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      if (lista.some((p) => p.texto.toLowerCase() === limpio.toLowerCase())) throw new ErrorUsuario('Esa pregunta ya está en la lista');
      const p: PreguntaInvestigacion = { id: randomUUID().slice(0, 8), texto: limpio, estado: 'pendiente', creado: new Date().toISOString() };
      lista.push(p);
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista);
      return p;
    });
  }

  async eliminarPregunta(asig: string, doc: string, id: string) {
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista.filter((p) => p.id !== id));
    });
  }

  private async marcarPreguntas(asig: string, doc: string, ids: string[], estado: PreguntaInvestigacion['estado'] | 'segun-dossier') {
    if (!ids.length) return;
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      const dossier = estado === 'segun-dossier' ? await this.almacen.leerArchivoDoc(asig, doc, 'investigacion.md') : '';
      for (const p of lista) {
        if (!ids.includes(p.id)) continue;
        p.estado = estado === 'segun-dossier' ? (respuestaEnDossier(dossier, p.texto) ? 'respondida' : 'pendiente') : estado;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Índice

  async proponerIndice(asig: string, doc: string, indicaciones?: string, profundidadPedida?: number, soloApartados = false) {
    if (this.ocupado('indice', asig, doc)) throw new ErrorUsuario('Ya se está proponiendo un índice');
    await this.prepararFuentes(asig, doc);
    const salida = this.salida('indice');
    const actual = await this.almacen.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null);
    const profundidad = profundidadValida(profundidadPedida ?? actual?.profundidad);
    // El índice actual va en el mensaje (sin campos internos) para que no tenga que leerlo
    const indiceActual = actual?.entradas.length
      ? `

## Índice actual (indice.json; ya incluido, no hace falta leerlo)
${JSON.stringify(
          actual.entradas.map(({ titulo, objetivo, contenidos, extension, visuales, apartados }) => ({ titulo, objetivo, contenidos, extension, visuales, apartados })),
          (k, v) => (k === 'id' ? undefined : v),
        )}`
      : '';
    if (soloApartados && !actual?.entradas.length) throw new ErrorUsuario('Primero hace falta un índice con secciones');
    // Con el currículo oficial, el índice se planifica para cubrir los criterios que tocan a este tema
    const curriculo = await this.almacen.leerCurriculo(asig);
    const conCurriculo = curriculo.trim()
      ? `

## Currículo oficial de la asignatura (curriculo.md)
Planifica el índice para que cubra los resultados de aprendizaje, criterios de evaluación o saberes básicos que correspondan a ESTE documento (según su título y su objetivo; no todo el currículo). En el «objetivo» de cada sección indica entre paréntesis los códigos que trabaja (p. ej. «(RA2: a, b)» o «(CE 3.1, 3.2)»).

${curriculo.slice(0, 30_000)}`
      : '';
    const ejemploApartados =
      profundidad === 1
        ? ''
        : profundidad === 2
          ? `,
      "apartados": [ { "titulo": "Apartado 1" }, { "titulo": "Apartado 2" } ]`
          : `,
      "apartados": [
        { "titulo": "Apartado 1", "apartados": [ { "titulo": "Subapartado 1.1" }, { "titulo": "Subapartado 1.2" } ] },
        { "titulo": "Apartado 2", "apartados": [] }
      ]`;
    const reglaProfundidad =
      profundidad === 1
        ? 'Profundidad: solo secciones (no incluyas apartados).'
        : profundidad === 2
          ? 'Profundidad: secciones con sus apartados (2-6 por sección). Sin subapartados.'
          : 'Profundidad: secciones, apartados (2-6 por sección) y subapartados donde aporten claridad (no hace falta que todos los apartados los tengan).';
    return this.lanzar({
      agente: 'arquitecto',
      asignatura: asig,
      documento: doc,
      titulo: soloApartados ? 'Desarrollar los apartados del índice' : actual ? 'Rehacer el índice' : 'Proponer el índice',
      paso: 'indice',
      incluir: { dossier: true },
      indicaciones,
      tarea: soloApartados
        ? `Desarrolla los apartados del índice director (\`indice.json\`) hasta la profundidad pedida. Mantén EXACTAMENTE las mismas secciones, con sus títulos, su orden y el resto de sus campos; solo añade o mejora sus apartados. Usa el dossier (\`investigacion.md\`) y el material aportado si existen.
${reglaProfundidad}

NO crees ni modifiques secciones. Escribe el índice completo en el archivo \`${salida}\` con este JSON exacto (sin comentarios):

{
  "notas": "breve justificación",
  "entradas": [
    {
      "titulo": "Título de la sección (igual que ahora)",
      "objetivo": "…",
      "contenidos": ["…"],
      "extension": "…",
      "visuales": "…"${ejemploApartados}
    }
  ]
}

Si el usuario te pide cambios después, vuelve a escribir el archivo completo.${indiceActual}${conCurriculo}`
        : `Diseña el índice director del documento a partir del dossier (\`investigacion.md\`, si existe), del material aportado y del objetivo.
${actual ? 'Ya existe un índice en `indice.json`: tenlo en cuenta y mejóralo según las indicaciones.\n' : ''}
NO crees ni modifiques secciones. Escribe tu propuesta en el archivo \`${salida}\` con este JSON exacto (sin comentarios):

{
  "notas": "breve justificación del enfoque y de la secuencia",
  "entradas": [
    {
      "titulo": "Título de la sección",
      "objetivo": "Qué debe entender o saber hacer quien la estudie",
      "contenidos": ["punto 1", "punto 2", "..."],
      "extension": "p. ej. 500-700 palabras",
      "visuales": "apoyos visuales recomendados o cadena vacía"${ejemploApartados}
    }
  ]
}

${reglaProfundidad}
Entre 3 y 12 secciones, según la extensión pedida. La primera puede ser una introducción breve y la última un resumen o síntesis; no incluyas una sección de autoevaluación (hay un agente para eso).
Si el usuario te pide cambios después, vuelve a escribir el archivo completo con la versión corregida.${indiceActual}${conCurriculo}`,
      post: { tipo: 'indice', datos: { salida, profundidad } },
    });
  }

  async guardarIndice(asig: string, doc: string, indice: Indice) {
    if (!Array.isArray(indice?.entradas)) throw new ErrorUsuario('Índice no válido');
    const profundidad = profundidadValida(indice.profundidad);
    const limpio: Indice = {
      profundidad,
      notas: String(indice.notas ?? ''),
      aprobado: !!indice.aprobado,
      actualizado: new Date().toISOString(),
      entradas: indice.entradas
        .filter((e) => e.titulo?.trim())
        .map((e) => ({
          id: e.id || randomUUID().slice(0, 8),
          titulo: e.titulo.trim(),
          objetivo: String(e.objetivo ?? ''),
          contenidos: (e.contenidos ?? []).map(String).filter((c) => c.trim()),
          apartados: limpiarApartados(e.apartados, profundidad - 1),
          extension: String(e.extension ?? ''),
          visuales: String(e.visuales ?? ''),
          archivo: e.archivo,
        })),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', limpio);
    return limpio;
  }

  /** Aprueba el índice: crea las secciones que falten y ordena los archivos según el índice. */
  async aprobarIndice(asig: string, doc: string) {
    return this.conCandado(`${asig}/${doc}/secciones`, async () => {
      const indice = await this.almacen.leerJsonDoc<Indice>(asig, doc, 'indice.json', INDICE_VACIO);
      if (!indice.entradas.length) throw new ErrorUsuario('El índice está vacío');
      let existentes = await this.almacen.listarSecciones(asig, doc);
      const nombres = new Set(existentes.map((s) => s.archivo));
      for (const e of indice.entradas) {
        if (e.archivo && nombres.has(e.archivo)) continue;
        const s = await this.almacen.crearSeccion(asig, doc, e.titulo);
        e.archivo = s.archivo;
        nombres.add(s.archivo);
      }
      // Orden: las del índice primero; las demás (p. ej. autoevaluación) detrás
      existentes = await this.almacen.listarSecciones(asig, doc);
      const delIndice = indice.entradas.map((e) => e.archivo!);
      const resto = existentes.map((s) => s.archivo).filter((a) => !delIndice.includes(a));
      const nuevas = await this.almacen.renumerar(asig, doc, [...delIndice, ...resto]);
      const base = (a: string) => a.replace(/^\d+-/, '');
      for (const e of indice.entradas) e.archivo = nuevas.find((s) => base(s.archivo) === base(e.archivo!))?.archivo;
      indice.aprobado = true;
      indice.actualizado = new Date().toISOString();
      await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', indice);
      return indice;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Redacción (un agente por sección, en paralelo)

  async redactar(asig: string, doc: string, archivos: string[], indicaciones?: string) {
    if (!archivos?.length) throw new ErrorUsuario('Elige al menos una sección');
    await this.prepararFuentes(asig, doc);
    const indice = await this.almacen.leerJsonDoc<Indice>(asig, doc, 'indice.json', INDICE_VACIO);
    const secciones = await this.almacen.listarSecciones(asig, doc);
    const hayDossier = existsSync(path.join(this.almacen.dirDocumento(asig, doc), 'investigacion.md'));
    const lanzados: Trabajo[] = [];
    for (const archivo of archivos) {
      const s = secciones.find((x) => x.archivo === archivo);
      if (!s) continue;
      if (this.ocupado('redaccion', asig, doc, archivo)) continue;
      const entrada = indice.entradas.find((e) => e.archivo === archivo);
      const plan = entrada
        ? [
            `- Título: ${entrada.titulo}`,
            entrada.objetivo && `- Objetivo: ${entrada.objetivo}`,
            entrada.contenidos.length && `- Contenidos:\n${entrada.contenidos.map((c) => `  - ${c}`).join('\n')}`,
            entrada.extension && `- Extensión: ${entrada.extension}`,
            entrada.visuales && `- Apoyos visuales sugeridos: ${entrada.visuales}`,
            entrada.apartados?.length &&
              `- Estructura de apartados (OBLIGATORIA: usa exactamente estos encabezados, en este orden; puedes añadir párrafos, listas y tablas dentro de cada uno, pero no otros encabezados del mismo nivel):\n${estructuraMarkdown(entrada.apartados).map((l) => `  ${l}`).join('\n')}`,
          ]
            .filter(Boolean)
            .join('\n')
        : `- Título: ${s.titulo} (sin plan en el índice: dedúcelo del título y del resto del documento)`;
      const mapa = indice.entradas.length
        ? indice.entradas.map((e, i) => `${i + 1}. ${e.titulo}${e.archivo === archivo ? '  ← ESTA' : ''}${e.objetivo ? ` — ${e.objetivo}` : ''}`).join('\n')
        : secciones.map((x, i) => `${i + 1}. ${x.titulo}${x.archivo === archivo ? '  ← ESTA' : ''}`).join('\n');
      lanzados.push(
        await this.lanzar({
          agente: 'redactor',
          asignatura: asig,
          documento: doc,
          titulo: `Redactar «${s.titulo}»`,
          paso: 'redaccion',
          seccion: archivo,
          incluir: {
            dossier: true,
            glosario: true,
            secciones: [archivo],
            // Para recuperar del dossier y de las fuentes solo lo relevante para esta sección
            consulta: [
              entrada?.titulo ?? s.titulo,
              entrada?.objetivo,
              ...(entrada?.contenidos ?? []),
              ...aplanarApartados(entrada?.apartados ?? []),
            ]
              .filter(Boolean)
              .join('. '),
          },
          indicaciones,
          tarea: `Redacta la sección \`secciones/${archivo}\`${s.palabras > 40 ? ' (ya tiene contenido: mejóralo y complétalo sin perder lo valioso)' : ''}.

### Plan de esta sección
${plan}

### Índice completo del documento (para no repetir lo que tratan otras secciones)
${mapa}

### Instrucciones
- Basa el contenido en ${hayDossier ? '`investigacion.md` y ' : ''}el material aportado${hayDossier ? '' : ' (si lo hay) y en fuentes fiables'}. No inventes datos.
- La primera línea debe ser exactamente \`# ${entrada?.titulo ?? s.titulo}\`. Usa \`##\` y \`###\` para los apartados internos.
- Escribe SOLO en \`secciones/${archivo}\`. Otros agentes están escribiendo las demás secciones a la vez.
- Puedes incluir un diagrama \`\`\`mermaid si el plan lo pide y aporta claridad, y fórmulas en LaTeX ($...$).
- No añadas bibliografía al final de la sección; las fuentes están en el dossier.`,
        }),
      );
    }
    if (!lanzados.length) throw new ErrorUsuario('Esas secciones ya se están redactando');
    return lanzados;
  }

  // ---------------------------------------------------------------------------
  // 4. Revisión: los revisores proponen sugerencias; el usuario decide

  async revisar(asig: string, doc: string, tipos: TipoRevision[], archivos?: string[], indicaciones?: string) {
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => !archivos?.length || archivos.includes(s.archivo));
    if (!secciones.length) throw new ErrorUsuario('No hay secciones que revisar');
    const lista = secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n');
    const foco: Record<TipoRevision, string> = {
      estilo: 'claridad, tono adecuado a los destinatarios, frases largas o ambiguas, repeticiones, ortografía, gramática y coherencia terminológica',
      calidad: 'errores conceptuales, imprecisiones, explicaciones incompletas, saltos lógicos, conceptos usados antes de explicarlos y contenidos que faltan para cumplir el objetivo',
      fuentes: 'datos, cifras, fechas, nombres y afirmaciones verificables; compruébalos contra el dossier, el material aportado y fuentes fiables de la web',
      curriculo:
        'la cobertura del currículo oficial (incluido abajo): qué resultados de aprendizaje, criterios de evaluación o saberes básicos que corresponden a este documento —según su índice y su objetivo— no están tratados o lo están de forma insuficiente. Propón el texto que falta en el lugar adecuado y cita en el motivo el código del criterio (p. ej. «RA2.c» o «CE 3.1»). No exijas lo que pertenece a otros temas',
    };
    const agente: Record<TipoRevision, string> = { estilo: 'estilo', calidad: 'calidad', fuentes: 'fuentes', curriculo: 'curriculo' };
    const curriculo = tipos.includes('curriculo') ? await this.almacen.leerCurriculo(asig) : '';
    if (tipos.includes('curriculo') && !curriculo.trim()) {
      throw new ErrorUsuario('Esta asignatura aún no tiene el currículo oficial. Búscalo en la pestaña «Currículo» de la asignatura.');
    }
    const lanzados: Trabajo[] = [];
    for (const tipo of tipos) {
      if (this.ocupado('revision', asig, doc, undefined, tipo)) continue;
      const salida = this.salida(`revision-${tipo}`);
      lanzados.push(
        await this.lanzar({
          agente: agente[tipo],
          asignatura: asig,
          documento: doc,
          titulo: `Revisión de ${tipo === 'fuentes' ? 'fuentes y datos' : tipo === 'curriculo' ? 'cobertura del currículo' : tipo}`,
          paso: 'revision',
          ref: tipo,
          incluir: { secciones: secciones.map((s) => s.archivo), dossier: tipo === 'fuentes', glosario: tipo === 'estilo' },
          indicaciones,
          tarea: `Revisa estas secciones fijándote en: ${foco[tipo]}.
${lista}
${tipo === 'curriculo' ? `
===== Currículo oficial de la asignatura (curriculo.md) =====
${curriculo.slice(0, 40_000)}
===== fin del currículo =====
` : ''}
NO modifiques las secciones: el usuario decidirá qué cambios aceptar. Escribe tus sugerencias en \`${salida}\` con este JSON exacto:

{
  "sugerencias": [
    {
      "seccion": "nombre del archivo, p. ej. 02-membrana.md",
      "original": "fragmento EXACTO copiado del archivo (una o pocas frases, lo bastante largo para ser único)",
      "propuesta": "texto que sustituye al original (para añadir algo, incluye el original y lo añadido)",
      "motivo": "explicación breve",
      "gravedad": "baja | media | alta"
    }
  ]
}

Como máximo 25 sugerencias; prioriza las importantes. Copia el original carácter a carácter, incluida la sintaxis Markdown. Si no hay nada que mejorar, deja la lista vacía.
Si el usuario te responde pidiendo cambios, vuelve a escribir el archivo completo.`,
          post: { tipo: 'revision', datos: { salida, tipo } },
        }),
      );
    }
    if (!lanzados.length) throw new ErrorUsuario('Esas revisiones ya están en curso');
    return lanzados;
  }

  async decidirSugerencias(asig: string, doc: string, ids: string[], decision: 'aceptar' | 'rechazar', propuestaEditada?: string) {
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const lista = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      let aplicadas = 0;
      let fallidas = 0;
      for (const id of ids) {
        const s = lista.find((x) => x.id === id);
        if (!s || s.estado !== 'pendiente') continue;
        if (decision === 'rechazar') {
          s.estado = 'rechazada';
          continue;
        }
        if (propuestaEditada !== undefined && ids.length === 1) s.propuesta = propuestaEditada;
        const ok = await this.conCandado(`${asig}/${doc}/sec/${s.seccion}`, async () => {
          const texto = await this.almacen.leerSeccion(asig, doc, s.seccion).catch(() => null);
          const nuevo = texto === null ? null : sustituirFragmento(texto, s.original, s.propuesta);
          if (nuevo === null) return false;
          await this.almacen.guardarSeccion(asig, doc, s.seccion, nuevo);
          return true;
        });
        s.estado = ok ? 'aceptada' : 'fallida';
        ok ? aplicadas++ : fallidas++;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', lista);
      return { aplicadas, fallidas };
    });
  }

  async limpiarSugerencias(asig: string, doc: string) {
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const lista = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', lista.filter((s) => s.estado === 'pendiente'));
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Visuales: el director propone, el usuario aprueba y el ilustrador genera

  async proponerVisuales(asig: string, doc: string, archivos?: string[], indicaciones?: string, mezcla: MezclaVisuales = 'equilibrado') {
    if (this.ocupado('visuales', asig, doc, undefined, 'director')) throw new ErrorUsuario('Ya se están buscando huecos para visuales');
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter(
      (s) => (!archivos?.length || archivos.includes(s.archivo)) && !ARCHIVO_AUTOEVALUACION.test(s.archivo),
    );
    if (!secciones.length) throw new ErrorUsuario('No hay secciones');
    const conCodex = this.dep.motoresListos().has('codex');
    const tipos = tiposVisualesPermitidos(await this.permisos(asig, doc), conCodex);
    if (!tipos.length) throw new ErrorUsuario('La ficha de la asignatura o del documento no permite ningún tipo de visual');
    const salida = this.salida('visuales');
    return this.lanzar({
      agente: 'director-visual',
      asignatura: asig,
      documento: doc,
      titulo: 'Buscar dónde hacen falta visuales',
      paso: 'visuales',
      ref: 'director',
      incluir: { secciones: secciones.map((s) => s.archivo) },
      indicaciones,
      tarea: `Lee estas secciones y propone los apoyos visuales que de verdad ayuden a entender o recordar:
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n')}

Ten en cuenta los que ya existen (imágenes \`![...]\` y bloques \`\`\`mermaid) y no los dupliques.
Tipos permitidos (no propongas otros): ${tipos.map((t) => `"${t}"`).join(', ')}.
En las de tipo "molecula", añade "molecula": el nombre del compuesto en inglés tal como figura en PubChem (p. ej. "aspirin") o su SMILES.

NO modifiques las secciones. Escribe tus propuestas en \`${salida}\` con este JSON exacto:

{
  "propuestas": [
    {
      "seccion": "nombre del archivo, p. ej. 02-membrana.md",
      "ancla": "frase EXACTA copiada del párrafo tras el cual debe ir el visual",
      "tipo": "diagrama",
      "titulo": "pie de figura breve",
      "descripcion": "qué debe mostrar exactamente: elementos, relaciones, etiquetas, estilo"
    }
  ]
}

${
  {
    imagenes: 'Reparto pedido por el usuario: MÁS IMÁGENES. La mayoría de las propuestas deben ser imágenes reales (imagen-web, o imagen-ia si lo que hay que mostrar no existe); propón diagramas solo para procesos que no se entiendan sin ellos.',
    equilibrado: 'Reparto pedido por el usuario: EQUILIBRADO. Aproximadamente la mitad imágenes reales y la mitad esquemas, según lo que pida cada contenido.',
    esquemas: 'Reparto pedido por el usuario: MÁS ESQUEMAS. La mayoría deben ser diagramas; propón imágenes solo cuando haya que ver algo real.',
  }[mezcla] ?? ''
}
Como máximo 2 o 3 por sección, y solo donde aporten. Si el usuario te responde pidiendo cambios, vuelve a escribir el archivo completo.`,
      post: { tipo: 'visuales', datos: { salida, conCodex, tipos, archivos: secciones.map((s) => s.archivo) } },
    });
  }

  private async cambiarPropuesta(asig: string, doc: string, id: string, cambios: Partial<PropuestaVisual>) {
    return this.conCandado(`${asig}/${doc}/visuales`, async () => {
      const lista = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
      const p = lista.find((x) => x.id === id);
      if (!p) throw new ErrorUsuario('Propuesta no encontrada', 404);
      Object.assign(p, cambios);
      await this.almacen.escribirJsonDoc(asig, doc, 'visuales.json', lista);
      return p;
    });
  }

  async editarPropuesta(asig: string, doc: string, id: string, cambios: Partial<PropuestaVisual>) {
    const permitidos: Partial<PropuestaVisual> = {};
    if (cambios.tipo && tiposVisualesPermitidos(await this.permisos(asig, doc), true).includes(cambios.tipo)) permitidos.tipo = cambios.tipo;
    if (typeof cambios.molecula === 'string') permitidos.molecula = cambios.molecula.trim();
    if (typeof cambios.titulo === 'string') permitidos.titulo = cambios.titulo;
    if (typeof cambios.descripcion === 'string') permitidos.descripcion = cambios.descripcion;
    if (cambios.estado === 'descartada' || cambios.estado === 'propuesta') permitidos.estado = cambios.estado;
    return this.cambiarPropuesta(asig, doc, id, permitidos);
  }

  async limpiarVisuales(asig: string, doc: string) {
    return this.conCandado(`${asig}/${doc}/visuales`, async () => {
      const lista = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
      await this.almacen.escribirJsonDoc(asig, doc, 'visuales.json', lista.filter((p) => p.estado === 'propuesta' || p.estado === 'generando'));
    });
  }

  /** Inserta un bloque en la sección tras el ancla de la propuesta. */
  private async insertarEnSeccion(asig: string, doc: string, p: PropuestaVisual, bloque: string) {
    return this.conCandado(`${asig}/${doc}/sec/${p.seccion}`, async () => {
      const texto = await this.almacen.leerSeccion(asig, doc, p.seccion);
      const r = (p.reemplaza && sustituirImagen(texto, p.reemplaza, bloque)) || insertarTrasAncla(texto, p.ancla, bloque);
      await this.almacen.guardarSeccion(asig, doc, p.seccion, r.texto);
      return r.encontrado;
    });
  }

  async generarVisual(asig: string, doc: string, id: string, indicaciones?: string) {
    const lista = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
    const p = lista.find((x) => x.id === id);
    if (!p) throw new ErrorUsuario('Propuesta no encontrada', 404);
    if (p.estado === 'generando') throw new ErrorUsuario('Ya se está generando');
    if (!tiposVisualesPermitidos(await this.permisos(asig, doc), true).includes(p.tipo)) {
      throw new ErrorUsuario('La ficha de la asignatura o del documento no permite este tipo de visual. Cámbialo de tipo o cambia la ficha.');
    }
    await this.cambiarPropuesta(asig, doc, id, { estado: 'generando', error: undefined });
    const comun = {
      agente: 'ilustrador',
      asignatura: asig,
      documento: doc,
      paso: 'visuales' as const,
      seccion: p.seccion,
      ref: p.id,
      indicaciones,
    };
    const contexto = `Visual para la sección \`secciones/${p.seccion}\`, que irá tras el párrafo que contiene: «${p.ancla.slice(0, 300)}».
- Pie de figura: ${p.titulo}
- Qué debe mostrar: ${p.descripcion}
Lee la sección para que el visual sea coherente con su contenido y su terminología.`;

    try {
      if (p.tipo === 'molecula') {
        // Si ya se sabe qué molécula es, se inserta directamente (sin agente)
        const directa = p.molecula && (await this.dep.moleculas?.resolver(p.molecula).catch(() => undefined));
        if (directa) {
          await this.insertarMolecula(asig, doc, p, p.molecula!);
          return { insertada: true };
        }
        const salida = this.salida(`molecula-${p.id}`, 'md');
        return await this.lanzar({
          ...comun,
          titulo: `Molécula: ${p.titulo}`,
          esfuerzo: 'low',
          tarea: `${contexto}${p.molecula ? `\n\nSe indicó «${p.molecula}», pero PubChem no lo reconoce.` : ''}

Identifica el compuesto y escribe en \`${salida}\` SOLO esta línea: su nombre en inglés tal como figura en PubChem (p. ej. «acetylsalicylic acid» o «aspirin») o, si no es un compuesto conocido, su SMILES. Nada más. NO modifiques la sección.`,
          post: { tipo: 'molecula', datos: { salida, id } },
        });
      }
      if (p.tipo === 'grafica' || p.tipo === 'mapa') {
        const salida = this.salida(`${p.tipo}-${p.id}`, 'md');
        return await this.lanzar({
          ...comun,
          titulo: `${p.tipo === 'grafica' ? 'Gráfica' : 'Mapa'}: ${p.titulo}`,
          incluir: { secciones: [p.seccion] },
          // Los datos (clima, población, coordenadas) pueden necesitar una búsqueda
          web: true,
          tarea: `${contexto}

Escribe en \`${salida}\` SOLO el bloque \`\`\`${p.tipo} (YAML, con el formato que indican tus normas), nada más.
${
  p.tipo === 'grafica'
    ? 'Elige el tipo adecuado (funcion, lineas, barras, sectores, dispersion, climograma o piramide). Usa datos reales y fiables: si no están en la sección ni en las fuentes, búscalos en una fuente oficial (INE, AEMET, Eurostat…) y no los inventes. Pon título y nombres de ejes cuando ayuden.'
    : 'Elige la base (espana, provincias, europa o mundo), colorea solo las regiones relevantes con una leyenda clara y añade puntos o rutas si ayudan. Usa los nombres actuales de comunidades, provincias o países en español.'
}
NO modifiques la sección.`,
          post: { tipo: 'diagrama', datos: { salida, id, bloque: p.tipo } },
        });
      }
      if (p.tipo === 'diagrama') {
        const salida = this.salida(`diagrama-${p.id}`, 'md');
        return await this.lanzar({
          ...comun,
          titulo: `Diagrama: ${p.titulo}`,
          incluir: { secciones: [p.seccion] },
          tarea: `${contexto}

Dibuja el diagrama con Mermaid y escribe en \`${salida}\` SOLO el bloque \`\`\`mermaid (nada más).
Usa un tipo de diagrama adecuado (flowchart, mindmap, timeline, sequenceDiagram, classDiagram, pie…), etiquetas cortas en el idioma de los apuntes y, para que sea legible en papel, no más de 12-15 nodos. Entrecomilla las etiquetas con caracteres especiales. NO modifiques la sección.`,
          post: { tipo: 'diagrama', datos: { salida, id } },
        });
      }

      const archivoBase = `${slug(p.titulo).slice(0, 40)}-${p.id.slice(0, 4)}`;

      if (p.tipo === 'imagen-ia') {
        const rel = `recursos/${archivoBase}.png`;
        return await this.lanzar({
          ...comun,
          motor: 'codex',
          titulo: `Imagen IA: ${p.titulo}`,
          incluir: { secciones: [p.seccion] },
          tarea: `${contexto}

Genera la imagen con tu herramienta de generación de imágenes y guárdala como \`${rel}\` (PNG).
Estilo de ilustración didáctica, limpia, fondo claro, sin marcas de agua. Si lleva texto, que sea mínimo, en el idioma de los apuntes y sin faltas. NO modifiques la sección.`,
          post: { tipo: 'imagen-ia', datos: { rel, id } },
        });
      }

      // imagen-web
      const salida = this.salida(`imagen-${p.id}`);
      return await this.lanzar({
        ...comun,
        titulo: `Imagen de internet: ${p.titulo}`,
        web: true,
        imagenes: !!this.dep.mcpFuentes,
        incluir: { secciones: [p.seccion] },
        tarea: `${contexto}

Busca una imagen real con licencia libre que muestre exactamente eso, con buena resolución y legible.
${
  this.dep.mcpFuentes
    ? 'Usa primero la herramienta `buscar_imagenes` (consulta en inglés y `consulta_local` en el idioma de los apuntes; prueba 2 o 3 formulaciones si hace falta): busca en museos, bibliotecas y archivos y ya comprueba la licencia. Para historia y arte, prefiere fuentes primarias (obras, grabados, mapas, fotografías de la época). Solo si no hay nada adecuado, busca en la web (preferentemente en Wikimedia Commons).'
    : 'Búscala en la web, preferentemente en Wikimedia Commons.'
}
No descargues nada. Escribe en \`${salida}\` este JSON (copia los datos tal cual de la herramienta si la imagen viene de ella):

{
  "url": "URL DIRECTA del archivo de imagen (jpg, png, svg o webp; en Wikimedia, la de upload.wikimedia.org)",
  "pagina": "URL de la ficha o página de la imagen",
  "titulo": "título de la obra",
  "autor": "autor o titular",
  "fecha": "fecha de la obra, si se conoce",
  "institucion": "museo, biblioteca o archivo que la conserva, si se conoce",
  "licencia": "p. ej. CC0, Dominio público, CC BY 4.0 o CC BY-SA 4.0"
}

Solo licencias que permitan reutilizarla (CC0, dominio público, CC BY, CC BY-SA). NO modifiques la sección.`,
        post: { tipo: 'imagen-web', datos: { salida, id, archivoBase } },
      });
    } catch (e) {
      await this.cambiarPropuesta(asig, doc, id, { estado: 'error', error: (e as Error).message });
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Autoevaluación

  async autoevaluacion(asig: string, doc: string, indicaciones?: string) {
    if (this.ocupado('autoevaluacion', asig, doc)) throw new ErrorUsuario('Ya se está preparando la autoevaluación');
    const archivo = await this.conCandado(`${asig}/${doc}/secciones`, async () => {
      const secciones = await this.almacen.listarSecciones(asig, doc);
      const existente = secciones.find((s) => ARCHIVO_AUTOEVALUACION.test(s.archivo));
      if (existente) return existente.archivo;
      return (await this.almacen.crearSeccion(asig, doc, 'Autoevaluación')).archivo;
    });
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => s.archivo !== archivo);
    return this.lanzar({
      agente: 'autoevaluacion',
      asignatura: asig,
      documento: doc,
      titulo: 'Preparar la autoevaluación',
      paso: 'autoevaluacion',
      incluir: { secciones: secciones.map((s) => s.archivo) },
      seccion: archivo,
      indicaciones,
      tarea: `Prepara las actividades de autoevaluación del documento a partir de sus secciones:
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n')}

Escríbelas en \`secciones/${archivo}\` (sustituye lo que haya), con esta estructura:
- \`# Autoevaluación\`
- \`## Preguntas tipo test\` (8-10, cuatro opciones a/b/c/d, una correcta)
- \`## Preguntas de respuesta corta\` (5-6)
- \`## Ejercicios o preguntas de desarrollo\` (2-3, de aplicación o relación de conceptos)
- \`## Soluciones\`: todas las respuestas explicadas brevemente, numeradas igual.
Ajusta el número y la dificultad a los destinatarios si las indicaciones del usuario no dicen otra cosa. Solo escribe en ese archivo.`,
    });
  }

  // ---------------------------------------------------------------------------
  // Buscador de fuentes (para la asignatura o para un documento)

  private dirBusqueda(asig: string, doc?: string) {
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

  private async cambiarResultado(asig: string, doc: string | undefined, id: string, cambios: Partial<ResultadoBusqueda>) {
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
  // Pies de figura y de tabla

  async sinPie(asig: string, doc: string) {
    const textos = await this.almacen.textoCompleto(asig, doc);
    return textos.flatMap((t) => elementosSinPie(t.texto).map((e) => ({ ...e, seccion: t.archivo })));
  }

  /** Imágenes enlazadas en las secciones cuyo archivo no existe (p. ej. capturas que debe hacer el docente). */
  /**
   * Descarga a `recursos/` una imagen encontrada en museos o bibliotecas y, si se indica una
   * sección, la añade al final con su pie y su crédito. Devuelve el Markdown para insertarla.
   */
  async guardarImagenWeb(asig: string, doc: string, r: ResultadoImagen, seccion?: string, pie?: string) {
    if (!r?.imagen || !/^https?:\/\//.test(r.imagen)) throw new ErrorUsuario('Imagen no válida');
    const base = `${slug(r.titulo).slice(0, 40) || 'imagen'}-${hashTexto(r.id).slice(0, 5)}`;
    let nombre: string;
    try {
      nombre = await descargarImagen(r.imagen, path.join(this.almacen.dirDocumento(asig, doc), 'recursos'), base);
    } catch (e) {
      // Si la imagen grande falla, se intenta con la miniatura (peor resolución, pero sirve)
      if (!r.miniatura || r.miniatura === r.imagen) throw new ErrorUsuario((e as Error).message);
      nombre = await descargarImagen(r.miniatura, path.join(this.almacen.dirDocumento(asig, doc), 'recursos'), base).catch(() => {
        throw new ErrorUsuario((e as Error).message);
      });
    }
    const rel = `recursos/${nombre}`;
    const markdown = `![${(pie || r.titulo).replace(/[[\]]/g, '')}](${rel})\n\n${referenciaApa(r)}`;
    if (seccion) {
      await this.conCandado(`${asig}/${doc}/sec/${seccion}`, async () => {
        const texto = await this.almacen.leerSeccion(asig, doc, seccion);
        await this.almacen.guardarSeccion(asig, doc, seccion, `${texto.trimEnd()}\n\n${markdown}\n`);
      });
    }
    return { archivo: rel, markdown };
  }

  /**
   * Imágenes que han fallado: enlaces del texto cuyo archivo no existe (descargas perdidas, capturas
   * que debe hacer el docente…) e imágenes propuestas que no se pudieron descargar o generar.
   */
  async imagenesQueFaltan(asig: string, doc: string): Promise<ImagenFallida[]> {
    const dir = this.almacen.dirDocumento(asig, doc);
    const textos = await this.almacen.textoCompleto(asig, doc);
    const visuales = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
    const res: ImagenFallida[] = textos.flatMap((t) =>
      [...t.texto.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)]
        .filter(([, , ruta]) => !/^https?:/.test(ruta) && !existsSync(path.join(dir, decodeURIComponent(ruta))))
        .map(([, alt, ruta]) => {
          const v = visuales.find((x) => x.reemplaza === ruta || x.archivo === ruta);
          return { seccion: t.archivo, ruta, alt, motivo: 'falta' as const, visual: v?.id, reparando: v?.estado === 'generando' };
        }),
    );
    for (const v of visuales) {
      if (v.tipo === 'diagrama' || v.tipo === 'molecula' || v.estado !== 'error' || res.some((x) => x.visual === v.id)) continue;
      res.push({ seccion: v.seccion, alt: v.titulo, motivo: 'error', error: v.error, visual: v.id, reparando: false });
    }
    for (const v of visuales) {
      if (v.estado !== 'generando' || v.tipo === 'diagrama' || v.tipo === 'molecula' || res.some((x) => x.visual === v.id)) continue;
      if (v.reemplaza || v.error) res.push({ seccion: v.seccion, alt: v.titulo, motivo: 'error', visual: v.id, reparando: true });
    }
    return res;
  }

  /**
   * Repara las imágenes que han fallado: primero vuelve a intentar la descarga desde la URL que
   * ya se conocía y, si no es posible, pide al ilustrador una imagen alternativa que sustituya a la rota.
   */
  async repararImagenes(asig: string, doc: string) {
    const fallidas = (await this.imagenesQueFaltan(asig, doc)).filter((f) => !f.reparando);
    if (!fallidas.length) throw new ErrorUsuario('No hay imágenes que reparar');
    const dirRecursos = path.join(this.almacen.dirDocumento(asig, doc), 'recursos');
    let redescargadas = 0;
    let buscando = 0;
    const errores: string[] = [];
    for (const f of fallidas) {
      try {
        let v = f.visual ? await this.propuesta(asig, doc, f.visual) : undefined;
        // 1. Reintentar la descarga original
        if (v?.tipo === 'imagen-web' && v.url) {
          const base = f.ruta
            ? path.basename(f.ruta).replace(/\.[^.]+$/, '')
            : `${slug(v.titulo).slice(0, 40)}-${v.id.slice(0, 4)}`;
          const nombre = await descargarImagen(v.url, dirRecursos, base).catch(() => undefined);
          if (nombre) {
            const rel = `recursos/${nombre}`;
            if (f.ruta && f.ruta !== rel) {
              await this.conCandado(`${asig}/${doc}/sec/${f.seccion}`, async () => {
                const texto = await this.almacen.leerSeccion(asig, doc, f.seccion);
                await this.almacen.guardarSeccion(asig, doc, f.seccion, texto.split(`](${f.ruta})`).join(`](${rel})`));
              });
            } else if (!f.ruta) {
              // credito guarda la referencia APA («Tomado de…»); las antiguas eran «Fuente: …»
              const pie = v.credito ? (/^(Tomado|Adaptado) de /.test(v.credito) ? `\n\n${v.credito}` : `\n\n*Fuente: ${v.credito}*`) : '';
              await this.insertarEnSeccion(asig, doc, v, `![${v.titulo}](${rel})${pie}`);
            }
            await this.cambiarPropuesta(asig, doc, v.id, { estado: 'insertada', archivo: rel, error: undefined });
            redescargadas++;
            continue;
          }
        }
        // 2. Buscar una alternativa
        if (!v) {
          const nueva: PropuestaVisual = {
            id: randomUUID().slice(0, 10),
            seccion: f.seccion,
            ancla: '',
            tipo: 'imagen-web',
            titulo: f.alt || 'Imagen',
            descripcion: f.alt || `La imagen que había en ${f.ruta}`,
            reemplaza: f.ruta,
            estado: 'propuesta',
            creado: new Date().toISOString(),
          };
          await this.conCandado(`${asig}/${doc}/visuales`, async () => {
            const lista = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
            await this.almacen.escribirJsonDoc(asig, doc, 'visuales.json', [...lista, nueva]);
          });
          v = nueva;
        } else if (f.ruta && v.reemplaza !== f.ruta) {
          v = await this.cambiarPropuesta(asig, doc, v.id, { reemplaza: f.ruta });
        }
        const antes = v.url ? ` La anterior (${v.url}) no se pudo descargar: busca otra distinta.` : v.error ? ` El intento anterior falló: ${v.error}` : '';
        await this.generarVisual(
          asig,
          doc,
          v.id,
          `Esta imagen sustituye a otra que falló o que falta en el texto.${antes}${f.ruta ? ` En el texto aparecía como «${f.alt}» (${f.ruta}).` : ''}`,
        );
        buscando++;
      } catch (e) {
        errores.push(`${f.alt || f.ruta}: ${(e as Error).message}`);
      }
    }
    const partes = [
      redescargadas && `${redescargadas} descargada${redescargadas === 1 ? '' : 's'} de nuevo`,
      buscando && `buscando alternativa para ${buscando}`,
      errores.length && `${errores.length} con error (${errores.join('; ')})`,
    ].filter(Boolean);
    return { redescargadas, buscando, errores, mensaje: partes.join(', ') || 'Nada que reparar' };
  }

  async anadirPies(asig: string, doc: string) {
    if (this.ocupado('revision', asig, doc, undefined, 'pies')) throw new ErrorUsuario('Ya se están añadiendo los pies');
    const pendientes = await this.sinPie(asig, doc);
    if (!pendientes.length) throw new ErrorUsuario('Todas las imágenes, esquemas y tablas tienen pie');
    const secciones = [...new Set(pendientes.map((p) => p.seccion))];
    return this.lanzar({
      agente: 'estilo',
      asignatura: asig,
      documento: doc,
      titulo: `Añadir pies a ${pendientes.length} elemento${pendientes.length === 1 ? '' : 's'}`,
      paso: 'revision',
      ref: 'pies',
      esfuerzo: 'low',
      incluir: { secciones },
      tarea: `Añade un pie breve y descriptivo (una frase que diga qué muestra) a estos elementos, que no lo tienen:
${pendientes.map((p) => `- secciones/${p.seccion}: ${p.tipo} «${p.muestra}»`).join('\n')}

Formato del pie:
- Imagen: el pie va como texto alternativo, \`![Pie](recursos/archivo.png)\`.
- Diagrama, molécula u otro bloque dibujado (\`\`\`mermaid, \`\`\`molecula, \`\`\`grafica, \`\`\`mapa, \`\`\`sintaxis, \`\`\`abc, \`\`\`svg, \`\`\`pictogramas, \`\`\`etiquetas): una línea \`*Figura: pie*\` justo después del bloque (separada por una línea en blanco).
- Tabla: una línea \`Tabla: pie\` justo después de la tabla (separada por una línea en blanco).

Edita solo esos elementos; no cambies nada más del texto. Si alguno ya tiene un pie en otro formato (en cursiva, en negrita, encima de la tabla…), no añadas otro: convierte el que hay al formato indicado. Nunca dejes dos pies para el mismo elemento.`,
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
  // ---------------------------------------------------------------------------
  // Procesamiento de resultados (se puede retomar tras un reinicio del servidor)

  private async propuesta(asig: string, doc: string, id: string) {
    const p = (await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', [])).find((x) => x.id === id);
    if (!p) throw new Error('La propuesta ya no existe');
    return p;
  }

  private postprocesar(t: Trabajo, post: Postproceso): Promise<string | void> {
    const datos = post.datos ?? {};
    switch (post.tipo) {
      case 'busqueda': {
        const dir = this.dirBusqueda(t.asignatura, t.documento);
        return incorporarResultados(dir, path.join(dir, String(datos.salida)), String(datos.consulta)).then((n) =>
          n ? `${n} fuente${n === 1 ? '' : 's'} encontrada${n === 1 ? '' : 's'}. Elige cuáles añadir.` : 'No ha encontrado fuentes nuevas',
        );
      }
      case 'investigacion':
        return this.postInvestigacion(t, datos);
      case 'indice':
        return this.postIndice(t, datos);
      case 'revision':
        return this.postRevision(t, datos);
      case 'visuales':
        return this.postVisuales(t, datos);
      case 'diagrama':
        return this.postDiagrama(t, datos);
      case 'imagen-ia':
        return this.postImagenIa(t, datos);
      case 'molecula':
        return this.postMolecula(t, datos);
      case 'curriculo':
        return this.almacen.leerCurriculo(t.asignatura).then((c) => {
          if (!c.trim()) throw new Error('El agente no ha escrito curriculo.md. Respóndele para que lo haga.');
          return 'Currículo oficial guardado. Revísalo en la pestaña «Currículo» de la asignatura.';
        });
      case 'seleccion':
        return this.postSeleccion(t, datos);
      case 'imagen-web':
        return this.postImagenWeb(t, datos);
      default:
        return Promise.resolve();
    }
  }

  private async alFallarPost(t: Trabajo, post: Postproceso) {
    if (post.tipo === 'investigacion' && t.documento) {
      await this.marcarPreguntas(t.asignatura, t.documento, (post.datos?.preguntas as string[]) ?? [], 'segun-dossier').catch(() => {});
      return;
    }
    if (!['diagrama', 'grafica', 'mapa', 'molecula', 'imagen-ia', 'imagen-web'].includes(post.tipo) || !t.documento) return;
    const ultimoError = t.eventos.filter((e) => e.tipo === 'error').at(-1)?.texto;
    await this.cambiarPropuesta(t.asignatura, t.documento, String(post.datos?.id), {
      estado: 'error',
      error: t.estado === 'cancelado' ? 'Cancelado' : ultimoError ?? 'No se pudo generar',
    }).catch(() => {});
  }

  private async postInvestigacion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const info = await this.almacen.infoArchivoDoc(asig, doc, 'investigacion.md');
    if (!info) throw new Error('El agente no ha creado investigacion.md. Respóndele para que lo haga.');
    const ids = (datos.preguntas as string[] | undefined) ?? [];
    if (!ids.length) return 'Dossier de investigación listo';
    await this.marcarPreguntas(asig, doc, ids, 'segun-dossier');
    const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
    const sin = lista.filter((p) => ids.includes(p.id) && p.estado !== 'respondida').length;
    return sin
      ? `Dossier actualizado, pero ${sin === 1 ? 'una pregunta quedó' : `${sin} preguntas quedaron`} sin responder. Respóndele para que las complete.`
      : `Dossier actualizado: ${ids.length === 1 ? 'pregunta respondida' : `${ids.length} preguntas respondidas`}`;

  }

  private async postIndice(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const actual = await this.almacen.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null);
    const r = await this.leerSalida<{ notas?: string; entradas?: Partial<EntradaIndice>[] }>(asig, doc, salida);
    const entradas = (r.entradas ?? []).filter((e) => e?.titulo?.trim());
    if (!entradas.length) throw new Error('El índice propuesto está vacío. Respóndele para que lo complete.');
    const previas = actual?.entradas ?? [];
    const profundidad = profundidadValida(datos.profundidad);
    const indice: Indice = {
      profundidad,
      notas: String(r.notas ?? ''),
      aprobado: false,
      actualizado: new Date().toISOString(),
      entradas: entradas.map((e) => {
        // Conservar la sección ya creada si el título coincide
        const previa = previas.find((p) => p.titulo.trim().toLowerCase() === e.titulo!.trim().toLowerCase());
        return {
          id: randomUUID().slice(0, 8),
          titulo: e.titulo!.trim(),
          objetivo: String(e.objetivo ?? ''),
          contenidos: Array.isArray(e.contenidos) ? e.contenidos.map(String) : [],
          apartados: limpiarApartados(e.apartados, profundidad - 1),
          extension: String(e.extension ?? ''),
          visuales: String(e.visuales ?? ''),
          archivo: previa?.archivo,
        };
      }),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', indice);
    return `Índice propuesto: ${indice.entradas.length} secciones. Revísalo y apruébalo.`;

  }

  private async postRevision(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const tipo = datos.tipo as TipoRevision;
    const r = await this.leerSalida<{ sugerencias?: Partial<Sugerencia>[] }>(asig, doc, salida);
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const actuales = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      const textos = new Map((await this.almacen.textoCompleto(asig, doc)).map((x) => [x.archivo, x.texto]));
      let validas = 0;
      let descartadas = 0;
      for (const s of r.sugerencias ?? []) {
        const seccion = String(s.seccion ?? '').replace(/^secciones\//, '');
        const texto = textos.get(seccion);
        if (!texto || !s.original || !s.propuesta || s.original === s.propuesta || !buscarFragmento(texto, String(s.original))) {
          descartadas++;
          continue;
        }
        const dup = actuales.some((x) => x.estado === 'pendiente' && x.seccion === seccion && x.original === s.original && x.propuesta === s.propuesta);
        if (dup) continue;
        actuales.push({
          id: randomUUID().slice(0, 10),
          tipo,
          seccion,
          original: String(s.original),
          propuesta: String(s.propuesta),
          motivo: String(s.motivo ?? ''),
          gravedad: s.gravedad === 'alta' || s.gravedad === 'baja' ? s.gravedad : 'media',
          estado: 'pendiente',
          trabajo: t.id,
          creado: new Date().toISOString(),
        });
        validas++;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', actuales);
      return `${validas} sugerencia${validas === 1 ? '' : 's'}${descartadas ? ` (${descartadas} descartada${descartadas === 1 ? '' : 's'}: no se encontró el texto citado)` : ''}`;
    });

  }

  private async postVisuales(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const conCodex = !!datos.conCodex;
    const secciones = (datos.archivos as string[]).map((archivo) => ({ archivo }));
    const r = await this.leerSalida<{ propuestas?: Partial<PropuestaVisual>[] }>(asig, doc, salida);
    const tipos: TipoVisual[] = (datos.tipos as TipoVisual[] | undefined) ?? (conCodex ? ['diagrama', 'molecula', 'imagen-web', 'imagen-ia'] : ['diagrama', 'molecula', 'imagen-web']);
    return this.conCandado(`${asig}/${doc}/visuales`, async () => {
      const actuales = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
      const nombres = new Set(secciones.map((s) => s.archivo));
      let n = 0;
      for (const p of r.propuestas ?? []) {
        const seccion = String(p.seccion ?? '').replace(/^secciones\//, '');
        if (!nombres.has(seccion) || !p.descripcion) continue;
        actuales.push({
          id: randomUUID().slice(0, 10),
          seccion,
          ancla: String(p.ancla ?? ''),
          tipo: tipos.includes(p.tipo as TipoVisual) ? (p.tipo as TipoVisual) : tipos[0],
          titulo: String(p.titulo ?? '').trim() || 'Figura',
          descripcion: String(p.descripcion),
          ...(p.molecula ? { molecula: String(p.molecula).trim() } : {}),
          estado: 'propuesta',
          creado: new Date().toISOString(),
        });
        n++;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'visuales.json', actuales);
      return n ? `${n} propuesta${n === 1 ? '' : 's'} de visuales. Revísalas y genera las que quieras.` : 'No ha propuesto visuales';
    });

  }

  private async postDiagrama(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const id = String(datos.id);
    const p = await this.propuesta(asig, doc, id);
    const texto = await fs.readFile(path.join(this.almacen.dirDocumento(asig, doc), salida), 'utf8').catch(() => '');
    const bloque = String(datos.bloque ?? 'mermaid');
    const m = texto.match(new RegExp('```' + bloque + '\\s*\\n([\\s\\S]*?)```'));
    if (!m) throw new PedirAlAgente(`No ha escrito un bloque ${bloque} válido.`, `Escribe en \`${salida}\` SOLO el bloque \`\`\`${bloque}, nada más.`);
    // Las gráficas se comprueban dibujándolas (igual que lo hará la vista previa)
    if (bloque === 'grafica') {
      try {
        dibujarGrafica(m[1]);
      } catch (e) {
        throw new PedirAlAgente(`La gráfica tiene un error: ${(e as Error).message}`, `La gráfica no se puede dibujar: ${(e as Error).message}. Corrige el bloque en \`${salida}\`.`);
      }
    }
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `${m[0]}\n\n*Figura: ${p.titulo}*`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada' });
    return encontrado ? 'Diagrama insertado' : 'Diagrama añadido al final de la sección (no se encontró el párrafo indicado)';

  }

  /** Inserta el bloque ```molecula (y su pie) en la sección y marca la propuesta como insertada. */
  private async insertarMolecula(asig: string, doc: string, p: PropuestaVisual, consulta: string) {
    const bloque = ['```molecula', consulta, '```', '', `*Figura: ${p.titulo}*`].join('\n');
    const encontrado = await this.insertarEnSeccion(asig, doc, p, bloque);
    await this.cambiarPropuesta(asig, doc, p.id, { estado: 'insertada', molecula: consulta, error: undefined });
    return encontrado;
  }

  /** Petición sobre una selección: si el agente ha escrito el fragmento nuevo, sustituye al seleccionado. */
  private async postSeleccion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const seccion = String(datos.seccion);
    const original = String(datos.fragmento);
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), salida);
    const nuevo = await fs.readFile(ruta, 'utf8').catch(() => undefined);
    if (nuevo === undefined) return; // era una pregunta: ya ha respondido
    // Por si lo ha envuelto en un bloque ```markdown
    const limpio = nuevo.replace(/^\s*`{3,4}(?:markdown|md)?\s*\n([\s\S]*?)\n`{3,4}\s*$/, '$1').trim();
    if (!limpio) throw new PedirAlAgente('El fragmento nuevo está vacío.', `\`${salida}\` está vacío. Escribe en él el fragmento nuevo completo.`);
    const resultado = await this.conCandado(`${asig}/${doc}/sec/${seccion}`, async () => {
      const texto = await this.almacen.leerSeccion(asig, doc, seccion);
      const cambiado = sustituirFragmento(texto, original, limpio);
      if (cambiado === null) return false;
      await this.almacen.guardarSeccion(asig, doc, seccion, cambiado);
      return true;
    });
    await fs.rm(ruta, { force: true }).catch(() => {});
    if (!resultado) {
      throw new Error('El fragmento seleccionado ya no está en la sección (¿se ha editado mientras tanto?). Vuelve a seleccionarlo y repite la petición.');
    }
    return 'Selección actualizada';
  }

  private async postMolecula(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const p = await this.propuesta(asig, doc, String(datos.id));
    const texto = await fs.readFile(path.join(this.almacen.dirDocumento(asig, doc), salida), 'utf8').catch(() => '');
    const consulta = texto
      .replace(/```\w*/g, '')
      .split('\n')
      .map((l) => l.trim().replace(/^[«"'`]|[»"'`]$/g, ''))
      .find(Boolean);
    if (!consulta) throw new PedirAlAgente('No ha indicado la molécula.', `Escribe en \`${salida}\` el nombre en inglés (PubChem) o el SMILES del compuesto.`);
    try {
      await this.dep.moleculas?.resolver(consulta);
    } catch (e) {
      throw new PedirAlAgente(`${(e as Error).message}`, `PubChem no reconoce «${consulta}». Escribe en \`${salida}\` otro nombre en inglés del compuesto (el que use PubChem) o su SMILES.`);
    }
    const encontrado = await this.insertarMolecula(asig, doc, p, consulta);
    return encontrado ? 'Molécula insertada' : 'Molécula añadida al final de la sección';
  }

  private async postImagenIa(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const rel = String(datos.rel);
    const id = String(datos.id);
    const p = await this.propuesta(asig, doc, id);
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), rel);
    if (!existsSync(ruta) || !dimensiones(ruta)) {
      throw new PedirAlAgente(`No se ha guardado la imagen en ${rel}.`, `La imagen no está guardada (o está dañada) en \`${rel}\`. Genérala de nuevo y guárdala ahí como PNG.`);
    }
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `![${p.titulo}](${rel})`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada', archivo: rel, reemplaza: rel });
    return encontrado ? 'Imagen generada e insertada' : 'Imagen añadida al final de la sección';

  }

  private async postImagenWeb(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const id = String(datos.id);
    const archivoBase = String(datos.archivoBase);
    const p = await this.propuesta(asig, doc, id);
    const r = await this.leerSalida<{ url?: string; pagina?: string; titulo?: string; autor?: string; fecha?: string; institucion?: string; licencia?: string }>(asig, doc, salida);
    const otra = (motivo: string) =>
      new PedirAlAgente(
        motivo,
        `${motivo} Busca OTRA imagen alternativa (distinta de las anteriores) que muestre lo mismo, con licencia libre y preferiblemente en upload.wikimedia.org. Comprueba que la URL es el archivo de imagen directo y vuelve a escribir \`${salida}\` con el mismo formato.`,
      );
    if (!r.url || !/^https?:\/\//.test(r.url)) throw otra('No ha indicado una URL de imagen válida.');
    let descargado: string;
    try {
      descargado = await descargarImagen(r.url, path.join(this.almacen.dirDocumento(asig, doc), 'recursos'), archivoBase);
    } catch (e) {
      await this.cambiarPropuesta(asig, doc, id, { url: r.url });
      throw otra(`${(e as Error).message.replace(/\.$/, '')}: ${r.url}.`);
    }
    const rel = `recursos/${descargado}`;
    // Referencia APA 7 bajo la imagen (al exportar pasa al pie de figura)
    const credito = referenciaApa({ ...r, institucion: r.institucion ?? sitioWeb(r.pagina ?? r.url) });
    const pie = `\n\n${credito}`;
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `![${p.titulo}](${rel})${pie}`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada', archivo: rel, credito, url: r.url, reemplaza: rel, error: undefined });
    return encontrado ? 'Imagen descargada e insertada' : 'Imagen añadida al final de la sección';
  }
}

/**
 * Sustituye en el texto la imagen enlazada a `ruta` (y su línea «*Fuente: …*» o la nota en cursiva
 * entre paréntesis que la acompañe) por `bloque`. Undefined si la imagen no está en el texto.
 */
function sustituirImagen(texto: string, ruta: string, bloque: string): { texto: string; encontrado: boolean } | undefined {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => /^\s*!\[[^\]]*\]\(([^)\s]+)\)/.test(l) && l.includes(`](${ruta})`));
  if (i < 0) return undefined;
  let fin = i + 1;
  let j = i + 1;
  while (j < lineas.length && !lineas[j].trim()) j++;
  if (/^\s*(\*(Fuente:[^*]+|\([^*]+\))\*|(Tomado|Adaptado) de .+)\s*$/.test(lineas[j] ?? '')) fin = j + 1;
  lineas.splice(i, fin - i, bloque);
  return { texto: lineas.join('\n'), encontrado: true };
}

function aplanarApartados(l: Apartado[]): string[] {
  return l.flatMap((a) => [a.titulo, ...aplanarApartados(a.apartados ?? [])]);
}

/** Respuesta a una pregunta dentro del dossier (apartado «### Pregunta: …»), si existe. */
function respuestaEnDossier(dossier: string, pregunta: string): string | undefined {
  if (!dossier) return undefined;
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.\s]+/g, ' ').trim().toLowerCase();
  const objetivo = norm(pregunta);
  const lineas = dossier.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(#{2,4})\s*Pregunta:\s*(.+)$/i);
    if (!m || norm(m[2]) !== objetivo) continue;
    const nivel = m[1].length;
    const cuerpo: string[] = [];
    for (let j = i + 1; j < lineas.length; j++) {
      const h = lineas[j].match(/^(#{1,6})\s/);
      if (h && h[1].length <= nivel) break;
      cuerpo.push(lineas[j]);
    }
    const texto = cuerpo.join('\n').trim();
    return texto || undefined;
  }
  return undefined;
}


/** Lo que la ficha no permite, dicho al agente (el resto se controla quitándole la herramienta). */
function textoRestricciones(p: Required<Permisos>): string {
  const no = [
    !p.diagramas && 'esquemas ni diagramas (bloques ```mermaid)',
    !p.moleculas && 'estructuras de moléculas (bloques ```molecula)',
    !p.imagenesWeb && !p.imagenesIA && 'imágenes',
    p.imagenesWeb !== p.imagenesIA && (p.imagenesWeb ? 'imágenes generadas con IA' : 'imágenes reales de internet, museos o bibliotecas'),
  ].filter(Boolean);
  return no.length ? `\n\n## Restricciones de esta asignatura\nNo incluyas ni propongas ${no.join(', ni ')}.` : '';
}

/** Tipos de visual que se pueden proponer o generar según la ficha (y si Codex está disponible). */
export function tiposVisualesPermitidos(p: Required<Permisos>, conCodex: boolean): TipoVisual[] {
  return [
    p.diagramas && 'diagrama',
    p.diagramas && 'grafica',
    p.diagramas && 'mapa',
    p.moleculas && 'molecula',
    p.imagenesWeb && 'imagen-web',
    p.imagenesIA && conCodex && 'imagen-ia',
  ].filter((t): t is TipoVisual => !!t);
}

/** El menor de dos niveles de esfuerzo. */
function menorEsfuerzo(a: Esfuerzo, b: Esfuerzo): Esfuerzo {
  return ESFUERZOS.indexOf(a) <= ESFUERZOS.indexOf(b) ? a : b;
}
