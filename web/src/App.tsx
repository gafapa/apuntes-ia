import { useEffect } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEstado } from './lib/estado';
import { api } from './lib/api';
import { BarraLateral } from './components/BarraLateral';
import { VistaInicio } from './components/VistaInicio';
import { VistaAsignatura } from './components/VistaAsignatura';
import { VistaDocumento } from './components/VistaDocumento';
import { PanelAgentes } from './components/PanelAgentes';
import { AsistenteInicio } from './components/AsistenteInicio';
import { Confirmador, cx } from './components/ui';
import { ProveedorFlujo } from './components/flujo/pasos';

export default function App() {
  const { seleccion, asignaturas, cargarAsignaturas, cargarAjustes, cargarMotores } = useEstado();

  useEffect(() => {
    cargarAsignaturas();
    cargarAjustes();
    cargarMotores().catch(() => {});
    api.version().then((v) => v.actualizacion && useEstado.setState({ actualizacion: v.actualizacion })).catch(() => {});
  }, [cargarAsignaturas, cargarAjustes, cargarMotores]);

  const existe = asignaturas.some((a) => a.id === seleccion.asignatura);
  const enDocumento = !!(seleccion.asignatura && seleccion.documento && existe);
  const contenido = (
    <div className="flex h-full overflow-hidden">
      <BarraLateral />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {enDocumento ? (
          <VistaDocumento key={`${seleccion.asignatura}/${seleccion.documento}`} asignatura={seleccion.asignatura!} documento={seleccion.documento!} />
        ) : seleccion.asignatura ? (
          <VistaAsignatura key={seleccion.asignatura} asignatura={seleccion.asignatura} />
        ) : (
          <VistaInicio />
        )}
      </main>
      {seleccion.asignatura && existe && <PanelAgentes />}
      <Avisos />
      <Confirmador />
      <AsistenteInicio />
    </div>
  );

  // Dentro de un documento, la barra lateral y la vista central comparten el estado del flujo
  return enDocumento ? (
    <ProveedorFlujo key={`${seleccion.asignatura}/${seleccion.documento}`} a={seleccion.asignatura!} d={seleccion.documento!}>
      {contenido}
    </ProveedorFlujo>
  ) : (
    contenido
  );
}

function Avisos() {
  const { avisos, quitarAviso } = useEstado();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {avisos.map((a) => (
        <button
          key={a.id}
          onClick={() => quitarAviso(a.id)}
          className={cx(
            'aparecer pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-borde bg-panel px-4 py-2.5 text-sm shadow-suave cursor-pointer',
          )}
        >
          {a.tipo === 'ok' ? (
            <CheckCircle2 className="size-4 shrink-0 text-ok" />
          ) : a.tipo === 'error' ? (
            <XCircle className="size-4 shrink-0 text-error" />
          ) : (
            <Info className="size-4 shrink-0 text-acento" />
          )}
          <span className="text-left">{a.texto}</span>
        </button>
      ))}
    </div>
  );
}
