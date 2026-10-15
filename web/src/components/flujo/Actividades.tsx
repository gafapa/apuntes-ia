import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ClipboardCheck, Download, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { EstadoFlujo, Trabajo } from '../../../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../../../shared/tipos';
import {
  DIFICULTADES,
  bloqueAMarkdown,
  maximoTipo,
  resumenTipos,
  tiposDe,
  type BloqueActividad,
  type Dificultad,
  type OpcionesActividad,
  type TipoActividad,
} from '../../../../shared/actividades';
import { api, urlDatos } from '../../lib/api';
import { useCampos } from '../../lib/estado';
import { AreaTexto, Boton, Entrada, Insignia, Modal, confirmar, cx } from '../ui';
import { VistaPrevia } from '../VistaPrevia';
import { SelectorTipos } from '../SelectorTipos';
import { ActividadAgente, Paso } from './comun';

/**
 * Autoevaluación en bloques: cada bloque (un tipo de actividad, una cantidad, una dificultad y unas
 * secciones) se genera por separado, se marca para incluirlo o no en los apuntes y se exporta a Moodle por separado.
 */
export function PasoActividades({ a, d, estado, trabajos }: { a: string; d: string; estado: EstadoFlujo; trabajos: Trabajo[] }) {
  const { avisar } = useCampos('avisar');
  const bloques = estado.actividades ?? [];
  const [modal, setModal] = useState<{ bloque?: BloqueActividad } | undefined>();
  const [abierto, setAbierto] = useState<string>();
  const incluidos = bloques.filter((b) => b.incluir && b.estado === 'lista');
  const generando = bloques.some((b) => b.estado === 'generando');
  const secciones = estado.secciones.filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo) && s.palabras > 40);
  const trabajoDe = (id: string) => trabajos.find((t) => t.ref === id && t.paso === 'autoevaluacion' && (t.estado === 'ejecutando' || t.estado === 'en-cola'));

  const moodle = async (id: string) => {
    try {
      const r = await api.exportarMoodle(a, d, id);
      avisar(`Exportada para Moodle: ${r.nombre}. En Moodle: Banco de preguntas › Importar › Formato GIFT.`, 'ok');
      await api.abrirCarpeta(a, d, 'exportados');
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  return (
    <Paso
      numero={6}
      titulo="Autoevaluación"
      opcional
      hecho={incluidos.length > 0 && !generando}
      trabajando={generando}
      descripcion="Bloques de actividades que generas uno a uno: eliges el tipo, la cantidad, la dificultad y las secciones. Marca los que quieras incluir en los apuntes."
      acciones={
        <>
          <Boton variante="primario" icono={<Plus className="size-4" />} disabled={!secciones.length} onClick={() => setModal({})}>
            Nuevo bloque
          </Boton>
        </>
      }
    >
      {!bloques.length ? (
        <p className="text-[13px] text-texto-3">
          {secciones.length ? 'Aún no hay bloques. Pulsa «Nuevo bloque» y elige qué actividades quieres.' : 'Redacta primero alguna sección para poder preparar actividades sobre ella.'}
        </p>
      ) : (
        <div className="space-y-2">
          {bloques.map((b) => {
            const t = trabajoDe(b.id);
            const esteAbierto = abierto === b.id;
            return (
              <div key={b.id} className={cx('rounded-lg border', b.incluir && b.estado === 'lista' ? 'border-acento/40' : 'border-borde')}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--acento)] cursor-pointer"
                    title="Incluir en los apuntes"
                    checked={b.incluir}
                    disabled={b.estado !== 'lista'}
                    onChange={(e) => api.editarActividad(a, d, b.id, { incluir: e.target.checked }).catch((err) => avisar(err.message, 'error'))}
                  />
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer" onClick={() => setAbierto(esteAbierto ? undefined : b.id)} disabled={b.estado !== 'lista'}>
                    <ChevronDown className={cx('size-3.5 shrink-0 text-texto-3 transition-transform', esteAbierto && 'rotate-180', b.estado !== 'lista' && 'opacity-0')} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{b.titulo}</span>
                      <span className="block text-[12px] text-texto-3">
                        {resumenTipos(b.opciones)} ·{' '}
                        {DIFICULTADES.find((x) => x.id === b.opciones.dificultad)?.nombre.toLowerCase()} ·{' '}
                        {b.opciones.secciones.length ? `${b.opciones.secciones.length} secciones` : 'todo el documento'}
                        {b.opciones.soluciones ? ' · con soluciones' : ''}
                      </span>
                    </span>
                  </button>
                  {b.estado === 'generando' && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-acento-texto">
                      <Loader2 className="size-3.5 animate-spin" /> {t?.estado === 'en-cola' ? 'En cola…' : 'Generando…'}
                    </span>
                  )}
                  {b.estado === 'lista' && !b.incluir && <Insignia>no se incluye</Insignia>}
                  {b.estado === 'lista' && (
                    <Boton
                      tam="sm"
                      variante="fantasma"
                      icono={<Download className="size-3.5" />}
                      onClick={() => moodle(b.id)}
                      title="Archivo GIFT de este bloque, para el banco de preguntas de Moodle (Aules, EducaMadrid…)"
                    >
                      Moodle
                    </Boton>
                  )}
                  <Boton tam="sm" variante="fantasma" icono={<RotateCcw className="size-3.5" />} disabled={b.estado === 'generando'} onClick={() => setModal({ bloque: b })}>
                    Rehacer
                  </Boton>
                  <button
                    className="rounded p-1 text-texto-3 hover:text-error cursor-pointer disabled:opacity-40"
                    title="Eliminar el bloque"
                    disabled={b.estado === 'generando'}
                    onClick={async () => {
                      if (await confirmar(`¿Eliminar «${b.titulo}»?`, { boton: 'Eliminar', peligro: true })) api.eliminarActividad(a, d, b.id).catch((e) => avisar(e.message, 'error'));
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {b.estado === 'error' && (
                  <p className="flex items-start gap-1.5 border-t border-borde px-3 py-2 text-[12px] text-error">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {b.error ?? 'No se pudo generar'}. Pulsa «Rehacer» para intentarlo de nuevo.
                  </p>
                )}
                {t && <div className="border-t border-borde px-3 py-2"><ActividadAgente t={t} /></div>}
                {esteAbierto && b.estado === 'lista' && (
                  <div className="border-t border-borde px-5 py-3">
                    <VistaPrevia texto={bloqueAMarkdown(b, 3)} base={urlDatos(a, 'documentos', d)} />
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[12px] text-texto-3">
            Al exportar, los bloques marcados van al final como «Autoevaluación» (si está marcada la opción «Incluir autoevaluación»). Sus soluciones siguen la opción de
            soluciones de la exportación.
          </p>
        </div>
      )}
      {modal && (
        <ModalBloque
          a={a}
          d={d}
          bloque={modal.bloque}
          secciones={secciones.map((s) => ({ archivo: s.archivo, titulo: s.titulo }))}
          onCerrar={() => setModal(undefined)}
        />
      )}
    </Paso>
  );
}

/** Modal para pedir un bloque (o rehacerlo): tipo, cantidad, dificultad, secciones y soluciones. */
function ModalBloque({
  a,
  d,
  bloque,
  secciones,
  onCerrar,
}: {
  a: string;
  d: string;
  bloque?: BloqueActividad;
  secciones: { archivo: string; titulo: string }[];
  onCerrar: () => void;
}) {
  const { avisar } = useCampos('avisar');
  const inicial = bloque?.opciones;
  // Cuántas preguntas de cada tipo: un mismo bloque puede mezclar varios
  const [cantidades, setCantidades] = useState<Partial<Record<TipoActividad, number>>>(() =>
    inicial ? Object.fromEntries(tiposDe(inicial)) : { test: 8 },
  );
  const [dificultad, setDificultad] = useState<Dificultad>(inicial?.dificultad ?? 'media');
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(inicial?.secciones ?? []));
  const [soluciones, setSoluciones] = useState(inicial?.soluciones ?? true);
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '');
  const [indicaciones, setIndicaciones] = useState(inicial?.indicaciones ?? '');
  const [enviando, setEnviando] = useState(false);
  const todas = elegidas.size === 0;
  const total = useMemo(() => Object.values(cantidades).reduce((a, n) => a + (n ?? 0), 0), [cantidades]);

  const enviar = async () => {
    setEnviando(true);
    const op: Partial<OpcionesActividad> = {
      tipos: cantidades,
      dificultad,
      secciones: [...elegidas],
      soluciones,
      titulo: titulo.trim() || undefined,
      indicaciones: indicaciones.trim() || undefined,
    };
    try {
      await (bloque ? api.rehacerActividad(a, d, bloque.id, op) : api.generarActividad(a, d, op));
      onCerrar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal abierto onCerrar={onCerrar} titulo={bloque ? `Rehacer «${bloque.titulo}»` : 'Nuevo bloque de actividades'} descripcion="Elige cómo quieres el bloque. Se genera por separado y luego decides si lo incluyes en los apuntes." ancho="max-w-2xl">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline gap-2 text-[12.5px] font-medium text-texto-2">
            Tipos de actividad <span className="font-normal text-texto-3">(puedes mezclar varios en el mismo bloque · {total} preguntas)</span>
          </div>
          <SelectorTipos valor={cantidades} onCambio={setCantidades} maximo={maximoTipo} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[12.5px] font-medium text-texto-2">Dificultad</div>
            <div className="mt-1.5 flex flex-wrap gap-0.5 rounded-lg bg-panel-2 p-0.5">
              {DIFICULTADES.map((x) => (
                <button
                  key={x.id}
                  onClick={() => setDificultad(x.id)}
                  className={cx('rounded-md px-2 py-1 text-[12px] cursor-pointer', dificultad === x.id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto')}
                >
                  {x.nombre}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-[12.5px] font-medium text-texto-2">
            Sobre qué secciones
            <button className={cx('rounded px-1.5 text-[11.5px] font-normal cursor-pointer', todas ? 'bg-acento-suave text-acento-texto' : 'text-texto-3 hover:text-texto')} onClick={() => setElegidas(new Set())}>
              Todo el documento
            </button>
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-borde p-2">
            {secciones.map((s) => (
              <label key={s.archivo} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  className="accent-[var(--acento)]"
                  checked={todas || elegidas.has(s.archivo)}
                  onChange={(e) => {
                    const n = new Set(todas ? secciones.map((x) => x.archivo) : elegidas);
                    if (e.target.checked) n.add(s.archivo);
                    else n.delete(s.archivo);
                    setElegidas(n.size === secciones.length ? new Set() : n);
                  }}
                />
                <span className="truncate">{s.titulo}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12.5px] font-medium text-texto-2">
            Título del bloque (opcional)
            <Entrada className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Lo pone la IA si lo dejas vacío" />
          </label>
          <label className="mt-6 flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-[var(--acento)]" checked={soluciones} onChange={(e) => setSoluciones(e.target.checked)} />
            Con las soluciones explicadas
          </label>
        </div>
        <label className="block text-[12.5px] font-medium text-texto-2">
          Indicaciones (opcional)
          <AreaTexto rows={2} className="mt-1 text-[13px]" value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Por ejemplo: estilo PAU, centradas en los cálculos, con casos del laboratorio…" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" icono={<ClipboardCheck className="size-4" />} cargando={enviando} disabled={!total || total > 40} onClick={enviar}>
            {bloque ? 'Rehacer el bloque' : 'Generar el bloque'}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}
