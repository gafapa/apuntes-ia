// Exportación de un examen: tres archivos (el examen para el alumnado, el solucionario y la rúbrica
// de corrección) en PDF (Pandoc + Typst), Word o LibreOffice, y sus preguntas para Moodle (GIFT).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Exportado } from '../shared/tipos';
import type { BloqueActividad } from '../shared/actividades';
import { examenAMarkdown, modeloB, rubricaAMarkdown, solucionarioAMarkdown, type Examen } from '../shared/examenes';
import { Almacen, ErrorUsuario, slug } from './store';
import { ejecutarBinario, rutaPandoc } from './conversion';
import { idiomaExportacion, plantillaTypst } from './exportar';
import { retocar, saltoPagina } from './indiceDocumento';
import { traducirQuimica } from './quimica';
import { generarGift } from './moodle';

export type FormatoExamen = 'pdf' | 'docx' | 'odt';

const dirExportados = (almacen: Almacen, asig: string, id: string) => path.join(almacen.dirExamen(asig, id), 'exportados');

export async function listarExportadosExamen(almacen: Almacen, asig: string, id: string): Promise<Exportado[]> {
  const dir = dirExportados(almacen, asig, id);
  if (!existsSync(dir)) return [];
  const res: Exportado[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const st = await fs.stat(path.join(dir, e.name));
    res.push({ nombre: e.name, formato: path.extname(e.name).slice(1), tamano: st.size, modificado: st.mtime.toISOString() });
  }
  return res.sort((a, b) => b.modificado.localeCompare(a.modificado) || a.nombre.localeCompare(b.nombre));
}

