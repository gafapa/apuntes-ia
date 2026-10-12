import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, CheckCircle2, CircleDashed, CornerDownRight, FileSearch, ListTree, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { Apartado, EntradaIndice, EstadoFlujo, Indice, Profundidad, Trabajo } from '../../../../shared/tipos';
import { api, urlDatos } from '../../lib/api';
import { useEstado } from '../../lib/estado';
import { AreaTexto, Boton, BotonIcono, Entrada, Insignia, Modal, confirmar, cx } from '../ui';
import { VistaPrevia } from '../VistaPrevia';
import { ActividadAgente, BotonAgente, Paso, fechaCorta, trabajosDe } from './comun';

interface Props {
  a: string;
  d: string;
  estado: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
}

export function PasoInvestigacion({ a, d, estado, trabajos, recargar }: Props) {
  const activos = trabajosDe(trabajos, 'investigacion');
  const [verDossier, setVerDossier] = useState(false);
  const inv = estado.investigacion;
  const pendientes = estado.preguntas.filter((p) => p.estado === 'pendiente');
  return (
    <Paso
      numero={1}
      titulo="Investigación"
      opcional
      hecho={!!inv && pendientes.length === 0}
      trabajando={activos.length > 0}
      descripcion="El investigador lee el material aportado, busca en la web y prepara un dossier con conceptos, datos, ejemplos y fuentes. Puedes añadirle preguntas concretas en cualquier momento."
      acciones={
        <>
          {inv && (
            <Boton icono={<BookOpen className="size-4" />} onClick={() => setVerDossier(true)}>
              Ver dossier
            </Boton>
          )}
          {inv && pendientes.length > 0 ? (
            <BotonAgente
              texto={`Investigar ${pendientes.length === 1 ? '1 pregunta' : `${pendientes.length} preguntas`}`}
              icono={<FileSearch className="size-4" />}
              disabled={activos.length > 0}
              onLanzar={(ind) => api.investigar(a, d, ind, true)}
              estimacion={[['investigador', 1]]}
              ayudaIndicaciones="Por ejemplo: busca datos recientes, usa fuentes oficiales…"
            />
          ) : (
            <BotonAgente
              texto={inv ? 'Ampliar' : 'Investigar'}
              variante={inv ? 'secundario' : 'primario'}
              icono={<FileSearch className="size-4" />}
              disabled={activos.length > 0}
              onLanzar={(ind) => api.investigar(a, d, ind)}
              estimacion={[['investigador', 1]]}
              ayudaIndicaciones="Por ejemplo: céntrate en el temario de la PAU, usa fuentes en español, incluye ejemplos de la vida cotidiana…"
            />
          )}
        </>
      }
    >
      <div className="space-y-4">
        {activos.map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}
        {inv && (
          <p className="text-[13px] text-texto-2">
            Dossier de {inv.palabras.toLocaleString('es')} palabras · actualizado {fechaCorta(inv.actualizado)}
          </p>
        )}
        <Preguntas a={a} d={d} estado={estado} recargar={recargar} hayDossier={!!inv} />
      </div>
      <ModalDossier a={a} d={d} abierto={verDossier} onCerrar={() => setVerDossier(false)} />
    </Paso>
  );
}

