// Ajustes de la aplicación, guardados fuera de la carpeta de datos.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ajustes } from '../shared/tipos';
import { writeFileAtomic } from './atomicFiles';
import { ErrorUsuario } from './store';

export async function cargarAjustes(archivo: string, carpetaPorDefecto: string): Promise<Ajustes> {
  const base: Ajustes = {
    carpetaDatos: carpetaPorDefecto,
    maxSimultaneos: 3,
    motorPorDefecto: 'claude',
    asistenteCompletado: false,
    agentes: {},
  };
  try {
    const saved = JSON.parse(await fs.readFile(archivo, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || (saved.carpetaDatos !== undefined && (typeof saved.carpetaDatos !== 'string' || !saved.carpetaDatos.trim()))) throw new ErrorUsuario('La configuración guardada no tiene un formato válido', 409);
    const leidos: Ajustes = { ...base, ...saved };
    // Ruta relativa (versión portable): se resuelve junto al archivo de ajustes
    return { ...leidos, carpetaDatos: path.resolve(path.dirname(archivo), leidos.carpetaDatos) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base;
    if (error instanceof ErrorUsuario) throw error;
    throw new ErrorUsuario('No se puede leer la configuración; recupérala desde una copia de seguridad', 409);
  }
}

export async function guardarAjustes(archivo: string, ajustes: Ajustes) {
  await fs.mkdir(path.dirname(archivo), { recursive: true });
  // Si los datos están junto a los ajustes (versión portable), se guarda la ruta relativa: así
  // siguen funcionando aunque la memoria USB cambie de letra o la carpeta se mueva
  const relativa = path.relative(path.dirname(archivo), ajustes.carpetaDatos);
  const carpetaDatos = relativa && !relativa.startsWith('..') && !path.isAbsolute(relativa) ? relativa : ajustes.carpetaDatos;
  await writeFileAtomic(archivo, JSON.stringify({ ...ajustes, carpetaDatos }, null, 2));
}
