// Fase 6: bloques de actividades de autoevaluación y su exportación a Moodle.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Exportado, Trabajo } from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../shared/tipos';
import { ErrorUsuario, slug } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { generarGift } from '../moodle';
import {
  DIFICULTADES,
  TIPOS_ACTIVIDAD,
  maximoTipo,
  preguntaValida,
  resumenTipos,
  tiposDe,
  type BloqueActividad,
  type OpcionesActividad,
  type PreguntaActividad,
  type TipoActividad,
} from '../../shared/actividades';
import { FlujoVisuales } from './visuales';

/** Formato JSON de cada tipo de pregunta, para pedírselo a la IA (actividades y exámenes). */
export const FORMATO_PREGUNTA: Record<TipoActividad, string> = {
  test: '{"enunciado": "…", "opciones": ["…", "…", "…", "…"], "correcta": 0, "explicacion": "por qué es la correcta"}   («correcta»: índice desde 0; distractores verosímiles)',
  multiple: '{"enunciado": "…", "opciones": ["…", "…", "…", "…", "…"], "correctas": [0, 2], "explicacion": "por qué son esas"}   (4-6 opciones y al menos dos correctas; índices desde 0)',
  numerica: '{"enunciado": "problema con todos los datos y lo que hay que calcular", "valor": 2.5, "tolerancia": 0.05, "unidades": "mol/L", "explicacion": "resolución paso a paso"}   («valor»: número, con punto decimal; «tolerancia»: margen admitido por el redondeo; comprueba el cálculo con la herramienta calcular si la tienes)',
  banco: '{"enunciado": "párrafo con 4-8 huecos marcados así: ___", "respuestas": ["palabra del primer hueco", "del segundo", "…"], "opciones": ["palabra de más", "otra de más"], "explicacion": "…"}   (tantas «respuestas» como huecos, en orden; 2-3 palabras de más verosímiles)',
  tabla: '{"enunciado": "Completa la tabla…", "material": "tabla en Markdown con 3-8 casillas vacías marcadas así: ___", "respuestas": ["lo de la primera casilla vacía", "…"], "explicacion": "…"}   (tantas «respuestas» como casillas vacías, en orden de lectura: por filas, de izquierda a derecha)',
  vfjustificada: '{"enunciado": "afirmación", "correcta": false, "explicacion": "justificación modelo: por qué es verdadera o falsa"}   (las falsas, con un error que haya que razonar)',
  ordenar: '{"enunciado": "Ordena…", "elementos": ["primero", "segundo", "…"], "explicacion": "…"}   (4-7 elementos EN EL ORDEN CORRECTO: la aplicación los desordena)',
  clasificar: '{"enunciado": "Clasifica…", "categorias": [{"nombre": "categoría", "elementos": ["…", "…"]}, …], "explicacion": "…"}   (2-4 categorías y 6-12 elementos en total, sin ambigüedad)',
  error: '{"enunciado": "afirmación o resolución breve con un error", "respuestas": ["versión corregida"], "explicacion": "cuál es el error y por qué"}   (un solo error, conceptual o de cálculo)',
  definicion: '{"enunciado": "Define «…»", "explicacion": "definición modelo, precisa y breve"}',
  esquema: '{"enunciado": "qué hay que dibujar, representar o esquematizar, y qué debe incluir", "explicacion": "descripción del dibujo o esquema correcto: elementos, rótulos y relaciones que debe tener"}',
  redaccion: '{"enunciado": "tarea de escritura con su situación, destinatario, tipo de texto y extensión (p. ej., 150-200 palabras)", "explicacion": "puntos que debe tratar o un ejemplo de respuesta"}',
  abierta: '{"enunciado": "pregunta que se responde razonando en unas líneas (explica, justifica, compara, valora…)", "explicacion": "respuesta modelo breve"}',
  caso: '{"enunciado": "situación real o verosímil con todos los datos y lo que se pide, en apartados a), b), c)…", "explicacion": "respuesta modelo de cada apartado"}   (cada apartado en su propio párrafo: separados por \n\n)',
  datos: '{"material": "tabla en Markdown (o serie de datos) que analizar", "enunciado": "lo que se pide, en apartados a), b), c)…", "explicacion": "respuesta modelo"}   (datos coherentes y verosímiles; si son reales, de las fuentes; cada apartado en su propio párrafo: separados por \n\n)',
  comentario: '{"material": "texto o fragmento que comentar (de las fuentes o escrito para la pregunta)", "enunciado": "preguntas sobre el texto, en apartados a), b), c)…", "explicacion": "respuesta modelo"}   (cada apartado en su propio párrafo: separados por \n\n)',
  vf: '{"enunciado": "afirmación", "correcta": true, "explicacion": "…"}   (mezcla verdaderas y falsas; las falsas, con un error claro)',
  corta: '{"enunciado": "…", "respuestas": ["respuesta aceptada", "otra forma válida"], "explicacion": "…"}   (respuestas breves y cerradas)',
  huecos: '{"enunciado": "frase con el hueco marcado así: ___", "respuestas": ["palabra que falta", "sinónimo válido"], "explicacion": "…"}   (un solo hueco por frase)',
  emparejar: '{"enunciado": "Relaciona…", "pares": [["elemento", "su pareja"], …], "explicacion": "…"}   (cada pregunta, con 5-8 pares; la cantidad es el número de preguntas)',
  desarrollo: '{"enunciado": "…", "explicacion": "respuesta modelo con los puntos que debe incluir"}',
  ejercicio: '{"enunciado": "problema o caso con todos los datos", "respuestas": ["resultado final"], "explicacion": "resolución paso a paso"}   (comprueba los cálculos con la herramienta calcular si la tienes)',
};

