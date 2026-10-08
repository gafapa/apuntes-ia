import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, TextSelect, X, ChevronDown, CircleStop, Eraser, Globe, FileEdit, Landmark, Library, Loader2, PanelRightClose, PanelRightOpen, Search, Send, Sparkles, Wrench } from 'lucide-react';
import type { HerramientasChat, Motor, Trabajo } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useEstado } from '../lib/estado';
import { renderizar } from '../lib/markdown';
import { BotonIcono, Insignia, cx } from './ui';
import { ParTokens } from './ContadorTokens';

/** Herramientas que se pueden activar para una petición desde el panel. */
const HERRAMIENTAS: { id: keyof HerramientasChat; nombre: string; corto: string; ayuda: string; icono: typeof Globe; porDefecto: boolean }[] = [
  { id: 'web', nombre: 'Buscar en la web', corto: 'Web', ayuda: 'Puede buscar y consultar páginas web', icono: Globe, porDefecto: true },
  {
    id: 'imagenes',
    nombre: 'Imágenes de museos y bibliotecas',
    corto: 'Imágenes',
    ayuda: 'Busca imágenes con licencia libre (Europeana, Met, Commons…) y las inserta con su crédito',
    icono: Landmark,
    porDefecto: false,
  },
  { id: 'fuentes', nombre: 'Buscar en tus fuentes', corto: 'Fuentes', ayuda: 'Consulta el material que has aportado (si está indexado)', icono: Library, porDefecto: true },
];

function leerHerramientas(): Required<HerramientasChat> {
  const base = Object.fromEntries(HERRAMIENTAS.map((h) => [h.id, h.porDefecto])) as Required<HerramientasChat>;
  try {
    return { ...base, ...JSON.parse(localStorage.getItem('herramientasChat') ?? '{}') };
  } catch {
    return base;
  }
}

