// Portada e índice para Word y LibreOffice.
//
// Pandoc mete en Word/ODT un campo de índice vacío que solo se rellena si el usuario actualiza
// los campos, y la «portada» son tres líneas encima del índice. Aquí:
// - Se numeran los encabezados y se les da un identificador propio.
// - El índice se escribe ya relleno (enlaces a cada apartado) con los estilos de índice.
// - En Word, ese índice va dentro de un campo de tabla de contenido y el documento pide
//   actualizar los campos al abrirse, para que aparezcan también los números de página.
// - La portada queda en una página propia (título grande en el color de la asignatura).
import fs from 'node:fs/promises';
import JSZip from 'jszip';

export interface Entrada {
  nivel: number;
  numero: string;
  texto: string;
  id: string;
}

const PROFUNDIDAD_INDICE = 2;

/** Añade identificadores a los encabezados y devuelve las entradas del índice. */
export function prepararEncabezados(md: string, numerar: boolean): { md: string; entradas: Entrada[] } {
  const contadores = [0, 0, 0, 0, 0, 0];
  const entradas: Entrada[] = [];
  let enCodigo = false;
  let n = 0;
  const lineas = md.split('\n').map((linea) => {
    if (/^\s*(```|~~~)/.test(linea)) enCodigo = !enCodigo;
    if (enCodigo) return linea;
    const m = linea.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) return linea;
    const nivel = m[1].length;
    let texto = m[2];
    let atributos = '';
    const attr = texto.match(/\s*\{([^}]*)\}$/);
    if (attr) {
      atributos = attr[1];
      texto = texto.slice(0, attr.index).trim();
    }
    const sinNumero = /\.unnumbered|(^|\s)-(\s|$)/.test(atributos);
    if (!sinNumero) {
      contadores[nivel - 1]++;
      for (let i = nivel; i < contadores.length; i++) contadores[i] = 0;
    }
    let id = atributos.match(/#([\w-]+)/)?.[1];
    if (!id) {
      id = `apartado-${++n}`;
      atributos = `#${id} ${atributos}`.trim();
    }
    if (nivel <= PROFUNDIDAD_INDICE && !/\.unlisted/.test(atributos)) {
      entradas.push({ nivel, numero: numerar && !sinNumero ? contadores.slice(0, nivel).join('.') : '', texto: limpiar(texto), id });
    }
    return `${m[1]} ${texto} {${atributos}}`;
  });
  return { md: lineas.join('\n'), entradas };
}

/** Texto plano de un encabezado (sin Markdown) para el índice. */
function limpiar(t: string) {
  return t
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[[\]]/g, '')
    .trim();
}

