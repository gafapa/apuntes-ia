import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, ImageOff, Trash2, Upload } from 'lucide-react';
import type { Recurso } from '../../../shared/tipos';
import { api, urlDatos } from '../lib/api';
import { useEstado } from '../lib/estado';
import { Boton, BotonIcono, Insignia, Vacio, confirmar, cx } from './ui';
import { Visor } from './Visor';

/** Imágenes del documento: las generadas por los agentes y las que sube el usuario. */
export function GaleriaRecursos({ a, d }: { a: string; d: string }) {
  const { avisar, versiones } = useEstado();
  const version = versiones[`${a}/${d}`];
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [ampliada, setAmpliada] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    api.recursos(a, d).then(setRecursos).catch(() => {});
  }, [a, d]);
  useEffect(cargar, [cargar, version]);

  const subir = async (archivos: File[]) => {
    const imagenes = archivos.filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name));
    if (!imagenes.length) return avisar('Solo se admiten imágenes (png, jpg, gif, webp, svg)', 'error');
    try {
      await api.subirRecursos(a, d, imagenes);
      cargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

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
    <div
      className="flex-1 overflow-y-auto"
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        subir([...e.dataTransfer.files]);
      }}
    >
      <div className={cx('mx-auto max-w-5xl px-8 py-8 transition-colors', arrastrando && 'bg-acento-suave/40')}>
        <div className="mb-5 flex items-center gap-2">
          <div className="flex-1">
            <h2 className="font-semibold">Recursos</h2>
            <p className="text-[13px] text-texto-2">Imágenes del documento. Arrastra aquí las tuyas y copia su enlace para insertarlas en el texto.</p>
          </div>
          <Boton icono={<Upload className="size-4" />} onClick={() => input.current?.click()}>
            Subir imágenes
          </Boton>
          <BotonIcono titulo="Abrir carpeta" onClick={() => api.abrirCarpeta(a, d, 'recursos')}>
            <FolderOpen className="size-4" />
          </BotonIcono>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              subir([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
        {recursos.length === 0 ? (
          <Vacio icono={<ImageOff className="size-6" />} titulo="Sin imágenes" texto="Las imágenes que generen o descarguen los agentes aparecerán aquí." />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {recursos.map((r) => (
              <div key={r.nombre} className="group overflow-hidden rounded-xl border border-borde bg-panel">
                <button className="block aspect-[4/3] w-full bg-panel-2 cursor-zoom-in" onClick={() => setAmpliada(urlDatos(a, 'documentos', d, 'recursos', r.nombre))}>
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
