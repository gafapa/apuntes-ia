// Permisos efectivos (ficha de la asignatura y del documento) para la interfaz.
import { permisosEfectivos } from '../../../shared/tipos';
import { useEstado } from './estado';

export function usePermisos(asignatura?: string, documento?: string) {
  const a = useEstado((s) => s.asignaturas.find((x) => x.id === asignatura));
  const d = a?.documentos.find((x) => x.id === documento);
  return permisosEfectivos(a?.permisos, d?.permisos);
}
