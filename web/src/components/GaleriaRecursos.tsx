import { useCallback, useEffect, useState } from 'react';
import { Copy, FolderOpen, ImageOff, Trash2 } from 'lucide-react';
import type { Recurso } from '../../../shared/tipos';
import { api, urlDatos } from '../lib/api';
import { useCampos } from '../lib/estado';
import { BotonIcono, Insignia, Vacio, confirmar } from './ui';
import { Visor } from './Visor';
import { BuscadorImagenes } from './BuscadorImagenes';

/** Imágenes de los apuntes: las que crean o descargan los agentes y aparecen en el documento. */
export function GaleriaRecursos({ a, d }: { a: string; d: string }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  const version = `${versiones[`${a}/${d}`] ?? 0}-${reconexion}`; // también al reconectar con el servidor
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  const [ampliada, setAmpliada] = useState<string>();

  const cargar = useCallback(() => {
    api.recursos(a, d).then(setRecursos).catch(() => {});
  }, [a, d]);
  useEffect(cargar, [cargar, version]);

  const copiar = (r: Recurso) => {
    navigator.clipboard.writeText(`![${r.nombre.replace(/\.\w+$/, '').replace(/[-_]/g, ' ')}](recursos/${r.nombre})`);
    avisar('Copiado. Pégalo en el editor donde quieras la imagen.', 'ok');
  };

  const eliminar = async (r: Recurso) => {
    const ok = await confirmar(`¿Eliminar «${r.nombre}»?`, {
      texto: r.usado ? 'Está insertada en los apuntes: su enlace dejará de funcionar.' : undefined,
      boton: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    await api.eliminarRecurso(a, d, r.nombre).catch((e) => avisar(e.message, 'error'));
    cargar();
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-5 flex items-start gap-2">
          <div className="flex-1">
            <h2 className="font-semibold">Imágenes de los apuntes</h2>
            <p className="text-[13px] text-texto-2">
              Las imágenes que aparecen en tus apuntes, creadas o buscadas por los agentes en la fase de visuales, o las que busques aquí en
              museos y bibliotecas. El material que quieras que los agentes consulten se sube en la pestaña Fuentes.
            </p>
          </div>
          <BotonIcono titulo="Abrir carpeta" onClick={() => api.abrirCarpeta(a, d, 'recursos')}>
            <FolderOpen className="size-4" />
          </BotonIcono>
        </div>
        <BuscadorImagenes a={a} d={d} onGuardada={cargar} />
        {recursos.length === 0 ? (
          <Vacio
            icono={<ImageOff className="size-6" />}
            titulo="Sin imágenes"
            texto="Cuando los agentes generen diagramas o imágenes en la fase de visuales del flujo, aparecerán aquí."
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {recursos.map((r) => (
              <div key={r.nombre} className="group overflow-hidden rounded-xl border border-borde bg-panel">
                <button
                  className="block aspect-[4/3] w-full bg-panel-2 cursor-zoom-in"
                  onClick={() => setAmpliada(urlDatos(a, 'documentos', d, 'recursos', r.nombre))}
                >
                  <img
                    src={`${urlDatos(a, 'documentos', d, 'recursos', r.nombre)}?v=${r.modificado}`}
                    alt={r.nombre}
                    loading="lazy"
                    className="size-full object-contain p-2"
                  />
                </button>
                <div className="flex items-center gap-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={r.nombre}>
                    {r.nombre}
                  </span>
                  {!r.usado && <Insignia>sin usar</Insignia>}
                  <BotonIcono titulo="Copiar enlace Markdown" onClick={() => copiar(r)}>
                    <Copy className="size-3.5" />
                  </BotonIcono>
                  <BotonIcono titulo="Eliminar" className="hover:text-error" onClick={() => eliminar(r)}>
                    <Trash2 className="size-3.5" />
                  </BotonIcono>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Visor contenido={ampliada ? { tipo: 'imagen', src: ampliada } : undefined} onCerrar={() => setAmpliada(undefined)} />
    </div>
  );
}