const escaparMd = (t: string) => t.replace(/([\\[\]*_`<>#])/g, '\\$1');

/** Bloque Markdown del índice para Word u ODT. */
export function bloqueIndice(entradas: Entrada[], formato: 'docx' | 'odt', titulo: string): string {
  const estilo = (nivel: number) => (formato === 'docx' ? `TOC ${nivel}` : `Contents ${nivel}`);
  const cabecera = formato === 'docx' ? 'TOC Heading' : 'Contents Heading';
  const lineas = entradas.map(
    (e) => `::: {custom-style="${estilo(e.nivel)}"}\n[${e.numero ? `${e.numero}\u2003` : ''}${escaparMd(e.texto)}](#${e.id})\n:::`,
  );
  const inicioCampo =
    formato === 'docx'
      ? '```{=openxml}\n<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>\n```'
      : '';
  const finCampo = formato === 'docx' ? '```{=openxml}\n<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>\n```' : '';
  return [`::: {custom-style="${cabecera}"}\n${escaparMd(titulo)}\n:::`, inicioCampo, ...lineas, finCampo].filter(Boolean).join('\n\n');
}

/** Salto de página en el Markdown que se pasa a Pandoc. */
export function saltoPagina(formato: 'docx' | 'odt'): string {
  return formato === 'docx'
    ? '```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```'
    : '::: {custom-style="Apuntes salto"}\n\u200b\n:::';
}

/** Retoques finales del archivo generado por Pandoc. */
export async function retocar(
  archivo: string,
  formato: 'docx' | 'odt',
  op: { portada: boolean; indice: boolean; color: string; plantillaPropia: boolean },
) {
  const zip = await JSZip.loadAsync(await fs.readFile(archivo));
  const color = /^#[0-9a-f]{6}$/i.test(op.color) ? op.color.slice(1).toUpperCase() : '6D4AFF';

  if (formato === 'docx') {
    let doc = await zip.file('word/document.xml')!.async('string');
    if (op.portada) {
      // Portada en página propia: tras la fecha (o el último párrafo del bloque de título), salto
      const fin = ['Date', 'Author', 'Subtitle', 'Title']
        .map((e) => doc.search(new RegExp(`<w:pStyle w:val="${e}"\\s*/>`)))
        .find((i) => i >= 0);
      if (fin !== undefined) {
        const cierre = doc.indexOf('</w:p>', fin) + '</w:p>'.length;
        doc = `${doc.slice(0, cierre)}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${doc.slice(cierre)}`;
      }
      if (!op.plantillaPropia) {
        // Título grande y en el color de la asignatura, más abajo en la página
        doc = doc.replace(
          /<w:pPr>\s*<w:pStyle w:val="Title"\s*\/>\s*<\/w:pPr>([\s\S]*?)<\/w:p>/,
          (_m, runs: string) =>
            `<w:pPr><w:pStyle w:val="Title"/><w:spacing w:before="3600" w:after="360"/></w:pPr>${runs.replace(
              /<w:rPr>/g,
              `<w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="64"/>`,
            )}</w:p>`,
        );
      }
    }
    // Tablas centradas
    doc = doc.replace(/<w:tblPr>/g, '<w:tblPr><w:jc w:val="center"/>');
    zip.file('word/document.xml', doc);
    // Figuras y pies centrados (estilos de Pandoc)
    let estilos = await zip.file('word/styles.xml')!.async('string');
    for (const id of ['CaptionedFigure', 'Figure', 'ImageCaption', 'TableCaption']) {
      estilos = estilos.replace(new RegExp(`(<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?)(</w:style>)`), (_m, cuerpo: string, cierre: string) => {
        if (/<w:jc /.test(cuerpo)) cuerpo = cuerpo.replace(/<w:jc w:val="[^"]*"\s*\/>/, '<w:jc w:val="center"/>');
        else if (/<w:pPr>/.test(cuerpo)) cuerpo = cuerpo.replace('<w:pPr>', '<w:pPr><w:jc w:val="center"/>');
        else cuerpo += '<w:pPr><w:jc w:val="center"/></w:pPr>';
        return cuerpo + cierre;
      });
    }
    zip.file('word/styles.xml', estilos);
    if (op.indice) {
      // Que Word actualice el índice (números de página) al abrir el documento
      let ajustes = await zip.file('word/settings.xml')!.async('string');
      if (!ajustes.includes('w:updateFields')) ajustes = ajustes.replace(/<w:settings([^>]*)>/, '<w:settings$1><w:updateFields w:val="true"/>');
      zip.file('word/settings.xml', ajustes);
    }
  } else {
    // ODT: estilo de párrafo para los saltos de página
    let estilos = await zip.file('styles.xml')!.async('string');
    if (!estilos.includes('Apuntes_20_salto')) {
      estilos = estilos.replace(
        '</office:styles>',
        '<style:style style:name="Apuntes_20_salto" style:display-name="Apuntes salto" style:family="paragraph"><style:paragraph-properties fo:break-before="page" fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties fo:font-size="2pt"/></style:style></office:styles>',
      );
    }
    // Figuras y pies centrados
    for (const nombre of ['Figure', 'FigureCaption', 'TableCaption', 'Table_20_Caption']) {
      estilos = estilos.replace(new RegExp(`(<style:style style:name="${nombre}"[^>]*?)(/?)>`), (_m, ini: string, vacio: string) =>
        vacio
          ? `${ini}><style:paragraph-properties fo:text-align="center"/></style:style>`
          : `${ini}><style:paragraph-properties fo:text-align="center"/>`,
      );
    }
    zip.file('styles.xml', estilos);
    let cont = await zip.file('content.xml')!.async('string');
    // Tablas centradas
    cont = cont.replace(/<style:table-properties ([^>]*?)(\/?)>/g, (_m, attrs: string, vacio: string) =>
      `<style:table-properties ${attrs.replace(/\s*table:align="[^"]*"/, '')} table:align="center"${vacio}>`,
    );
    // Pandoc deja los nombres con espacios; LibreOffice llama a sus estilos de índice «Contents_20_N»
    cont = cont.replace(/text:style-name="Contents (\d|Heading)"/g, (_m, n: string) => `text:style-name="Contents_20_${n}"`);
    zip.file('content.xml', cont);
    if (op.portada) {
      const fin = ['Date', 'Author', 'Subtitle', 'Title'].map((e) => cont.search(new RegExp(`text:style-name="${e}"`))).find((i) => i >= 0);
      if (fin !== undefined) {
        const cierre = cont.indexOf('</text:p>', fin) + '</text:p>'.length;
        cont = `${cont.slice(0, cierre)}<text:p text:style-name="Apuntes_20_salto"/>${cont.slice(cierre)}`;
      }
      zip.file('content.xml', cont);
    }
  }
  await fs.writeFile(archivo, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
