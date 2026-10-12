// Fronteras históricas para los bloques ```mapa con «año»: se descargan del atlas historical-basemaps
// (GPL-3.0, no se distribuye con la app) la primera vez que se piden y se guardan en caché.
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL_FRONTERAS, archivoFronteras } from '../shared/fronteras';

export class Fronteras {
  private enCurso = new Map<string, Promise<Buffer>>();
  constructor(private carpeta: string) {}

  /** GeoJSON de las fronteras del año con mapa más cercano. */
  geojson(año: number): Promise<Buffer> {
    if (!Number.isFinite(año)) return Promise.reject(new Error('Año no válido'));
    const nombre = archivoFronteras(año);
    let p = this.enCurso.get(nombre);
    if (!p) {
      p = this.leerODescargar(nombre).finally(() => this.enCurso.delete(nombre));
      this.enCurso.set(nombre, p);
    }
    return p;
  }

  private async leerODescargar(nombre: string): Promise<Buffer> {
    const archivo = path.join(this.carpeta, nombre);
    try {
      return await fs.readFile(archivo);
    } catch {}
    let r: Response;
    try {
      r = await fetch(`${URL_FRONTERAS}/${nombre}`, { signal: AbortSignal.timeout(60000) });
    } catch {
      throw new Error('No se pudieron descargar las fronteras históricas. Comprueba la conexión a internet.');
    }
    if (!r.ok) throw new Error(`No se pudieron descargar las fronteras históricas (${r.status})`);
    const datos = Buffer.from(await r.arrayBuffer());
    JSON.parse(datos.toString('utf8')); // que sea un GeoJSON completo antes de guardarlo
    await fs.mkdir(this.carpeta, { recursive: true });
    const temporal = `${archivo}.${process.pid}.tmp`;
    await fs.writeFile(temporal, datos);
    await fs.rename(temporal, archivo).catch(() => fs.rm(temporal, { force: true }));
    return datos;
  }
}