export function PanelAgentes() {
  const { seleccion, trabajos, ajustes, motores, seccionActiva, seleccionTexto, avisar } = useEstado();
  const [abierto, setAbierto] = useState(() => localStorage.getItem('panelAgentes') !== 'cerrado');
  const [tarea, setTarea] = useState('');
  const [motor, setMotor] = useState<Motor>();
  const [enviando, setEnviando] = useState(false);
  const [soloEste, setSoloEste] = useState(true);
  const [herramientas, setHerramientas] = useState(leerHerramientas);
  const [menuHerramientas, setMenuHerramientas] = useState(false);
  const cajaHerramientas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuHerramientas) return;
    const fuera = (e: MouseEvent) => !cajaHerramientas.current?.contains(e.target as Node) && setMenuHerramientas(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menuHerramientas]);
  const alternarHerramienta = (id: keyof HerramientasChat) => {
    const n = { ...herramientas, [id]: !herramientas[id] };
    setHerramientas(n);
    try {
      localStorage.setItem('herramientasChat', JSON.stringify(n));
    } catch {}
  };
  const motorElegido = motor ?? ajustes?.motorPorDefecto ?? 'claude';
  const disponible = (m: Motor) => motores?.find((x) => x.motor === m)?.instalado ?? true;

  const lista = useMemo(
    () =>
      Object.values(trabajos)
        .filter((t) =>
          soloEste ? t.asignatura === seleccion.asignatura && (t.documento ?? '') === (seleccion.documento ?? '') : true,
        )
        .sort((a, b) => b.creado - a.creado),
    [trabajos, seleccion, soloEste],
  );
  const enCurso = Object.values(trabajos).filter((t) => t.estado === 'ejecutando' || t.estado === 'en-cola').length;

  const alternar = () => {
    const v = !abierto;
    setAbierto(v);
    localStorage.setItem('panelAgentes', v ? 'abierto' : 'cerrado');
  };

  const enviar = async () => {
    if (!tarea.trim() || !seleccion.asignatura) return;
    setEnviando(true);
    try {
      await api.lanzar({
        motor: motorElegido,
        tarea,
        asignatura: seleccion.asignatura,
        documento: seleccion.documento,
        seccion: seleccionTexto?.seccion ?? seccionActiva,
        herramientas,
        seleccionTexto,
      });
      setTarea('');
      useEstado.setState({ seleccionTexto: undefined });
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-l border-borde bg-panel py-3">
        <BotonIcono titulo="Mostrar agentes" onClick={alternar}>
          <PanelRightOpen className="size-4" />
        </BotonIcono>
        {enCurso > 0 && (
          <span className="flex size-6 items-center justify-center rounded-full bg-acento text-[11px] font-semibold text-white" title={`${enCurso} en curso`}>
            {enCurso}
          </span>
        )}
      </div>
    );
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-borde bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-borde px-4">
        <Sparkles className="size-4 text-acento" />
        <span className="font-semibold">Agentes</span>
        {enCurso > 0 && <Insignia color="acento">{enCurso} en curso</Insignia>}
        <div className="ml-auto flex items-center">
          <BotonIcono titulo="Quitar terminados" onClick={() => api.limpiarTrabajos()}>
            <Eraser className="size-4" />
          </BotonIcono>
          <BotonIcono titulo="Ocultar panel" onClick={alternar}>
            <PanelRightClose className="size-4" />
          </BotonIcono>
        </div>
      </div>

      {/* Petición */}
      <div className="border-b border-borde p-3">
        {seleccionTexto && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-acento/30 bg-acento-suave px-2.5 py-1.5 text-[12px]">
            <TextSelect className="mt-0.5 size-3.5 shrink-0 text-acento" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-acento">Solo sobre la selección</div>
              <div className="line-clamp-2 text-texto-2" title={seleccionTexto.fragmento}>
                {seleccionTexto.texto || seleccionTexto.fragmento}
              </div>
            </div>
            <button
              className="shrink-0 rounded p-0.5 text-texto-3 hover:text-texto cursor-pointer"
              title="Quitar la selección (Esc)"
              onClick={() => useEstado.setState({ seleccionTexto: undefined })}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="relative rounded-xl border border-borde bg-fondo focus-within:border-acento focus-within:ring-3 focus-within:ring-acento/15">
          <textarea
            value={tarea}
            onChange={(e) => setTarea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={3}
            placeholder={
              seleccionTexto
                ? '¿Qué hago con la selección? (p. ej. «simplifícalo», «añade un ejemplo», «¿qué significa?»)'
                : seleccion.documento
                  ? '¿Qué quieres que hagan los agentes con este documento? Puedes seleccionar texto en la vista previa para actuar solo sobre él.'
                  : '¿Qué quieres que hagan los agentes en esta asignatura?'
            }
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-texto-3"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5 rounded-lg bg-panel-2 p-0.5">
              {(['claude', 'codex'] as Motor[]).map((m) => (
                <button
                  key={m}
                  disabled={!disponible(m)}
                  onClick={() => setMotor(m)}
                  title={disponible(m) ? undefined : 'No instalado'}
                  className={cx(
                    'rounded-md px-2 py-0.5 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    motorElegido === m ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                  )}
                >
                  {m === 'claude' ? 'Claude' : 'Codex'}
                </button>
              ))}
            </div>
            <div ref={cajaHerramientas}>
              <button
                onClick={() => setMenuHerramientas(!menuHerramientas)}
                title="Herramientas que puede usar el agente en esta petición"
                className={cx(
                  'flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors cursor-pointer',
                  menuHerramientas ? 'bg-panel-2 text-texto' : 'text-texto-3 hover:bg-panel-2 hover:text-texto',
                )}
              >
                <Wrench className="size-3.5" />
                {HERRAMIENTAS.filter((h) => herramientas[h.id]).map((h) => (
                  <h.icono key={h.id} className="size-3.5 text-acento" aria-label={h.corto} />
                ))}
              </button>
              {menuHerramientas && (
                <div className="aparecer absolute top-full right-0 left-0 z-30 mt-1.5 rounded-xl border border-borde bg-panel p-1.5 shadow-suave">
                  <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Herramientas</div>
                  {HERRAMIENTAS.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => alternarHerramienta(h.id)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-panel-2 cursor-pointer"
                    >
                      <h.icono className={cx('mt-0.5 size-4 shrink-0', herramientas[h.id] ? 'text-acento' : 'text-texto-3')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{h.nombre}</span>
                        <span className="block text-[11.5px] leading-snug text-texto-3">{h.ayuda}</span>
                      </span>
                      <span
                        className={cx(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                          herramientas[h.id] ? 'border-acento bg-acento text-white' : 'border-borde',
                        )}
                      >
                        {herramientas[h.id] && <Check className="size-3" />}
                      </span>
                    </button>
                  ))}
                  <p className="px-2 pt-1 pb-0.5 text-[11px] leading-snug text-texto-3">Leer y editar los apuntes está siempre disponible. Cada herramienta añade algo de consumo de tokens.</p>
                </div>
              )}
            </div>
            {seccionActiva && (
              <span className="truncate text-[11px] text-texto-3" title="La IA sabe qué sección tienes abierta">
                · {seccionActiva.replace(/^\d+-/, '').replace(/\.md$/, '')}
              </span>
            )}
            <button
              onClick={enviar}
              disabled={!tarea.trim() || enviando}
              title="Enviar (Ctrl+Enter)"
              className="ml-auto flex size-8 items-center justify-center rounded-lg bg-acento text-white transition-colors hover:bg-acento-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Actividad</span>
        <button onClick={() => setSoloEste(!soloEste)} className="text-[11.5px] text-texto-3 hover:text-acento cursor-pointer">
          {soloEste ? 'Ver todo' : `Solo ${seleccion.documento ? 'este documento' : 'esta asignatura'}`}
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {lista.length === 0 && (
          <div className="flex flex-col items-center px-6 py-10 text-center text-[13px] text-texto-3">
            <Bot className="mb-2 size-8 opacity-50" />
            Aquí verás en directo lo que hace cada agente.
          </div>
        )}
        {lista.map((t) => (
          <TarjetaTrabajo key={t.id} t={t} />
        ))}
      </div>
    </aside>
  );
}

function duracion(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function TarjetaTrabajo({ t }: { t: Trabajo }) {
  const activo = t.estado === 'ejecutando' || t.estado === 'en-cola';
  const [abierto, setAbierto] = useState(activo);
  useEffect(() => {
    if (activo) setAbierto(true);
  }, [activo]);
  const [, refrescar] = useState(0);
  const finRef = useRef<HTMLDivElement>(null);

  // Cronómetro mientras se ejecuta
  useEffect(() => {
    if (t.estado !== 'ejecutando') return;
    const i = setInterval(() => refrescar((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [t.estado]);

  // Si se abre un trabajo antiguo (sin eventos cargados), pedirlos al servidor
  useEffect(() => {
    if (abierto && t.eventos.length === 0 && !activo) {
      api.trabajo(t.id).then((c) => useEstado.setState((s) => ({ trabajos: { ...s.trabajos, [t.id]: c } }))).catch(() => {});
    }
  }, [abierto, t.id, t.eventos.length, activo]);

  useEffect(() => {
    if (abierto && activo) finRef.current?.scrollIntoView({ block: 'nearest' });
  }, [t.eventos.length, abierto, activo]);

  const tiempo = t.inicio ? duracion((t.fin ?? Date.now()) - t.inicio) : '';
  const herramientas = t.eventos.filter((e) => e.tipo === 'herramienta');
  const ultima = herramientas[herramientas.length - 1];

  return (
    <div className={cx('aparecer rounded-xl border bg-panel transition-colors', activo ? 'border-acento/40' : 'border-borde')}>
      <button onClick={() => setAbierto(!abierto)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer">
        <EstadoIcono estado={t.estado} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] leading-snug font-medium">{t.titulo}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-texto-3">
            <span>{t.nombreAgente}</span>·<span>{t.motor === 'claude' ? 'Claude' : 'Codex'}</span>
            {tiempo && <>· <span className="tabular-nums">{tiempo}</span></>}
            {t.tokens && (
              <>
                · <ParTokens t={t.tokens} />
              </>
            )}
          </div>
          {activo && ultima && !abierto && <div className="mt-1 truncate text-[11.5px] text-acento">{ultima.texto}</div>}
        </div>
        <ChevronDown className={cx('mt-0.5 size-4 shrink-0 text-texto-3 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div className="border-t border-borde px-3 py-2.5">
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {t.eventos.map((e, i) =>
              e.tipo === 'usuario' ? (
                <div key={i} className="my-2 ml-8 rounded-lg rounded-br-sm bg-acento px-3 py-1.5 text-[12.5px] whitespace-pre-wrap text-white">
                  {e.texto}
                </div>
              ) : e.tipo === 'texto' ? (
                e.texto === t.resultado?.trim() ? null : (
                  <div
                    key={i}
                    className="apunte !text-[12.5px] !leading-snug [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: renderizar(e.texto) }}
                  />
                )
              ) : (
                <div key={i} className={cx('flex items-start gap-2 text-[12px]', e.tipo === 'error' ? 'text-error' : 'text-texto-2')}>
                  <IconoEvento texto={e.texto} tipo={e.tipo} />
                  <span className="min-w-0 break-words whitespace-pre-wrap">{e.texto}</span>
                </div>
              ),
            )}
            <div ref={finRef} />
          </div>
          {t.resultado && (
            <div className="apunte mt-3 rounded-lg bg-panel-2 px-3 py-2 !text-[13px] !leading-relaxed" dangerouslySetInnerHTML={{ __html: renderizar(t.resultado) }} />
          )}
          {!activo && t.sesion && <Responder id={t.id} />}
          {activo && (
            <button
              onClick={() => api.cancelar(t.id)}
              className="mt-2 flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-error cursor-pointer"
            >
              <CircleStop className="size-3.5" />
              Detener
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Responder({ id }: { id: string }) {
  const { avisar } = useEstado();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.responder(id, texto);
      setTexto('');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="mt-2.5 flex items-end gap-1.5 rounded-lg border border-borde bg-fondo p-1.5 focus-within:border-acento">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            enviar();
          }
        }}
        rows={1}
        placeholder="Responder al agente…"
        className="field-sizing-content max-h-32 min-h-6 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-[12.5px] outline-none placeholder:text-texto-3"
      />
      <button
        onClick={enviar}
        disabled={!texto.trim() || enviando}
        title="Enviar (Intro)"
        className="flex size-6 items-center justify-center rounded-md bg-acento text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      >
        {enviando ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
      </button>
    </div>
  );
}

function EstadoIcono({ estado }: { estado: Trabajo['estado'] }) {
  const base = 'mt-0.5 size-4 shrink-0';
  if (estado === 'ejecutando') return <Loader2 className={cx(base, 'animate-spin text-acento')} />;
  if (estado === 'en-cola') return <span className={cx(base, 'rounded-full border-2 border-dashed border-texto-3')} title="En cola" />;
  const color = estado === 'ok' ? 'bg-ok' : estado === 'error' ? 'bg-error' : 'bg-texto-3';
  return (
    <span className={cx(base, 'flex items-center justify-center')}>
      <span className={cx('size-2.5 rounded-full', color)} />
    </span>
  );
}

function IconoEvento({ texto, tipo }: { texto: string; tipo: string }) {
  const c = 'mt-0.5 size-3.5 shrink-0';
  if (tipo === 'estado') return <span className={cx(c, 'flex items-center justify-center')}><span className="size-1.5 rounded-full bg-texto-3" /></span>;
  if (/^Buscando en la web|^Consultando/.test(texto)) return <Globe className={cx(c, 'text-sky-500')} />;
  if (/^Buscando en tus fuentes|^Repasando la lista de fuentes/.test(texto)) return <Search className={cx(c, 'text-ok')} />;
  if (/^(Escribiendo|Editando|Modificando)/.test(texto)) return <FileEdit className={cx(c, 'text-acento')} />;
  return <Wrench className={cx(c, 'text-texto-3')} />;
}
