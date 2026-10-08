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
  EstadoFlujo,
  Indice,
  Motor,
  PasoFlujo,
  PreguntaInvestigacion,
  Profundidad,
  PropuestaVisual,
  Sugerencia,
  TipoRevision,
  TipoVisual,
  Trabajo,
} from '../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../shared/tipos';
import { Almacen, ErrorUsuario, slug } from './store';
import type { Cola, Postproceso } from './agents/cola';
import { AGENTES, construirPrompt } from './agents/agentes';
import { extraerJson, insertarTrasAncla, sustituirFragmento, buscarFragmento, contarPalabras } from './texto';
import { asegurarTextos } from './conversion';

interface Dependencias {
  almacen: () => Almacen;
  cola: Cola;
  ajustes: () => Ajustes;
  motoresListos: () => Set<Motor>;
  dirBin?: string;
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
    const preferido = this.dep.ajustes().agentes[agente]?.motor ?? info.motor;
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

  private async lanzar(l: Lanzamiento): Promise<Trabajo> {
    const asignatura = await this.almacen.obtenerAsignatura(l.asignatura);
    const documento = l.documento ? await this.almacen.obtenerDocumento(l.asignatura, l.documento) : undefined;
    const secciones = documento ? await this.almacen.listarSecciones(l.asignatura, documento.id) : undefined;
    const dirAsig = this.almacen.dirAsignatura(asignatura.id);
    const cwd = documento ? this.almacen.dirDocumento(asignatura.id, documento.id) : dirAsig;
    await fs.mkdir(path.join(cwd, '.agentes'), { recursive: true });
    const motor = this.motorPara(l.agente, l.motor);
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
      prompt: construirPrompt(
        this.instrucciones(l.agente),
        { asignatura, documento, secciones, seccionActiva: l.seccionActiva },
        l.tarea,
        l.indicaciones,
      ),
      cwd,
      dirsExtra: documento ? [dirAsig] : [],
      post: l.post,
    });
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

  private async prepararFuentes(asig: string, doc?: string) {
    if (!this.dep.dirBin) return;
    await asegurarTextos(this.almacen.dirFuentes(asig), this.dep.dirBin).catch(() => {});
    if (doc) await asegurarTextos(this.almacen.dirFuentes(asig, doc), this.dep.dirBin).catch(() => {});
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

  async chat(asig: string, doc: string | undefined, tarea: string, motor?: Motor, seccionActiva?: string) {
    if (!tarea.trim()) throw new ErrorUsuario('Escribe qué quieres que haga');
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
      tarea: tarea + estado,
      paso: 'chat',
      motor: motorFinal,
      seccionActiva,
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

1. Lee todo el material aportado en \`fuentes/\` y \`../../fuentes/\` si lo hay (para .docx, .odt y .pptx usa su versión de texto en \`.texto/\`; los PDF e imágenes léelos directamente).
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
    if (soloApartados && !actual?.entradas.length) throw new ErrorUsuario('Primero hace falta un índice con secciones');
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

Si el usuario te pide cambios después, vuelve a escribir el archivo completo.`
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
Si el usuario te pide cambios después, vuelve a escribir el archivo completo con la versión corregida.`,
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
    };
    const agente: Record<TipoRevision, string> = { estilo: 'estilo', calidad: 'calidad', fuentes: 'fuentes' };
    const lanzados: Trabajo[] = [];
    for (const tipo of tipos) {
      if (this.ocupado('revision', asig, doc, undefined, tipo)) continue;
      const salida = this.salida(`revision-${tipo}`);
      lanzados.push(
        await this.lanzar({
          agente: agente[tipo],
          asignatura: asig,
          documento: doc,
          titulo: `Revisión de ${tipo === 'fuentes' ? 'fuentes y datos' : tipo}`,
          paso: 'revision',
          ref: tipo,
          indicaciones,
          tarea: `Revisa estas secciones fijándote en: ${foco[tipo]}.
${lista}

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

  async proponerVisuales(asig: string, doc: string, archivos?: string[], indicaciones?: string) {
    if (this.ocupado('visuales', asig, doc, undefined, 'director')) throw new ErrorUsuario('Ya se están buscando huecos para visuales');
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter(
      (s) => (!archivos?.length || archivos.includes(s.archivo)) && !ARCHIVO_AUTOEVALUACION.test(s.archivo),
    );
    if (!secciones.length) throw new ErrorUsuario('No hay secciones');
    const conCodex = this.dep.motoresListos().has('codex');
    const salida = this.salida('visuales');
    return this.lanzar({
      agente: 'director-visual',
      asignatura: asig,
      documento: doc,
      titulo: 'Buscar dónde hacen falta visuales',
      paso: 'visuales',
      ref: 'director',
      indicaciones,
      tarea: `Lee estas secciones y propone los apoyos visuales que de verdad ayuden a entender o recordar:
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n')}

Ten en cuenta los que ya existen (imágenes \`![...]\` y bloques \`\`\`mermaid) y no los dupliques.
Tipos permitidos: "diagrama"${conCodex ? ', "imagen-web" e "imagen-ia"' : ' e "imagen-web" (la generación de imágenes con IA no está disponible)'}.

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

Como máximo 2 o 3 por sección, y solo donde aporten. Si el usuario te responde pidiendo cambios, vuelve a escribir el archivo completo.`,
      post: { tipo: 'visuales', datos: { salida, conCodex, archivos: secciones.map((s) => s.archivo) } },
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
    if (cambios.tipo && ['diagrama', 'imagen-ia', 'imagen-web'].includes(cambios.tipo)) permitidos.tipo = cambios.tipo;
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
      const r = insertarTrasAncla(texto, p.ancla, bloque);
      await this.almacen.guardarSeccion(asig, doc, p.seccion, r.texto);
      return r.encontrado;
    });
  }

  async generarVisual(asig: string, doc: string, id: string, indicaciones?: string) {
    const lista = await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []);
    const p = lista.find((x) => x.id === id);
    if (!p) throw new ErrorUsuario('Propuesta no encontrada', 404);
    if (p.estado === 'generando') throw new ErrorUsuario('Ya se está generando');
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
      if (p.tipo === 'diagrama') {
        const salida = this.salida(`diagrama-${p.id}`, 'md');
        return await this.lanzar({
          ...comun,
          titulo: `Diagrama: ${p.titulo}`,
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
        tarea: `${contexto}

Busca en la web una imagen real con licencia libre (preferentemente en Wikimedia Commons) que muestre exactamente eso, con buena resolución y legible.
No descargues nada. Escribe en \`${salida}\` este JSON:

{
  "url": "URL DIRECTA del archivo de imagen (jpg, png, svg o webp; en Wikimedia, la de upload.wikimedia.org)",
  "pagina": "URL de la página de la imagen",
  "autor": "autor o titular",
  "licencia": "p. ej. CC BY-SA 4.0 o dominio público"
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
  // Glosario de la asignatura

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
    if (!['diagrama', 'imagen-ia', 'imagen-web'].includes(post.tipo) || !t.documento) return;
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
    const tipos: TipoVisual[] = conCodex ? ['diagrama', 'imagen-web', 'imagen-ia'] : ['diagrama', 'imagen-web'];
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
          tipo: tipos.includes(p.tipo as TipoVisual) ? (p.tipo as TipoVisual) : 'diagrama',
          titulo: String(p.titulo ?? '').trim() || 'Figura',
          descripcion: String(p.descripcion),
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
    const m = texto.match(/```mermaid\s*\n[\s\S]*?```/);
    if (!m) throw new Error('El agente no ha escrito un bloque mermaid válido. Respóndele para que lo corrija.');
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `${m[0]}\n\n*Figura: ${p.titulo}*`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada' });
    return encontrado ? 'Diagrama insertado' : 'Diagrama añadido al final de la sección (no se encontró el párrafo indicado)';

  }

  private async postImagenIa(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const rel = String(datos.rel);
    const id = String(datos.id);
    const p = await this.propuesta(asig, doc, id);
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), rel);
    if (!existsSync(ruta)) throw new Error(`No se ha guardado la imagen en ${rel}. Respóndele para que lo haga.`);
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `![${p.titulo}](${rel})`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada', archivo: rel });
    return encontrado ? 'Imagen generada e insertada' : 'Imagen añadida al final de la sección';

  }

  private async postImagenWeb(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const id = String(datos.id);
    const archivoBase = String(datos.archivoBase);
    const p = await this.propuesta(asig, doc, id);
    const r = await this.leerSalida<{ url?: string; pagina?: string; autor?: string; licencia?: string }>(asig, doc, salida);
    if (!r.url || !/^https?:\/\//.test(r.url)) throw new Error('No ha indicado una URL de imagen válida. Respóndele para que busque otra.');
    const descargado = await descargarImagen(r.url, path.join(this.almacen.dirDocumento(asig, doc), 'recursos'), archivoBase);
    const rel = `recursos/${descargado}`;
    const credito = [r.autor, r.licencia].filter(Boolean).join(' · ');
    const pie = credito ? `\n\n*Fuente: ${credito}${r.pagina ? ` ([origen](${r.pagina}))` : ''}*` : '';
    const encontrado = await this.insertarEnSeccion(asig, doc, p, `![${p.titulo}](${rel})${pie}`);
    await this.cambiarPropuesta(asig, doc, id, { estado: 'insertada', archivo: rel, credito });
    return encontrado ? 'Imagen descargada e insertada' : 'Imagen añadida al final de la sección';
  }
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

/** Descarga una imagen de internet a la carpeta de recursos y devuelve el nombre del archivo. */
async function descargarImagen(url: string, dir: string, base: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ApuntesIA/1.0 (aplicacion educativa)' } });
    if (!r.ok) throw new Error(`No se pudo descargar la imagen (${r.status}). Respóndele para que busque otra.`);
    const tipo = r.headers.get('content-type') ?? '';
    const ext = /png/.test(tipo) ? 'png' : /jpe?g/.test(tipo) ? 'jpg' : /svg/.test(tipo) ? 'svg' : /webp/.test(tipo) ? 'webp' : /gif/.test(tipo) ? 'gif' : '';
    if (!ext) throw new Error(`La URL no es una imagen (${tipo || 'tipo desconocido'}). Respóndele para que indique la URL directa del archivo.`);
    const datos = Buffer.from(await r.arrayBuffer());
    if (datos.length > 20 * 1024 * 1024) throw new Error('La imagen es demasiado grande (más de 20 MB).');
    await fs.mkdir(dir, { recursive: true });
    const nombre = `${base}.${ext}`;
    await fs.writeFile(path.join(dir, nombre), datos);
    return nombre;
  } finally {
    clearTimeout(t);
  }
}
