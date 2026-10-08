import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  ChevronRight,
  Columns2,
  Download,
  Eye,
  FileText,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Documento, Seccion } from '../../../shared/tipos';
import { api, urlDatos } from '../lib/api';
import { useEstado } from '../lib/estado';
import { AreaTexto, Boton, BotonIcono, Campo, Entrada, Insignia, Vacio, confirmar, cx } from './ui';
import { Editor } from './Editor';
import { VistaPrevia } from './VistaPrevia';
import { GestorFuentes } from './GestorFuentes';
import { GaleriaRecursos } from './GaleriaRecursos';
import { VistaPaso } from './flujo/VistaFlujo';
import { PASOS, useFlujoActual, useVistaDocumento } from './flujo/pasos';

type Modo = 'editar' | 'dividido' | 'vista';
const TODO = '__todo__';

export function VistaDocumento({ asignatura, documento }: { asignatura: string; documento: string }) {
  const { asignaturas, seleccionar, avisar, cargarAsignaturas } = useEstado();
  const asig = asignaturas.find((a) => a.id === asignatura);
  const [doc, setDoc] = useState<Documento>();
  const flujo = useFlujoActual();
  const [vista, elegir] = useVistaDocumento();
  const irASeccion = useEstado((s) => s.irASeccion);

  // Desde el flujo se puede pedir abrir una sección concreta en el editor
  useEffect(() => {
    if (irASeccion) elegir('apuntes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irASeccion]);

  useEffect(() => {
    let cancelado = false;
    const cargar = (intento = 0) =>
      api
        .documento(asignatura, documento)
        .then((d) => !cancelado && setDoc(d))
        .catch((e) => {
          if (cancelado) return;
          if (e.status === 404) {
            avisar(e.message, 'error');
            seleccionar({ asignatura });
          } else if (intento < 20) {
            setTimeout(() => cargar(intento + 1), 1000); // el servidor puede estar reiniciándose
          }
        });
    cargar();
    return () => {
      cancelado = true;
    };
  }, [asignatura, documento, avisar, seleccionar]);

  if (!doc || !asig || !flujo) return null;
  const destinatarios = doc.destinatarios.trim() || asig.destinatarios;
  const paso = PASOS.find((p) => p.id === vista);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-borde bg-panel px-5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate font-semibold">{doc.titulo}</span>
          <ChevronRight className="size-3.5 shrink-0 text-texto-3" />
          <span className="shrink-0 text-texto-2">{paso?.titulo ?? { apuntes: 'Apuntes', recursos: 'Imágenes', material: 'Fuentes', ficha: 'Ficha' }[vista as string]}</span>
          {destinatarios && (
            <Insignia color={doc.destinatarios.trim() ? 'acento' : 'neutro'} className="ml-2 max-w-80 truncate">
              <span className="truncate" title={`Destinatarios${doc.destinatarios.trim() ? ' propios del documento' : ' de la asignatura'}: ${destinatarios}`}>
                Para: {destinatarios}
              </span>
            </Insignia>
          )}
        </div>
        {vista !== 'exportar' && (
          <Boton tam="sm" className="ml-auto" icono={<Download className="size-3.5" />} onClick={() => elegir('exportar')}>
            Exportar
          </Boton>
        )}
      </header>

      {paso && <VistaPaso id={paso.id} a={asignatura} d={documento} estado={flujo.estado} trabajos={flujo.trabajos} recargar={flujo.recargar} onIr={elegir} />}
      {vista === 'apuntes' && <Apuntes asignatura={asignatura} documento={documento} />}
      {vista === 'recursos' && <GaleriaRecursos a={asignatura} d={documento} />}
      {vista === 'ficha' && (
        <div className="flex-1 overflow-y-auto">
          <FichaDocumento
            doc={doc}
            destinatariosAsignatura={asig.destinatarios}
            onGuardado={(d) => {
              setDoc(d);
              cargarAsignaturas();
            }}
          />
        </div>
      )}
      {vista === 'material' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-8">
            <GestorFuentes
              asignatura={asignatura}
              documento={documento}
              descripcion="Fuentes de consulta de este documento (opcional): apuntes del profesor, diapositivas, artículos, imágenes… Los agentes las leen para investigar y redactar, pero no aparecen en los apuntes. Si no aportas nada, investigarán por su cuenta."
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Apuntes({ asignatura, documento }: { asignatura: string; documento: string }) {
  const { avisar, versiones } = useEstado();
  const version = versiones[`${asignatura}/${documento}`] ?? 0;
  const [secciones, setSecciones] = useState<Seccion[]>([]);
  const [activa, setActiva] = useState<string>();
  const [texto, setTexto] = useState('');
  const [estadoGuardado, setEstadoGuardado] = useState<'guardado' | 'pendiente' | 'guardando'>('guardado');
  const [conflicto, setConflicto] = useState<string>();
  const [modo, setModo] = useState<Modo>(() => (localStorage.getItem('modoEditor') as Modo) || 'dividido');
  const [completo, setCompleto] = useState('');
  const guardadoRef = useRef(''); // último contenido sincronizado con el disco
  const textoRef = useRef(texto);
  textoRef.current = texto;
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const base = urlDatos(asignatura, 'documentos', documento);

  const cargarSecciones = useCallback(async () => {
    const lista = await api.secciones(asignatura, documento);
    setSecciones(lista);
    return lista;
  }, [asignatura, documento]);

  // Carga inicial (o la sección pedida desde el flujo)
  useEffect(() => {
    cargarSecciones().then((l) => {
      const pedida = useEstado.getState().irASeccion;
      useEstado.setState({ irASeccion: undefined });
      setActiva(pedida && l.some((s) => s.archivo === pedida) ? pedida : l[0]?.archivo ?? TODO);
    });
  }, [cargarSecciones]);
  const irASeccion = useEstado((s) => s.irASeccion);
  useEffect(() => {
    if (!irASeccion) return;
    useEstado.setState({ irASeccion: undefined });
    cargarSecciones().then(() => setActiva(irASeccion));
  }, [irASeccion, cargarSecciones]);

  useEffect(() => {
    useEstado.setState({ seccionActiva: activa && activa !== TODO ? activa : undefined });
    return () => useEstado.setState({ seccionActiva: undefined });
  }, [activa]);

  // Cargar la sección activa
  useEffect(() => {
    setConflicto(undefined);
    if (!activa || activa === TODO) return;
    api
      .leerSeccion(asignatura, documento, activa)
      .then(({ contenido }) => {
        guardadoRef.current = contenido;
        setTexto(contenido);
        setEstadoGuardado('guardado');
      })
      .catch(() => setActiva(TODO));
  }, [asignatura, documento, activa]);

  // Documento completo
  useEffect(() => {
    if (activa !== TODO) return;
    Promise.all(secciones.map((s) => api.leerSeccion(asignatura, documento, s.archivo).then((r) => r.contenido))).then((t) =>
      setCompleto(t.join('\n\n')),
    );
  }, [activa, secciones, asignatura, documento]);

  // Cambios en disco (normalmente, un agente escribiendo)
  useEffect(() => {
    if (!version) return;
    cargarSecciones().then((lista) => {
      if (!activa || activa === TODO) return;
      if (!lista.some((s) => s.archivo === activa)) {
        setActiva(lista[0]?.archivo ?? TODO);
        return;
      }
      api.leerSeccion(asignatura, documento, activa).then(({ contenido }) => {
        if (contenido === guardadoRef.current) return;
        if (textoRef.current === guardadoRef.current) {
          guardadoRef.current = contenido;
          setTexto(contenido);
        } else {
          setConflicto(contenido); // hay cambios sin guardar: que decida el usuario
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const guardar = useCallback(
    async (contenido: string, archivo: string) => {
      setEstadoGuardado('guardando');
      // Reintentos: el servidor puede estar reiniciándose (p. ej. en el modo «app en vivo»)
      for (let intento = 0; ; intento++) {
        try {
          await api.guardarSeccion(asignatura, documento, archivo, contenido);
          guardadoRef.current = contenido;
          setEstadoGuardado('guardado');
          return;
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (intento < 10 && (status === undefined || status >= 500)) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          setEstadoGuardado('pendiente');
          avisar(`No se pudo guardar: ${(e as Error).message}`, 'error');
          return;
        }
      }
    },
    [asignatura, documento, avisar],
  );

  const alCambiar = (v: string) => {
    setTexto(v);
    setEstadoGuardado('pendiente');
    clearTimeout(temporizador.current);
    const archivo = activa!;
    temporizador.current = setTimeout(() => guardar(v, archivo), 700);
  };

  /** Guarda de inmediato lo pendiente (antes de cambiar de sección o renumerar archivos). */
  const vaciarPendiente = async () => {
    clearTimeout(temporizador.current);
    if (activa && activa !== TODO && texto !== guardadoRef.current) await guardar(texto, activa);
  };

  /** Tras renumerar, el archivo activo puede haber cambiado de prefijo: se busca por su nombre base. */
  const reubicar = (lista: Seccion[]) => {
    if (!activa || activa === TODO) return;
    const nombre = activa.replace(/^\d+-/, '');
    setActiva(lista.find((s) => s.archivo.replace(/^\d+-/, '') === nombre)?.archivo ?? lista[0]?.archivo ?? TODO);
  };

  const abrir = async (archivo: string) => {
    if (archivo === activa) return;
    await vaciarPendiente();
    setActiva(archivo);
  };

  const nuevaSeccion = async () => {
    const s = await api.crearSeccion(asignatura, documento, 'Nueva sección');
    await cargarSecciones();
    abrir(s.archivo);
  };

  const mover = async (i: number, delta: number) => {
    const orden = secciones.map((s) => s.archivo);
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    await vaciarPendiente();
    const nueva = await api.ordenarSecciones(asignatura, documento, orden);
    setSecciones(nueva);
    reubicar(nueva);
  };

  const eliminar = async (s: Seccion) => {
    if (!(await confirmar(`¿Eliminar la sección «${s.titulo}»?`, { texto: 'No se puede deshacer.', boton: 'Eliminar', peligro: true }))) return;
    await vaciarPendiente();
    await api.eliminarSeccion(asignatura, documento, s.archivo);
    const lista = await cargarSecciones();
    if (activa === s.archivo) setActiva(lista[0]?.archivo ?? TODO);
    else reubicar(lista);
  };

  const cambiarModo = (m: Modo) => {
    setModo(m);
    localStorage.setItem('modoEditor', m);
  };

  const total = secciones.reduce((n, s) => n + s.palabras, 0);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Índice de secciones */}
      <div className="flex w-60 shrink-0 flex-col border-r border-borde bg-panel/60">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Secciones</span>
          <BotonIcono titulo="Nueva sección" onClick={nuevaSeccion}>
            <Plus className="size-4" />
          </BotonIcono>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <button
            onClick={() => abrir(TODO)}
            className={cx(
              'mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] cursor-pointer',
              activa === TODO ? 'bg-acento-suave text-acento font-medium' : 'text-texto-2 hover:bg-panel-2',
            )}
          >
            <BookOpenText className="size-4" />
            Documento completo
          </button>
          {secciones.map((s, i) => (
            <div
              key={s.archivo}
              className={cx(
                'group flex items-center rounded-lg transition-colors',
                activa === s.archivo ? 'bg-acento-suave' : 'hover:bg-panel-2',
              )}
            >
              <button onClick={() => abrir(s.archivo)} className="flex min-w-0 flex-1 items-baseline gap-2 px-2.5 py-2 text-left cursor-pointer">
                <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-texto-3">{i + 1}</span>
                <span className="min-w-0">
                  <span className={cx('block truncate text-[13px]', activa === s.archivo ? 'text-acento font-medium' : 'text-texto')}>{s.titulo}</span>
                  <span className="text-[11px] text-texto-3">{s.palabras} palabras</span>
                </span>
              </button>
              <div className="hidden shrink-0 items-center pr-1 group-hover:flex">
                <BotonIcono titulo="Subir" className="size-6" disabled={i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="size-3" />
                </BotonIcono>
                <BotonIcono titulo="Bajar" className="size-6" disabled={i === secciones.length - 1} onClick={() => mover(i, 1)}>
                  <ArrowDown className="size-3" />
                </BotonIcono>
                <BotonIcono titulo="Eliminar sección" className="size-6 hover:text-error" onClick={() => eliminar(s)}>
                  <Trash2 className="size-3" />
                </BotonIcono>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-borde px-4 py-2.5 text-[11.5px] text-texto-3">
          {secciones.length} secciones · {total.toLocaleString('es')} palabras
        </div>
      </div>

      {/* Editor / vista previa */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activa === TODO ? (
          <div className="flex-1 overflow-y-auto bg-panel px-10 py-10">
            {secciones.length === 0 ? (
              <Vacio
                icono={<FileText className="size-6" />}
                titulo="El documento está vacío"
                texto="Crea la primera sección o pide a la IA (panel de la derecha) que proponga un índice y redacte los apuntes."
                accion={
                  <Boton variante="primario" icono={<Plus className="size-4" />} onClick={nuevaSeccion}>
                    Nueva sección
                  </Boton>
                }
              />
            ) : (
              <VistaPrevia texto={completo} base={base} />
            )}
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-borde px-3">
              <div className="flex items-center gap-0.5 rounded-lg bg-panel-2 p-0.5">
                {(
                  [
                    ['editar', PencilLine, 'Editar'],
                    ['dividido', Columns2, 'Dividido'],
                    ['vista', Eye, 'Vista previa'],
                  ] as const
                ).map(([m, Icono, txt]) => (
                  <button
                    key={m}
                    title={txt}
                    onClick={() => cambiarModo(m)}
                    className={cx(
                      'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors cursor-pointer',
                      modo === m ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                    )}
                  >
                    <Icono className="size-3.5" />
                    {txt}
                  </button>
                ))}
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-texto-3">
                {estadoGuardado === 'guardando' && <Loader2 className="size-3 animate-spin" />}
                {estadoGuardado === 'guardado' && <Check className="size-3 text-ok" />}
                {estadoGuardado === 'guardado' ? 'Guardado' : estadoGuardado === 'guardando' ? 'Guardando…' : 'Sin guardar'}
              </span>
            </div>
            {conflicto !== undefined && (
              <div className="flex items-center gap-3 border-b border-aviso/30 bg-aviso/10 px-4 py-2 text-[13px]">
                <TriangleAlert className="size-4 shrink-0 text-aviso" />
                <span className="flex-1">Un agente ha modificado esta sección mientras la editabas.</span>
                <Boton
                  tam="sm"
                  onClick={() => {
                    clearTimeout(temporizador.current);
                    guardadoRef.current = conflicto;
                    setTexto(conflicto);
                    setEstadoGuardado('guardado');
                    setConflicto(undefined);
                  }}
                >
                  Cargar su versión
                </Boton>
                <Boton
                  tam="sm"
                  variante="fantasma"
                  onClick={() => {
                    setConflicto(undefined);
                    guardar(texto, activa!);
                  }}
                >
                  Mantener la mía
                </Boton>
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              {modo !== 'vista' && (
                <div className={cx('min-w-0 bg-panel', modo === 'dividido' ? 'w-1/2 border-r border-borde' : 'flex-1')}>
                  <Editor key={activa} valor={texto} onCambio={alCambiar} />
                </div>
              )}
              {modo !== 'editar' && (
                <div className={cx('min-w-0 overflow-y-auto bg-panel px-8 py-6', modo === 'dividido' ? 'w-1/2' : 'flex-1')}>
                  <VistaPrevia texto={texto} base={base} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FichaDocumento({
  doc,
  destinatariosAsignatura,
  onGuardado,
}: {
  doc: Documento;
  destinatariosAsignatura: string;
  onGuardado: (d: Documento) => void;
}) {
  const { avisar, seleccionar, cargarAsignaturas } = useEstado();
  const inicial = { titulo: doc.titulo, objetivo: doc.objetivo, destinatarios: doc.destinatarios, extension: doc.extension };
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial);

  const guardar = async () => {
    setGuardando(true);
    try {
      onGuardado(await api.guardarDocumento(doc.asignatura, doc.id, f));
      avisar('Documento guardado', 'ok');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async () => {
    const ok = await confirmar(`¿Eliminar «${doc.titulo}»?`, {
      texto: 'Se moverá a la papelera de la carpeta de datos (.papelera).',
      boton: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    await api.eliminarDocumento(doc.asignatura, doc.id);
    await cargarAsignaturas();
    seleccionar({ asignatura: doc.asignatura });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-10 py-8">
      <Campo etiqueta="Título">
        <Entrada value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
      </Campo>
      <Campo etiqueta="Objetivo" ayuda="Qué deben saber o saber hacer al terminar de estudiarlo.">
        <AreaTexto rows={3} value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} />
      </Campo>
      <Campo
        etiqueta="Destinatarios de este documento"
        ayuda={
          destinatariosAsignatura
            ? `Vacío = los de la asignatura: «${destinatariosAsignatura}». Rellénalo solo si este documento va dirigido a otras personas.`
            : 'Vacío = los de la asignatura.'
        }
      >
        <AreaTexto rows={2} value={f.destinatarios} onChange={(e) => setF({ ...f, destinatarios: e.target.value })} placeholder={destinatariosAsignatura} />
      </Campo>
      <Campo etiqueta="Extensión orientativa">
        <Entrada value={f.extension} onChange={(e) => setF({ ...f, extension: e.target.value })} placeholder="10-15 páginas" />
      </Campo>
      <div className="flex justify-end gap-2">
        {cambiado && (
          <Boton variante="fantasma" onClick={() => setF(inicial)}>
            Descartar
          </Boton>
        )}
        <Boton variante="primario" disabled={!cambiado} cargando={guardando} onClick={guardar}>
          Guardar cambios
        </Boton>
      </div>
      <div className="mt-10 flex items-center justify-between rounded-xl border border-error/30 px-5 py-4">
        <div>
          <div className="text-sm font-medium">Eliminar documento</div>
          <div className="text-xs text-texto-3">Se mueve a la papelera de la carpeta de datos.</div>
        </div>
        <Boton tam="sm" icono={<Trash2 className="size-3.5" />} onClick={eliminar} className="text-error">
          Eliminar
        </Boton>
      </div>
    </div>
  );
}
