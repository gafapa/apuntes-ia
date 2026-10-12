import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import type { VersionSeccion } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { diferenciasLineas, type Linea } from '../lib/diff';
import { Boton, Modal, Vacio, confirmar, cx } from './ui';

const fecha = (iso: string) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Versiones anteriores de una sección (y el texto original, si se importó): se comparan con el
 * texto actual y se pueden restaurar. Restaurar guarda antes la versión actual, así que se puede
 * deshacer.
 */
export function HistorialSeccion({
  a,
  d,
  archivo,
  titulo,
  actual,
  abierto,
  onCerrar,
}: {
  a: string;
  d: string;
  archivo: string;
  titulo: string;
  actual: string;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const { avisar } = useCampos('avisar');
  const [versiones, setVersiones] = useState<VersionSeccion[]>();
  const [elegida, setElegida] = useState<string>();
  const [texto, setTexto] = useState<string>();
  const [soloCambios, setSoloCambios] = useState(true);
  const [restaurando, setRestaurando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setVersiones(undefined);
    setTexto(undefined);
    api
      .historial(a, d, archivo)
      .then((v) => {
        setVersiones(v);
        setElegida(v.find((x) => x.id === 'original')?.id ?? v[0]?.id);
      })
      .catch((e) => avisar(e.message, 'error'));
  }, [abierto, a, d, archivo, avisar]);

  useEffect(() => {
    if (!elegida) return;
    setTexto(undefined);
    api
      .versionSeccion(a, d, archivo, elegida)
      .then((r) => setTexto(r.contenido))
      .catch((e) => avisar(e.message, 'error'));
  }, [elegida, a, d, archivo, avisar]);

  const lineas = useMemo(() => (texto === undefined ? [] : diferenciasLineas(texto, actual)), [texto, actual]);
  const cambios = lineas.filter((l) => l.tipo !== 'igual').length;

  const restaurar = async () => {
    if (!elegida) return;
    const ok = await confirmar('¿Restaurar esta versión?', {
      texto: 'La sección vuelve a como estaba en esta versión. El texto actual se guarda en el historial, así que podrás recuperarlo.',
      boton: 'Restaurar',
    });
    if (!ok) return;
    setRestaurando(true);
    try {
      await api.restaurarVersion(a, d, archivo, elegida);
      avisar('Versión restaurada', 'ok');
      onCerrar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setRestaurando(false);
    }
  };

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} ancho="max-w-5xl" titulo={`Historial de «${titulo}»`} descripcion="Compara una versión anterior con el texto actual y, si quieres, restáurala.">
      {!versiones ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-texto-3" />
        </div>
      ) : !versiones.length ? (
        <Vacio
          icono={<History className="size-6" />}
          titulo="Sin versiones anteriores"
          texto="Cada vez que un agente, una sugerencia aceptada o tú cambiáis esta sección, se guarda cómo estaba antes."
        />
      ) : (
        <div className="flex min-h-0 gap-4" style={{ height: 'min(62vh, 640px)' }}>
          <ul className="w-56 shrink-0 space-y-1 overflow-y-auto">
            {versiones.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setElegida(v.id)}
                  className={cx(
                    'w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors cursor-pointer',
                    elegida === v.id ? 'bg-acento-suave text-acento-texto' : 'hover:bg-panel-2',
                  )}
                >
                  <div className="font-medium">{v.id === 'original' ? 'Original importado' : fecha(v.fecha)}</div>
                  <div className="text-[11.5px] text-texto-3">{v.palabras} palabras</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-borde">
            <div className="flex items-center gap-3 border-b border-borde px-3 py-2 text-[12.5px]">
              {texto === undefined ? (
                <Loader2 className="size-3.5 animate-spin text-texto-3" />
              ) : cambios ? (
                <span className="text-texto-2">
                  <span className="rounded bg-error/12 px-1 text-error">tachado</span> = estaba en esta versión ·{' '}
                  <span className="rounded bg-ok/15 px-1 text-ok">verde</span> = está ahora
                </span>
              ) : (
                <span className="text-texto-2">Igual que el texto actual</span>
              )}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-texto-2">
                <input type="checkbox" className="accent-[var(--acento)]" checked={soloCambios} onChange={(e) => setSoloCambios(e.target.checked)} />
                Solo los cambios
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed">
              <Comparacion lineas={lineas} soloCambios={soloCambios} />
            </div>
          </div>
        </div>
      )}
      {!!versiones?.length && (
        <div className="mt-4 flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cerrar</Boton>
          <Boton variante="primario" icono={<RotateCcw className="size-4" />} cargando={restaurando} disabled={!texto || !cambios} onClick={restaurar}>
            Restaurar esta versión
          </Boton>
        </div>
      )}
    </Modal>
  );
}

/** Líneas comparadas; con «solo los cambios», las iguales se resumen dejando dos de contexto. */
function Comparacion({ lineas, soloCambios }: { lineas: Linea[]; soloCambios: boolean }) {
  const CONTEXTO = 2;
  const visibles = lineas.map((l, i) => {
    if (!soloCambios || l.tipo !== 'igual') return true;
    for (let k = Math.max(0, i - CONTEXTO); k <= Math.min(lineas.length - 1, i + CONTEXTO); k++) if (lineas[k].tipo !== 'igual') return true;
    return false;
  });
  const res: React.ReactNode[] = [];
  lineas.forEach((l, i) => {
    if (!visibles[i]) {
      if (visibles[i - 1] !== false) res.push(<div key={`s${i}`} className="my-1 border-t border-dashed border-borde" />);
      return;
    }
    res.push(
      <div
        key={i}
        className={cx(
          'min-h-[1.4em] px-1.5 whitespace-pre-wrap',
          l.tipo === 'quitado' && 'bg-error/8 text-texto-2',
          l.tipo === 'puesto' && 'bg-ok/10',
        )}
      >
        {l.trozos
          ? l.trozos.map((t, k) =>
              t.tipo === 'igual' ? (
                <span key={k}>{t.texto}</span>
              ) : t.tipo === 'quitado' ? (
                <del key={k} className="rounded bg-error/20 text-error">
                  {t.texto}
                </del>
              ) : (
                <ins key={k} className="rounded bg-ok/25 text-ok no-underline">
                  {t.texto}
                </ins>
              ),
            )
          : l.tipo === 'quitado'
            ? <del className="decoration-error/50">{l.texto}</del>
            : l.texto}
      </div>,
    );
  });
  return <>{res}</>;
}
