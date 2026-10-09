// Iconos de red para los diagramas Mermaid (router, switch, servidor, pc, cortafuegos, internet…):
// en un flowchart, un nodo con icono se escribe  R1@{ icon: "red:router", label: "Router" }
import iconos from './iconosRed.json';

let registrado = false;

export function registrarIconos(mermaid: typeof import('mermaid').default) {
  if (registrado) return;
  mermaid.registerIconPacks([{ name: 'red', icons: iconos as any }]);
  registrado = true;
}
