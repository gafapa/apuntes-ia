// Ajustes de la aplicación, guardados fuera de la carpeta de datos.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ajustes } from '../shared/tipos';

export async function cargarAjustes(archivo: string, carpetaPorDefecto: string): Promise<Ajustes> {
  const base: Ajustes = {
    carpetaDatos: carpetaPorDefecto,
    maxSimultaneos: 3,
    motorPorDefecto: 'claude',
    asistenteCompletado: false,
    agentes: {},
  };
  try {
    return { ...base, ...JSON.parse(await fs.readFile(archivo, 'utf8')) };
  } catch {
    return base;
  }
}

export async function guardarAjustes(archivo: string, ajustes: Ajustes) {
  await fs.mkdir(path.dirname(archivo), { recursive: true });
  await fs.writeFile(archivo, JSON.stringify(ajustes, null, 2), 'utf8');
}