export class FlujoActividades extends FlujoVisuales {

  protected async cambiarActividades(asig: string, doc: string, fn: (lista: BloqueActividad[]) => void) {
    return this.conCandado(`${asig}/${doc}/actividades`, async () => {
      const lista = await this.actividades(asig, doc);
      fn(lista);
      await this.almacen.escribirJsonDoc(asig, doc, 'actividades.json', lista);
      return lista;
    });
  }

  /** Genera un bloque nuevo o rehace uno existente (`id`) con las opciones elegidas. */
  async generarActividad(asig: string, doc: string, entrada: Partial<OpcionesActividad>, id?: string) {
    // Cuántas preguntas de cada tipo (se admite también el formato antiguo: un tipo y una cantidad)
    const pedidas = tiposDe({ tipos: entrada.tipos ?? {}, tipo: entrada.tipo, cantidad: entrada.cantidad } as OpcionesActividad).map(
      ([t, n]) => [t, Math.min(n, maximoTipo(t))] as [TipoActividad, number],
    );
    if (!pedidas.length) throw new ErrorUsuario('Elige al menos un tipo de actividad');
    const total = pedidas.reduce((a, [, n]) => a + n, 0);
    if (total > 40) throw new ErrorUsuario('Como máximo 40 preguntas por bloque');
    const nombreTipo = (t: TipoActividad) => TIPOS_ACTIVIDAD.find((x) => x.id === t)!;
    const todas = (await this.almacen.listarSecciones(asig, doc)).filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo) && s.palabras > 40);
    const secciones = entrada.secciones?.length ? todas.filter((s) => entrada.secciones!.includes(s.archivo)) : todas;
    if (!secciones.length) throw new ErrorUsuario('Todavía no hay secciones redactadas sobre las que preguntar');
    const op: OpcionesActividad = {
      tipos: Object.fromEntries(pedidas),
      dificultad: DIFICULTADES.some((d) => d.id === entrada.dificultad) ? entrada.dificultad! : 'media',
      secciones: entrada.secciones?.length ? secciones.map((s) => s.archivo) : [],
      soluciones: entrada.soluciones !== false,
      titulo: entrada.titulo?.trim() || undefined,
      indicaciones: entrada.indicaciones?.trim() || undefined,
    };
    const ahora = new Date().toISOString();
    const bloqueId = id ?? randomUUID().slice(0, 10);
    await this.cambiarActividades(asig, doc, (lista) => {
      const previo = lista.find((b) => b.id === bloqueId);
      if (previo?.estado === 'generando') throw new ErrorUsuario('Este bloque ya se está generando');
      const nuevo: BloqueActividad = {
        id: bloqueId,
        titulo: op.titulo ?? previo?.titulo ?? (pedidas.length === 1 ? nombreTipo(pedidas[0][0]).nombre : 'Actividades variadas'),
        opciones: op,
        estado: 'generando',
        incluir: previo?.incluir ?? true,
        preguntas: previo?.preguntas ?? [],
        creado: previo?.creado ?? ahora,
        actualizado: ahora,
      };
      if (previo) Object.assign(previo, nuevo, { error: undefined });
      else lista.push(nuevo);
    });
    const salida = this.salida(`actividad-${bloqueId}`);
    const dificultad = DIFICULTADES.find((d) => d.id === op.dificultad)!.nombre.toLowerCase();
    await this.lanzar({
      agente: 'autoevaluacion',
      asignatura: asig,
      documento: doc,
      titulo: `Actividades: ${op.titulo ?? resumenTipos(op)}`,
      paso: 'autoevaluacion',
      ref: bloqueId,
      incluir: { secciones: secciones.map((s) => s.archivo) },
      indicaciones: op.indicaciones,
      tarea: `Prepara un bloque de actividades de autoevaluación sobre estas secciones:
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n')}

- Preguntas de cada tipo, exactamente:
${pedidas.map(([t, n]) => `  · ${n} de tipo «${t}» (${nombreTipo(t).nombre}: ${nombreTipo(t).ayuda.toLowerCase()})`).join('\n')}
- Dificultad: ${dificultad}, adecuada a los destinatarios.
- Pregunta solo por lo que está en esas secciones, repartiendo las preguntas entre ellas, sin repetir ideas.
- Explicaciones de las soluciones breves y claras${op.soluciones ? '' : ' (no se mostrarán en los apuntes, pero inclúyelas para la exportación a Moodle)'}.

NO modifiques las secciones. Escribe SOLO en \`${salida}\` este JSON exacto, con las preguntas agrupadas por tipo en ese orden y el campo «tipo» en cada una:
{"titulo": "título breve del bloque", "preguntas": [
${pedidas.map(([t]) => `  {"tipo": "${t}", ${FORMATO_PREGUNTA[t].slice(1)}`).join(',\n')}
]}`,
      post: { tipo: 'actividad', datos: { salida, id: bloqueId } },
    });
    return (await this.actividades(asig, doc)).find((b) => b.id === bloqueId)!;
  }

  async editarActividad(asig: string, doc: string, id: string, cambios: { incluir?: boolean; titulo?: string }) {
    const lista = await this.cambiarActividades(asig, doc, (l) => {
      const b = l.find((x) => x.id === id);
      if (!b) throw new ErrorUsuario('Bloque no encontrado', 404);
      if (typeof cambios.incluir === 'boolean') b.incluir = cambios.incluir;
      if (typeof cambios.titulo === 'string' && cambios.titulo.trim()) b.titulo = cambios.titulo.trim();
    });
    return lista.find((b) => b.id === id)!;
  }

  async eliminarActividad(asig: string, doc: string, id: string) {
    await this.cambiarActividades(asig, doc, (l) => {
      const i = l.findIndex((x) => x.id === id);
      if (i >= 0) l.splice(i, 1);
    });
    return { ok: true };
  }

  /** Resultado de un bloque de actividades: se comprueba y se guarda en actividades.json. */
  protected async postActividad(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const id = String(datos.id);
    const bloque = (await this.actividades(asig, doc)).find((b) => b.id === id);
    if (!bloque) return 'El bloque se ha eliminado mientras se generaba';
    const r = await this.leerSalida<{ titulo?: string; preguntas?: PreguntaActividad[] }>(asig, doc, salida);
    const pedidas = tiposDe(bloque.opciones);
    const tiposValidos = new Set(pedidas.map(([t]) => t));
    // Cada pregunta, con su tipo (si falta y solo se pidió uno, es ese) y con el formato que le corresponde
    const validas = (r.preguntas ?? [])
      .map((p) => ({ ...p, tipo: p?.tipo ?? (pedidas.length === 1 ? pedidas[0][0] : undefined) }))
      .filter((p) => !!p.tipo && tiposValidos.has(p.tipo) && preguntaValida(p as PreguntaActividad))
      // Agrupadas por tipo, en el orden de la lista de tipos
      .sort((a, b) => TIPOS_ACTIVIDAD.findIndex((t) => t.id === a.tipo) - TIPOS_ACTIVIDAD.findIndex((t) => t.id === b.tipo)) as PreguntaActividad[];
    if (!validas.length) {
      throw new PedirAlAgente('Las preguntas no tienen el formato pedido.', `Ninguna pregunta de \`${salida}\` tiene el formato pedido (cada una con su «tipo» y sus campos). Vuelve a escribir el archivo con el JSON exacto.`);
    }
    await this.cambiarActividades(asig, doc, (l) => {
      const b = l.find((x) => x.id === id);
      if (!b) return;
      b.preguntas = validas;
      delete b.importedContent;
      b.estado = 'lista';
      b.error = undefined;
      if (!b.opciones.titulo && r.titulo?.trim()) b.titulo = r.titulo.trim().slice(0, 100);
      b.actualizado = new Date().toISOString();
    });
    const descartadas = (r.preguntas?.length ?? 0) - validas.length;
    return `Bloque listo: ${validas.length} preguntas${descartadas ? ` (${descartadas} descartadas por formato)` : ''}`;
  }

  /** Exporta en formato GIFT (Moodle, Aules, EducaMadrid…) los bloques marcados para incluir. */
  async exportarMoodle(asig: string, doc: string, id: string): Promise<Exportado> {
    const bloque = (await this.actividades(asig, doc)).find((b) => b.id === id);
    if (!bloque || bloque.estado !== 'lista' || !bloque.preguntas.length) throw new ErrorUsuario('El bloque todavía no está listo');
    const bloques = [bloque];
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const nombre = `${slug(documento.titulo) || 'apuntes'}-${slug(bloque.titulo).slice(0, 40) || bloque.id}-moodle.gift`;
    const ruta = this.almacen.rutaExportado(asig, doc, nombre);
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    await fs.writeFile(ruta, generarGift(bloques, documento.titulo), 'utf8');
    const st = await fs.stat(ruta);
    return { nombre, formato: 'gift', tamano: st.size, modificado: st.mtime.toISOString() };
  }
}
