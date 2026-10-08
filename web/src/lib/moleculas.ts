// Dibujo de las moléculas de los bloques ```molecula (fórmula estructural en 2D) con SmilesDrawer.
// La estructura (SMILES) la da el servidor, que la busca en PubChem.
import { api, type Molecula } from './api';

const resueltas = new Map<string, Promise<Molecula>>();

/** Estructura de una molécula por su nombre o SMILES (con caché mientras la app está abierta). */
export function resolverMolecula(consulta: string): Promise<Molecula> {
  const clave = consulta.trim().toLowerCase();
  let p = resueltas.get(clave);
  if (!p) {
    p = api.molecula(consulta.trim());
    p.catch(() => resueltas.delete(clave)); // un fallo (sin conexión…) se puede reintentar
    resueltas.set(clave, p);
  }
  return p;
}

let libreria: Promise<typeof import('smiles-drawer').default> | undefined;

/** SVG de la fórmula estructural. `oscuro`: colores para fondo oscuro (vista previa). */
export async function dibujarMolecula(smiles: string, oscuro = false): Promise<string> {
  libreria ??= import('smiles-drawer').then((m) => m.default);
  const SmilesDrawer = await libreria;
  const drawer = new SmilesDrawer.SvgDrawer({
    scale: 1, // tamaño según la molécula (ignora width/height)
    bondThickness: 1.3,
    bondLength: 30,
    fontSizeLarge: 12,
    fontSizeSmall: 7,
    padding: 16,
    compactDrawing: false,
    terminalCarbons: false,
    explicitHydrogens: true,
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  await new Promise<void>((ok, mal) =>
    SmilesDrawer.parse(
      smiles,
      (arbol) => {
        try {
          drawer.draw(arbol, svg, oscuro ? 'dark' : 'light');
          ok();
        } catch (e) {
          mal(e as Error);
        }
      },
      (e) => mal(new Error(`SMILES no válido: ${(e as Error)?.message ?? e}`)),
    ),
  );
  // Fondo transparente: lo pone el contenedor (o el blanco del PNG al exportar)
  svg.style.removeProperty('background-color');
  svg.style.removeProperty('background');
  return new XMLSerializer().serializeToString(svg);
}
