import { useCallback, useEffect, useRef, useState } from 'react';
import { File, FileImage, FileText, FolderOpen, Trash2, Upload } from 'lucide-react';
import type { Fuente } from '../../../shared/tipos';
import { api, urlDatos } from '../lib/api';
import { useEstado } from '../lib/estado';
import { Boton, BotonIcono, Entrada, confirmar, cx } from './ui';
import { BuscadorFuentes } from './BuscadorFuentes';
import { BuscadorIndice } from './BuscadorIndice';

function tamano(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

function IconoArchivo({ nombre }: { nombre: string }) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(nombre)) return <FileImage className="size-4 text-sky-500" />;
  if (/\.(pdf|docx?|odt|pptx?|md|txt)$/i.test(nombre)) return <FileText className="size-4 text-acento" />;
  return <File className="size-4 text-texto-3" />;
}

/** Material aportado (opcional) para una asignatura o un documento. */
export function GestorFuentes({ asignatura, documento, descripcion }: { asignatura: string; documento?: string; descripcion: string }) {
  const { avisar, versiones } = useEstado();
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [filtro, setFiltro] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const version = versiones[`${asignatura}/${documento ?? ''}`];

  const [indice, setIndice] = useState<Record<string, { fragmentos: number; paginas?: number; estado: string }>>({});
  const cargar = useCallback(() => {
    api.fuentes(asignatura, documento).then(setFuentes).catch(() => {});
    // El índice puede tardar unos segundos en PDFs grandes
    api
      .indiceFuentes(asignatura, documento)
      .then((l) => setIndice(Object.fromEntries(l.map((x) => [x.archivo, x]))))
      .catch(() => {});
  }, [asignatura, documento]);
  useEffect(cargar, [cargar, version]);

  const subir = async (archivos: File[]) => {
    if (!archivos.length) return;
    setSubiendo(true);
    try {
      const r = await api.subirFuentes(asignatura, archivos, documento);
      avisar(r.guardados.length === 1 ? 'Archivo añadido' : `${r.guardados.length} archivos añadidos`, 'ok');
      cargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  const eliminar = async (f: Fuente) => {
    if (!(await confirmar(`¿Eliminar «${f.nombre}»?`, { boton: 'Eliminar', peligro: true }))) return;
    await api.eliminarFuente(asignatura, f.nombre, documento).catch((e) => avisar(e.message, 'error'));
    cargar();
  };

  const base = documento ? [asignatura, 'documentos', documento, 'fuentes'] : [asignatura, 'fuentes'];

  return (
    <div className="space-y-4">
      <p className="text-sm text-texto-2">{descripcion}</p>
      <div
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
        onClick={() => input.current?.click()}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          arrastrando ? 'border-acento bg-acento-suave' : 'border-borde hover:border-acento/60',
        )}
      >
        <Upload className={cx('size-6', arrastrando ? 'text-acento' : 'text-texto-3')} />
        <div className="text-sm font-medium">{subiendo ? 'Subiendo…' : 'Arrastra aquí apuntes, PDF, diapositivas o imágenes'}</div>
        <div className="text-xs text-texto-3">o haz clic para elegir archivos</div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            subir([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      <BuscadorFuentes asignatura={asignatura} documento={documento} onAnadida={cargar} />

      {Object.values(indice).some((x) => x.estado === 'indexado') && <BuscadorIndice asignatura={asignatura} documento={documento} />}

      {fuentes.length > 6 && (
        <Entrada value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder={`Filtrar ${fuentes.length} fuentes…`} />
      )}
      {fuentes.length > 0 && (
        <div className="divide-y divide-borde rounded-xl border border-borde bg-panel">
          {fuentes.filter((f) => f.nombre.toLowerCase().includes(filtro.trim().toLowerCase())).map((f) => (
            <div key={f.nombre} className="group flex items-center gap-3 px-4 py-2.5">
              <IconoArchivo nombre={f.nombre} />
              <a href={urlDatos(...base, f.nombre)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:text-acento">
                {f.nombre}
              </a>
              {indice[f.nombre] && (
                <span
                  className={cx('text-[11px]', indice[f.nombre].estado === 'indexado' ? 'text-ok' : 'text-texto-3')}
                  title={
                    indice[f.nombre].estado === 'indexado'
                      ? 'Los agentes pueden buscar en este archivo sin leerlo entero'
                      : indice[f.nombre].estado === 'sin-texto'
                        ? 'No tiene texto extraíble (¿PDF escaneado?): los agentes tendrán que leerlo directamente'
                        : 'Los agentes lo leen directamente (imágenes y otros formatos)'
                  }
                >
                  {indice[f.nombre].estado === 'indexado'
                    ? `${indice[f.nombre].paginas ? `${indice[f.nombre].paginas} págs. · ` : ''}indexado`
                    : indice[f.nombre].estado === 'sin-texto'
                      ? 'sin texto'
                      : 'sin indexar'}
                </span>
              )}
              <span className="text-xs text-texto-3">{tamano(f.tamano)}</span>
              <BotonIcono titulo="Eliminar" className="opacity-0 group-hover:opacity-100" onClick={() => eliminar(f)}>
                <Trash2 className="size-3.5" />
              </BotonIcono>
            </div>
          ))}
        </div>
      )}
      <Boton tam="sm" variante="fantasma" icono={<FolderOpen className="size-3.5" />} onClick={() => api.abrirCarpeta(asignatura, documento, 'fuentes')}>
        Abrir carpeta
      </Boton>
    </div>
  );
}