/** Preguntas concretas que el usuario quiere que responda la investigación. */
function Preguntas({ a, d, estado, recargar, hayDossier }: { a: string; d: string; estado: EstadoFlujo; recargar: () => void; hayDossier: boolean }) {
  const { avisar } = useEstado();
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  const anadir = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.anadirPregunta(a, d, texto);
      setTexto('');
      recargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold">Preguntas de investigación</span>
        <span className="text-[12px] text-texto-3">
          {hayDossier ? 'Las pendientes se investigan con el botón de arriba' : 'Se responderán al investigar'}
        </span>
      </div>
      {estado.preguntas.length > 0 && (
        <ul className="mb-2 divide-y divide-borde rounded-lg border border-borde">
          {estado.preguntas.map((p) => {
            const desplegada = abierta === p.id && p.respuesta;
            return (
              <li key={p.id} className="group">
                <div className="flex items-start gap-2.5 px-3 py-2">
                  <span className="mt-1">
                    {p.estado === 'investigando' ? (
                      <Loader2 className="size-3.5 animate-spin text-acento-texto" />
                    ) : p.estado === 'respondida' ? (
                      <CheckCircle2 className="size-3.5 text-ok" />
                    ) : (
                      <CircleDashed className="size-3.5 text-texto-3" />
                    )}
                  </span>
                  <button
                    disabled={!p.respuesta}
                    onClick={() => setAbierta(desplegada ? undefined : p.id)}
                    className="min-w-0 flex-1 text-left text-[13.5px] enabled:cursor-pointer enabled:hover:text-acento-texto"
                  >
                    {p.texto}
                    <span className="block text-[11.5px] text-texto-3">
                      {p.estado === 'investigando' ? 'Investigando…' : p.respuesta ? (desplegada ? 'Ocultar respuesta' : 'Ver respuesta') : 'Pendiente'}
                    </span>
                  </button>
                  {p.estado !== 'investigando' && (
                    <BotonIcono
                      titulo="Quitar pregunta"
                      className="opacity-0 group-hover:opacity-100 hover:text-error"
                      onClick={() => api.eliminarPregunta(a, d, p.id).then(recargar)}
                    >
                      <Trash2 className="size-3.5" />
                    </BotonIcono>
                  )}
                </div>
                {desplegada && (
                  <div className="border-t border-borde bg-fondo/50 px-9 py-3">
                    <VistaPrevia texto={p.respuesta!} base={urlDatos(a, 'documentos', d)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && anadir()}
          placeholder="¿Qué papel tiene la fotosíntesis en el cambio climático?"
        />
        <Boton icono={<Plus className="size-4" />} cargando={enviando} disabled={!texto.trim()} onClick={anadir}>
          Añadir
        </Boton>
      </div>
    </div>
  );
}

function ModalDossier({ a, d, abierto, onCerrar }: { a: string; d: string; abierto: boolean; onCerrar: () => void }) {
  const { avisar } = useEstado();
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (abierto) {
      setEditando(false);
      api.leerArchivo(a, d, 'investigacion.md').then((r) => setTexto(r.contenido));
    }
  }, [abierto, a, d]);
  const guardar = async () => {
    await api.guardarArchivo(a, d, 'investigacion.md', texto).catch((e) => avisar(e.message, 'error'));
    setEditando(false);
    avisar('Dossier guardado', 'ok');
  };
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Dossier de investigación" ancho="max-w-4xl">
      <div className="mb-3 flex justify-end gap-2">
        {editando ? (
          <Boton variante="primario" icono={<Save className="size-4" />} onClick={guardar}>
            Guardar
          </Boton>
        ) : (
          <Boton icono={<Pencil className="size-4" />} onClick={() => setEditando(true)}>
            Editar
          </Boton>
        )}
      </div>
      <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-borde px-6 py-5">
        {editando ? (
          <AreaTexto className="min-h-[55vh] border-0 font-mono text-[13px] focus:ring-0" value={texto} onChange={(e) => setTexto(e.target.value)} />
        ) : (
          <VistaPrevia texto={texto} base={urlDatos(a, 'documentos', d)} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const nuevoId = () => Math.random().toString(36).slice(2, 10);

const ENTRADA_VACIA = (): EntradaIndice => ({
  id: nuevoId(),
  titulo: '',
  objetivo: '',
  contenidos: [],
  apartados: [],
  extension: '',
  visuales: '',
});

const PROFUNDIDADES: { valor: Profundidad; nombre: string; ayuda: string }[] = [
  { valor: 1, nombre: 'Secciones', ayuda: 'Solo las secciones; cada redactor organiza sus apartados' },
  { valor: 2, nombre: '+ Apartados', ayuda: 'Secciones con sus apartados (1.1, 1.2…)' },
  { valor: 3, nombre: '+ Subapartados', ayuda: 'Secciones, apartados y subapartados (1.1.1…)' },
];

/** Índices guardados antes de existir la profundidad: se completan con valores por defecto. */
function normalizar(i?: Indice): Indice | undefined {
  if (!i) return i;
  return { ...i, profundidad: i.profundidad ?? 1, entradas: i.entradas.map((e) => ({ ...e, apartados: e.apartados ?? [] })) };
}

/** Profundidad real del contenido del índice (para avisar si al bajarla se pierden apartados). */
function profundidadUsada(entradas: EntradaIndice[]): number {
  const prof = (l: Apartado[]): number => (l.length ? 1 + Math.max(...l.map((a) => prof(a.apartados))) : 0);
  return 1 + Math.max(0, ...entradas.map((e) => prof(e.apartados)));
}

function recortar(l: Apartado[], niveles: number): Apartado[] {
  return niveles <= 0 ? [] : l.map((a) => ({ ...a, apartados: recortar(a.apartados, niveles - 1) }));
}

export function PasoIndice({ a, d, estado, trabajos, recargar }: Props) {
  const { avisar } = useEstado();
  const activos = trabajosDe(trabajos, 'indice');
  const [indice, setIndice] = useState<Indice | undefined>(normalizar(estado.indice));
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [abierta, setAbierta] = useState<string>();
  const [profundidadNueva, setProfundidadNueva] = useState<Profundidad>(() => normalizar(estado.indice)?.profundidad ?? 2);

  // Si el índice cambia en disco (p. ej. lo reescribe el agente) y no hay cambios locales, se actualiza
  useEffect(() => {
    if (!sucio) {
      setIndice(normalizar(estado.indice));
      if (estado.indice) setProfundidadNueva(normalizar(estado.indice)!.profundidad);
    }
  }, [estado.indice, sucio]);

  const profundidad = indice?.profundidad ?? profundidadNueva;

  const cambiar = (entradas: EntradaIndice[], extra: Partial<Indice> = {}) => {
    setIndice({ ...(indice ?? { notas: '', aprobado: false, actualizado: '', profundidad: profundidadNueva }), entradas, aprobado: false, ...extra });
    setSucio(true);
  };
  const editar = (id: string, cambios: Partial<EntradaIndice>) => cambiar(indice!.entradas.map((e) => (e.id === id ? { ...e, ...cambios } : e)));
  const mover = (i: number, delta: number) => {
    const l = [...indice!.entradas];
    const j = i + delta;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    cambiar(l);
  };

  const elegirProfundidad = async (p: Profundidad) => {
    setProfundidadNueva(p);
    if (!indice) return;
    if (p < profundidadUsada(indice.entradas)) {
      const ok = await confirmar('¿Reducir la profundidad del índice?', {
        texto: p === 1 ? 'Se quitarán todos los apartados del índice.' : 'Se quitarán los subapartados del índice.',
        boton: 'Reducir',
        peligro: true,
      });
      if (!ok) return setProfundidadNueva(indice.profundidad);
    }
    cambiar(
      indice.entradas.map((e) => ({ ...e, apartados: recortar(e.apartados, p - 1) })),
      { profundidad: p },
    );
  };

  const guardar = async () => {
    if (!indice) return;
    setGuardando(true);
    try {
      setIndice(normalizar(await api.guardarIndice(a, d, indice)));
      setSucio(false);
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const aprobar = async () => {
    setGuardando(true);
    try {
      if (sucio && indice) await api.guardarIndice(a, d, indice);
      setIndice(normalizar(await api.aprobarIndice(a, d)));
      setSucio(false);
      avisar('Índice aprobado: secciones creadas', 'ok');
      recargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  /** Antes de pedir algo a la IA, se guardan los cambios locales para que los tenga en cuenta. */
  const conCambiosGuardados = async (fn: () => Promise<unknown>) => {
    if (sucio && indice) {
      await api.guardarIndice(a, d, indice);
      setSucio(false);
    }
    return fn();
  };

  const entradas = indice?.entradas ?? [];
  const faltanApartados = !!indice && profundidad > profundidadUsada(entradas);

  return (
    <Paso
      numero={2}
      titulo="Índice director"
      hecho={!!indice?.aprobado && !sucio}
      trabajando={activos.length > 0}
      descripcion="El arquitecto propone las secciones con su objetivo, contenidos, extensión y, si quieres, sus apartados y subapartados. Revísalo, edítalo y apruébalo para crear las secciones."
      acciones={
        <BotonAgente
          texto={indice ? 'Rehacer con IA' : 'Proponer índice'}
          variante={indice ? 'secundario' : 'primario'}
          icono={<ListTree className="size-4" />}
          disabled={activos.length > 0}
          onLanzar={(ind) => conCambiosGuardados(() => api.proponerIndice(a, d, ind, profundidad))}
          estimacion={[['arquitecto', 1]]}
          ayudaIndicaciones="Por ejemplo: 6 secciones como máximo, empieza por un caso práctico, añade una sección de historia…"
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium">Profundidad</span>
          <div className="flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
            {PROFUNDIDADES.map((p) => (
              <button
                key={p.valor}
                title={p.ayuda}
                disabled={activos.length > 0}
                onClick={() => elegirProfundidad(p.valor)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed',
                  profundidad === p.valor ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                )}
              >
                {p.nombre}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-texto-3">{PROFUNDIDADES.find((p) => p.valor === profundidad)!.ayuda}</span>
        </div>
        {faltanApartados && activos.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-acento/30 bg-acento-suave/50 px-3 py-2 text-[13px]">
            <span className="flex-1">
              El índice aún no tiene {profundidad === 2 ? 'apartados' : 'subapartados'}. Puedes añadirlos a mano o pedírselos a la IA sin cambiar las secciones.
            </span>
            <BotonAgente
              texto="Desarrollar con IA"
              variante="secundario"
              icono={<ListTree className="size-4" />}
              onLanzar={(ind) => conCambiosGuardados(() => api.proponerIndice(a, d, ind, profundidad, true))}
            />
          </div>
        )}

        {activos.map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}
        {indice?.notas && <p className="rounded-lg bg-panel-2 px-3 py-2 text-[13px] text-texto-2">{indice.notas}</p>}

        {entradas.length > 0 && (
          <ol className="space-y-2">
            {entradas.map((e, i) => {
              const abiertaEsta = abierta === e.id;
              return (
                <li key={e.id} className={cx('rounded-lg border bg-fondo/50', abiertaEsta ? 'border-acento/40' : 'border-borde')}>
                  <div className="group flex items-center gap-2 px-3 py-2">
                    <span className="w-5 text-right text-[12px] tabular-nums text-texto-3">{i + 1}</span>
                    <input
                      value={e.titulo}
                      onChange={(ev) => editar(e.id, { titulo: ev.target.value })}
                      placeholder="Título de la sección"
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                    />
                    {e.archivo && <Insignia color="ok">creada</Insignia>}
                    {e.extension && !abiertaEsta && <span className="hidden text-[11.5px] text-texto-3 sm:inline">{e.extension}</span>}
                    <div className="flex items-center opacity-60 group-hover:opacity-100">
                      <BotonIcono titulo="Detalles" onClick={() => setAbierta(abiertaEsta ? undefined : e.id)}>
                        <Pencil className="size-3.5" />
                      </BotonIcono>
                      <BotonIcono titulo="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                        <ArrowUp className="size-3.5" />
                      </BotonIcono>
                      <BotonIcono titulo="Bajar" disabled={i === entradas.length - 1} onClick={() => mover(i, 1)}>
                        <ArrowDown className="size-3.5" />
                      </BotonIcono>
                      <BotonIcono titulo="Quitar" className="hover:text-error" onClick={() => cambiar(entradas.filter((x) => x.id !== e.id))}>
                        <Trash2 className="size-3.5" />
                      </BotonIcono>
                    </div>
                  </div>
                  {!abiertaEsta && e.objetivo && <p className="-mt-1 px-10 pb-2 text-[12.5px] text-texto-2">{e.objetivo}</p>}
                  {profundidad > 1 && (
                    <div className="px-10 pb-2.5">
                      <ArbolApartados
                        lista={e.apartados}
                        prefijo={`${i + 1}`}
                        niveles={profundidad - 1}
                        onCambio={(apartados) => editar(e.id, { apartados })}
                      />
                    </div>
                  )}
                  {abiertaEsta && (
                    <div className="grid gap-2 border-t border-borde px-10 py-3">
                      <label className="text-[12px] text-texto-3">
                        Objetivo
                        <AreaTexto rows={2} className="mt-1 text-[13px]" value={e.objetivo} onChange={(ev) => editar(e.id, { objetivo: ev.target.value })} />
                      </label>
                      <label className="text-[12px] text-texto-3">
                        Contenidos (uno por línea)
                        <AreaTexto
                          rows={4}
                          className="mt-1 text-[13px]"
                          value={e.contenidos.join('\n')}
                          onChange={(ev) => editar(e.id, { contenidos: ev.target.value.split('\n') })}
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[12px] text-texto-3">
                          Extensión
                          <Entrada className="mt-1 h-8 text-[13px]" value={e.extension} onChange={(ev) => editar(e.id, { extension: ev.target.value })} />
                        </label>
                        <label className="text-[12px] text-texto-3">
                          Apoyos visuales
                          <Entrada className="mt-1 h-8 text-[13px]" value={e.visuales} onChange={(ev) => editar(e.id, { visuales: ev.target.value })} />
                        </label>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Boton
            tam="sm"
            variante="fantasma"
            icono={<Plus className="size-3.5" />}
            onClick={() => {
              const nueva = ENTRADA_VACIA();
              cambiar([...entradas, nueva]);
              setAbierta(nueva.id);
            }}
          >
            Añadir sección
          </Boton>
          <div className="ml-auto flex gap-2">
            {sucio && (
              <>
                <Boton tam="sm" variante="fantasma" onClick={() => (setIndice(normalizar(estado.indice)), setSucio(false))}>
                  Descartar
                </Boton>
                <Boton tam="sm" cargando={guardando} onClick={guardar}>
                  Guardar
                </Boton>
              </>
            )}
            {entradas.length > 0 && (!indice?.aprobado || sucio) && (
              <Boton tam="sm" variante="primario" icono={<Check className="size-3.5" />} cargando={guardando} onClick={aprobar}>
                Aprobar y crear secciones
              </Boton>
            )}
          </div>
        </div>
        {!indice && activos.length === 0 && (
          <p className="text-[13px] text-texto-3">
            Elige la profundidad y pide una propuesta a la IA, o añade tú las secciones. Si el documento ya tiene secciones, el índice se puede saltar.
          </p>
        )}
      </div>
    </Paso>
  );
}

/** Lista editable de apartados (y, si caben, sus subapartados). */
function ArbolApartados({
  lista,
  prefijo,
  niveles,
  onCambio,
}: {
  lista: Apartado[];
  prefijo: string;
  niveles: number; // cuántos niveles quedan por debajo de la sección
  onCambio: (l: Apartado[]) => void;
}) {
  const cambiarUno = (id: string, c: Partial<Apartado>) => onCambio(lista.map((x) => (x.id === id ? { ...x, ...c } : x)));
  const mover = (i: number, delta: number) => {
    const l = [...lista];
    const j = i + delta;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    onCambio(l);
  };
  const esSub = prefijo.includes('.');
  return (
    <div className={cx(esSub && 'ml-6 border-l border-borde pl-2')}>
      {lista.map((ap, i) => (
        <div key={ap.id}>
          <div className="group flex items-center gap-2 py-0.5">
            <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-texto-3">
              {prefijo}.{i + 1}
            </span>
            <input
              value={ap.titulo}
              onChange={(e) => cambiarUno(ap.id, { titulo: e.target.value })}
              placeholder={esSub ? 'Subapartado' : 'Apartado'}
              className={cx('min-w-0 flex-1 bg-transparent outline-none', esSub ? 'text-[12.5px] text-texto-2' : 'text-[13px]')}
            />
            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              {niveles > 1 && (
                <BotonIcono
                  titulo="Añadir subapartado"
                  className="size-6"
                  onClick={() => cambiarUno(ap.id, { apartados: [...ap.apartados, { id: nuevoId(), titulo: '', apartados: [] }] })}
                >
                  <CornerDownRight className="size-3" />
                </BotonIcono>
              )}
              <BotonIcono titulo="Subir" className="size-6" disabled={i === 0} onClick={() => mover(i, -1)}>
                <ArrowUp className="size-3" />
              </BotonIcono>
              <BotonIcono titulo="Bajar" className="size-6" disabled={i === lista.length - 1} onClick={() => mover(i, 1)}>
                <ArrowDown className="size-3" />
              </BotonIcono>
              <BotonIcono titulo="Quitar" className="size-6 hover:text-error" onClick={() => onCambio(lista.filter((x) => x.id !== ap.id))}>
                <Trash2 className="size-3" />
              </BotonIcono>
            </div>
          </div>
          {niveles > 1 && ap.apartados.length > 0 && (
            <ArbolApartados lista={ap.apartados} prefijo={`${prefijo}.${i + 1}`} niveles={niveles - 1} onCambio={(sub) => cambiarUno(ap.id, { apartados: sub })} />
          )}
        </div>
      ))}
      <button
        onClick={() => onCambio([...lista, { id: nuevoId(), titulo: '', apartados: [] }])}
        className={cx('flex items-center gap-1 py-0.5 text-[12px] text-texto-3 hover:text-acento-texto cursor-pointer', esSub ? 'ml-11' : 'ml-11')}
      >
        <Plus className="size-3" /> {esSub ? 'Subapartado' : 'Apartado'}
      </button>
    </div>
  );
}
