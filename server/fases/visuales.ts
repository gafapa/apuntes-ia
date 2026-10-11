// Fase 5: visuales (propuestas, diagramas, imágenes) y pies de figura y de tabla.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PropuestaVisual, MezclaVisuales, ImagenFallida, TipoVisual, Trabajo } from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../shared/tipos';
import { ErrorUsuario, slug } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { dimensiones } from '../imagenes';
import { descargarImagen, referenciaApa, sitioWeb, type ResultadoImagen } from '../imagenesWeb';
import { dibujarGrafica } from '../../web/src/lib/graficas';
import { hashTexto } from '../../shared/hash';
import { insertarTrasAncla } from '../texto';
import { elementosSinPie } from '../pies';
import { sustituirImagen, tiposVisualesPermitidos } from './utilidades';
import { FlujoEscritura } from './escritura';

export class FlujoVisuales extends FlujoEscritura {

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

  protected async cambiarPropuesta(asig: string, doc: string, id: string, cambios: Partial<PropuestaVisual>) {
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
  protected async insertarEnSeccion(asig: string, doc: string, p: PropuestaVisual, bloque: string) {
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
  // Procesamiento de resultados (se puede retomar tras un reinicio del servidor)

  protected async propuesta(asig: string, doc: string, id: string) {
    const p = (await this.almacen.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', [])).find((x) => x.id === id);
    if (!p) throw new Error('La propuesta ya no existe');
    return p;
  }

  protected async postVisuales(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
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

  protected async postDiagrama(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
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
  protected async insertarMolecula(asig: string, doc: string, p: PropuestaVisual, consulta: string) {
    const bloque = ['```molecula', consulta, '```', '', `*Figura: ${p.titulo}*`].join('\n');
    const encontrado = await this.insertarEnSeccion(asig, doc, p, bloque);
    await this.cambiarPropuesta(asig, doc, p.id, { estado: 'insertada', molecula: consulta, error: undefined });
    return encontrado;
  }

  protected async postMolecula(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
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

  protected async postImagenIa(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
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

  protected async postImagenWeb(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
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