export function rutaExportadoExamen(almacen: Almacen, asig: string, id: string, nombre: string) {
  if (!nombre || nombre.startsWith('.') || /[\\/:*?"<>|]/.test(nombre)) throw new ErrorUsuario('Nombre no válido');
  return path.join(dirExportados(almacen, asig, id), nombre);
}

/** Exporta el examen, el solucionario y la rúbrica en el formato elegido. */
export async function exportarExamen(almacen: Almacen, dirBin: string, asig: string, ex: Examen, formato: FormatoExamen): Promise<Exportado[]> {
  if (!ex.preguntas.length) throw new ErrorUsuario('El examen todavía no tiene preguntas');
  const pandoc = rutaPandoc(dirBin);
  if (!existsSync(pandoc)) throw new ErrorUsuario('No se encuentra Pandoc. Reinstala la aplicación.');
  const typst = path.join(dirBin, process.platform === 'win32' ? 'typst.exe' : 'typst');
  if (formato === 'pdf' && !existsSync(typst)) throw new ErrorUsuario('No se encuentra Typst. Reinstala la aplicación.');
  const asignatura = await almacen.obtenerAsignatura(asig);
  const { lang } = idiomaExportacion(asignatura.idioma);
  const dirExamen = almacen.dirExamen(asig, ex.id);
  const dirTmp = path.join(dirExamen, '.exportacion');
  await fs.rm(dirTmp, { recursive: true, force: true });
  await fs.mkdir(dirTmp, { recursive: true });
  await fs.mkdir(dirExportados(almacen, asig, ex.id), { recursive: true });
  const subtitulo = [asignatura.nombre, asignatura.nivel].filter(Boolean).join(' · ');
  const base = slug(ex.titulo) || 'examen';
  const destino = { formato, salto: formato === 'pdf' ? '```{=typst}\n#pagebreak()\n```' : saltoPagina(formato) };
  // Con modelo B, los dos modelos (cada uno con su solucionario y su rúbrica: cambian el orden y las letras)
  const modelos: [sufijo: string, examen: Examen][] = ex.opciones.modeloB
    ? [
        ['-modelo-a', { ...ex, titulo: `${ex.titulo} (modelo A)` }],
        ['-modelo-b', modeloB(ex)],
      ]
    : [['', ex]];
  const partes: [sufijo: string, titulo: string, md: string][] = modelos.flatMap(([m, e]) => [
    [`examen${m}`, e.titulo, examenAMarkdown(e, destino)],
    [`solucionario${m}`, `Solucionario: ${e.titulo}`, solucionarioAMarkdown(e)],
    [`rubrica${m}`, `Rúbrica de corrección: ${e.titulo}`, rubricaAMarkdown(e)],
  ]);
  const res: Exportado[] = [];
  try {
    if (formato === 'pdf') await fs.writeFile(path.join(dirTmp, 'examen.typ'), plantillaTypst(asignatura.color, { portada: false, saltoSeccion: false }), 'utf8');
    for (const [sufijo, titulo, md] of partes) {
      const entrada = path.join(dirTmp, `${sufijo}.md`);
      await fs.writeFile(entrada, traducirQuimica(md), 'utf8');
      const nombre = `${base}-${sufijo}.${formato}`;
      const salidaTmp = path.join(dirTmp, nombre);
      const comunes = ['-f', 'markdown+tex_math_dollars+raw_attribute', '--resource-path', dirExamen, '-M', `title=${titulo}`, '-M', `subtitle=${subtitulo}`, '-M', `lang=${lang}`];
      if (formato === 'pdf') {
        const typ = path.join(dirExamen, `.exportacion-${sufijo}.typ`);
        try {
          await ejecutarBinario(pandoc, [entrada, '-t', 'typst', '-s', '-o', typ, ...comunes, '-V', 'template=.exportacion/examen.typ', '-V', 'papersize=a4', '-V', 'page-numbering=1'], dirExamen);
          await ejecutarBinario(typst, ['compile', '--root', dirExamen, typ, salidaTmp], dirExamen, 300000);
        } finally {
          await fs.rm(typ, { force: true });
        }
      } else {
        const plantilla = almacen.rutaPlantilla(asig, formato);
        await ejecutarBinario(pandoc, [entrada, '-o', salidaTmp, ...comunes, ...(existsSync(plantilla) ? ['--reference-doc', plantilla] : [])], dirExamen);
        await retocar(salidaTmp, formato, { portada: false, indice: false, color: asignatura.color, plantillaPropia: existsSync(plantilla) });
      }
      const destino = rutaExportadoExamen(almacen, asig, ex.id, nombre);
      try {
        await fs.copyFile(salidaTmp, destino);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM') throw new ErrorUsuario(`«${nombre}» está abierto en otro programa. Ciérralo y vuelve a exportar.`);
        throw e;
      }
      const st = await fs.stat(destino);
      res.push({ nombre, formato, tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return res;
  } catch (e) {
    if (e instanceof ErrorUsuario) throw e;
    throw new ErrorUsuario(`No se pudo exportar: ${(e as Error).message}`, 500);
  } finally {
    await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Preguntas del examen en formato GIFT, para el banco de preguntas de Moodle (Aules, EducaMadrid…). */
export async function exportarExamenMoodle(almacen: Almacen, asig: string, ex: Examen): Promise<Exportado> {
  if (!ex.preguntas.length) throw new ErrorUsuario('El examen todavía no tiene preguntas');
  const bloque: BloqueActividad = {
    id: ex.id,
    titulo: ex.titulo,
    opciones: { tipos: {}, dificultad: ex.opciones.dificultad, secciones: [], soluciones: true },
    estado: 'lista',
    incluir: true,
    // En Moodle, la explicación es la retroalimentación: en las abiertas, la respuesta modelo
    preguntas: ex.preguntas.map((p) => ({ ...p, explicacion: p.explicacion || p.solucion })),
    creado: ex.creado,
    actualizado: ex.actualizado,
  };
  const asignatura = await almacen.obtenerAsignatura(asig);
  const nombre = `${slug(ex.titulo) || 'examen'}-moodle.gift`;
  const destino = rutaExportadoExamen(almacen, asig, ex.id, nombre);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, generarGift([bloque], asignatura.nombre), 'utf8');
  const st = await fs.stat(destino);
  return { nombre, formato: 'gift', tamano: st.size, modificado: st.mtime.toISOString() };
}
