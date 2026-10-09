// Pictogramas de ARASAAC (Gobierno de Aragón): busca el pictograma de una palabra y lo guarda en
// caché, para los bloques ```pictogramas.
import fs from 'node:fs/promises';
import path from 'node:path';

const IDIOMAS = new Set(['es', 'ca', 'gl', 'eu', 'en', 'fr', 'de', 'it', 'pt', 'ar', 'ro', 'zh', 'ru', 'pl']);

export class Arasaac {
  constructor(private carpeta: string) {}

  /** PNG del pictograma que mejor corresponde a la palabra. */
  async pictograma(palabra: string, idioma = 'es'): Promise<Buffer> {
    const p = palabra.trim().toLowerCase();
    if (!p || p.length > 60) throw new Error('Palabra no válida');
    const lang = IDIOMAS.has(idioma) ? idioma : 'es';
    const nombre = `${lang}-${p.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}.png`;
    const archivo = path.join(this.carpeta, nombre);
    try {
      return await fs.readFile(archivo);
    } catch {}
    const buscar = async (tipo: 'bestsearch' | 'search') => {
      const r = await fetch(`https://api.arasaac.org/v1/pictograms/${lang}/${tipo}/${encodeURIComponent(p)}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return undefined;
      const lista = (await r.json()) as { _id: number }[];
      return lista[0]?._id;
    };
    let id: number | undefined;
    try {
      id = (await buscar('bestsearch')) ?? (await buscar('search'));
    } catch {
      throw new Error('No se pudo conectar con ARASAAC. Comprueba la conexión a internet.');
    }
    if (!id) throw new Error(`ARASAAC no tiene pictograma para «${palabra}». Prueba con otra palabra (un sinónimo o en singular).`);
    const r = await fetch(`https://static.arasaac.org/pictograms/${id}/${id}_500.png`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`No se pudo descargar el pictograma de «${palabra}»`);
    const datos = Buffer.from(await r.arrayBuffer());
    await fs.mkdir(this.carpeta, { recursive: true });
    await fs.writeFile(archivo, datos).catch(() => {});
    return datos;
  }
}
