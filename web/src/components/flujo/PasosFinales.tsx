import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  ImagePlus,
  Loader2,
  Network,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type { EstadoFlujo, OpcionesExportacion, PropuestaVisual, TipoVisual, Trabajo } from '../../../../shared/tipos';
import { api } from '../../lib/api';
import { useEstado } from '../../lib/estado';
import { exportarDocumento } from '../../lib/exportacion';
import { AreaTexto, Boton, Entrada, Insignia, cx } from '../ui';
import { ActividadAgente, BotonAgente, Paso, fechaCorta, trabajosDe } from './comun';
import { irASeccion } from './PasosEscritura';

interface Props {
  a: string;
  d: string;
  estado: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
}

const TIPOS: { id: TipoVisual; nombre: string; icono: typeof Network; ayuda: string }[] = [
  { id: 'diagrama', nombre: 'Diagrama', icono: Network, ayuda: 'Esquema dibujado con Mermaid' },
  { id: 'imagen-web', nombre: 'Imagen web', icono: Globe, ayuda: 'Imagen real con licencia libre' },
  { id: 'imagen-ia', nombre: 'Imagen IA', icono: Sparkles, ayuda: 'Generada con Codex' },
];

export function PasoVisuales({ a, d, estado, trabajos, recargar }: Props) {
  const { motores, avisar } = useEstado();
  const conCodex = !!motores?.find((m) => m.motor === 'codex' && m.instalado && m.sesion);
  const director = trabajosDe(trabajos, 'visuales', (t) => t.ref === 'director');
  const propuestas = estado.visuales.filter((p) => p.estado !== 'descartada' && p.estado !== 'insertada');
  const insertadas = estado.visuales.filter((p) => p.estado === 'insertada');
  const titulos = useMemo(() => new Map(estado.secciones.map((s) => [s.archivo, s.titulo])), [estado.secciones]);
  const listas = propuestas.filter((p) => p.estado === 'propuesta' || p.estado === 'error');

  const generarTodas = async () => {
    for (const p of listas) {
      await api.generarVisual(a, d, p.id).catch((e) => avisar(e.message, 'error'));
    }
    recargar();
  };

  return (
    <Paso
      numero={5}
      titulo="Imágenes, esquemas y diagramas"
      opcional
      hecho={insertadas.length > 0 && propuestas.length === 0}
      trabajando={director.length > 0 || propuestas.some((p) => p.estado === 'generando')}
      descripcion="El director visual detecta dónde ayuda un apoyo visual y decide de qué tipo. Tú apruebas y el ilustrador lo crea."
      acciones={
        <BotonAgente
          texto="Buscar dónde hacen falta"
          variante={propuestas.length ? 'secundario' : 'primario'}
          icono={<ImagePlus className="size-4" />}
          disabled={director.length > 0 || !estado.secciones.length}
          onLanzar={(ind) => api.proponerVisuales(a, d, undefined, ind)}
          ayudaIndicaciones="Por ejemplo: prioriza mapas conceptuales, nada de imágenes IA, como mucho 5 visuales…"
        />
      }
    >
      <div className="space-y-3">
        {director.map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}
        {listas.length > 1 && (
          <div className="flex items-center">
            <span className="text-sm font-medium">{propuestas.length} propuestas</span>
            <Boton tam="sm" className="ml-auto" icono={<Wand2 className="size-3.5" />} onClick={generarTodas}>
              Generar todas
            </Boton>
          </div>
        )}
        {propuestas.map((p) => (
          <TarjetaPropuesta
            key={p.id}
            a={a}
            d={d}
            p={p}
            seccion={titulos.get(p.seccion) ?? p.seccion}
            conCodex={conCodex}
            trabajo={trabajos.find((t) => t.ref === p.id && (t.estado === 'ejecutando' || t.estado === 'en-cola'))}
            recargar={recargar}
          />
        ))}
        {insertadas.length > 0 && (
          <div className="text-[12.5px] text-texto-3">
            <div className="mb-1 font-medium text-texto-2">Insertados ({insertadas.length})</div>
            {insertadas.map((p) => (
              <button
                key={p.id}
                onClick={() => irASeccion(p.seccion)}
                className="flex w-full items-center gap-2 py-0.5 text-left hover:text-acento cursor-pointer"
              >
                <Check className="size-3.5 text-ok" />
                <span className="truncate">{p.titulo}</span>
                <span className="shrink-0">· {titulos.get(p.seccion)}</span>
              </button>
            ))}
            <button className="mt-1 hover:text-acento cursor-pointer" onClick={() => api.limpiarVisuales(a, d).then(recargar)}>
              Limpiar historial
            </button>
          </div>
        )}
        {!propuestas.length && !insertadas.length && !director.length && (
          <p className="text-[13px] text-texto-3">Las imágenes insertadas se pueden ver y gestionar en la pestaña Imágenes.</p>
        )}
      </div>
    </Paso>
  );
}

function TarjetaPropuesta({
  a,
  d,
  p,
  seccion,
  conCodex,
  trabajo,
  recargar,
}: {
  a: string;
  d: string;
  p: PropuestaVisual;
  seccion: string;
  conCodex: boolean;
  trabajo?: Trabajo;
  recargar: () => void;
}) {
  const { avisar } = useEstado();
  const [titulo, setTitulo] = useState(p.titulo);
  const [descripcion, setDescripcion] = useState(p.descripcion);
  const generando = p.estado === 'generando';

  const guardar = (cambios: Partial<PropuestaVisual>) =>
    api.editarPropuesta(a, d, p.id, cambios).then(recargar).catch((e) => avisar(e.message, 'error'));

  const generar = async () => {
    try {
      if (titulo !== p.titulo || descripcion !== p.descripcion) await api.editarPropuesta(a, d, p.id, { titulo, descripcion });
      await api.generarVisual(a, d, p.id);
      recargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  return (
    <div className={cx('aparecer rounded-lg border bg-fondo/40 p-3', generando ? 'border-acento/40' : 'border-borde')}>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => irASeccion(p.seccion)} className="truncate text-[12px] text-texto-3 hover:text-acento cursor-pointer">
          {seccion}
        </button>
        <div className="ml-auto flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
          {TIPOS.map((t) => {
            const deshabilitado = generando || (t.id === 'imagen-ia' && !conCodex);
            return (
              <button
                key={t.id}
                disabled={deshabilitado}
                title={t.id === 'imagen-ia' && !conCodex ? 'Necesita Codex' : t.ayuda}
                onClick={() => guardar({ tipo: t.id })}
                className={cx(
                  'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                  p.tipo === t.id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                )}
              >
                <t.icono className="size-3" />
                {t.nombre}
              </button>
            );
          })}
        </div>
      </div>
      <Entrada
        className="mb-1.5 h-8 text-[13px] font-medium"
        value={titulo}
        disabled={generando}
        onChange={(e) => setTitulo(e.target.value)}
        onBlur={() => titulo !== p.titulo && guardar({ titulo })}
      />
      <AreaTexto
        rows={2}
        className="text-[12.5px]"
        value={descripcion}
        disabled={generando}
        onChange={(e) => setDescripcion(e.target.value)}
        onBlur={() => descripcion !== p.descripcion && guardar({ descripcion })}
      />
      {p.estado === 'error' && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {p.error ?? 'No se pudo generar'}. Puedes reintentarlo o responder al agente en el panel de la derecha.
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {trabajo && (
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-acento">
            <Loader2 className="size-3.5 animate-spin" />
            {trabajo.estado === 'en-cola' ? 'En cola…' : `${trabajo.nombreAgente} trabajando…`}
          </span>
        )}
        <Boton tam="sm" variante="fantasma" icono={<X className="size-3.5" />} disabled={generando} onClick={() => guardar({ estado: 'descartada' })}>
          Descartar
        </Boton>
        <Boton tam="sm" icono={<Wand2 className="size-3.5" />} disabled={generando} onClick={generar}>
          {p.estado === 'error' ? 'Reintentar' : 'Generar'}
        </Boton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PasoAutoevaluacion({ a, d, estado, trabajos }: Props) {
  const activos = trabajosDe(trabajos, 'autoevaluacion');
  const archivo = estado.autoevaluacion;
  const palabras = estado.secciones.find((s) => s.archivo === archivo)?.palabras ?? 0;
  const hecha = !!archivo && palabras > 30;
  return (
    <Paso
      numero={6}
      titulo="Autoevaluación"
      opcional
      hecho={hecha && !activos.length}
      trabajando={activos.length > 0}
      descripcion="Preguntas tipo test, de respuesta corta y ejercicios, con sus soluciones explicadas. Se añade como última sección."
      acciones={
        <>
          {hecha && (
            <Boton icono={<ExternalLink className="size-4" />} onClick={() => irASeccion(archivo!)}>
              Ver
            </Boton>
          )}
          <BotonAgente
            texto={hecha ? 'Rehacer' : 'Generar'}
            variante={hecha ? 'secundario' : 'primario'}
            icono={<ClipboardCheck className="size-4" />}
            disabled={activos.length > 0 || !estado.secciones.some((s) => s.palabras > 40)}
            onLanzar={(ind) => api.autoevaluacion(a, d, ind)}
            ayudaIndicaciones="Por ejemplo: 15 preguntas tipo test estilo PAU, sin ejercicios de desarrollo…"
          />
        </>
      }
    >
      {activos.length > 0 && (
        <div className="space-y-2">
          {activos.map((t) => (
            <ActividadAgente key={t.id} t={t} />
          ))}
        </div>
      )}
    </Paso>
  );
}

// ---------------------------------------------------------------------------

const FORMATOS: { id: OpcionesExportacion['formato']; nombre: string; detalle: string }[] = [
  { id: 'docx', nombre: 'Word', detalle: '.docx' },
  { id: 'odt', nombre: 'LibreOffice', detalle: '.odt' },
  { id: 'pdf', nombre: 'PDF', detalle: 'listo para imprimir' },
];

export function PanelExportar({ a, d, estado, recargar }: { a: string; d: string; estado?: EstadoFlujo; recargar: () => void }) {
  const { avisar } = useEstado();
  const [op, setOp] = useState<OpcionesExportacion>(() => {
    try {
      return { formato: 'pdf', portada: true, indice: true, numerar: true, autoevaluacion: true, saltoSeccion: false, ...JSON.parse(localStorage.getItem('opcionesExportar') ?? '{}') };
    } catch {
      return { formato: 'pdf', portada: true, indice: true, numerar: true, autoevaluacion: true, saltoSeccion: false };
    }
  });
  const [exportando, setExportando] = useState(false);
  const trabajos = useEstado((s) => s.trabajos);
  const anadiendoPies = Object.values(trabajos).some(
    (t) => t.asignatura === a && t.documento === d && t.ref === 'pies' && (t.estado === 'ejecutando' || t.estado === 'en-cola'),
  );
  const [sinPie, setSinPie] = useState<{ seccion: string; tipo: string; muestra: string }[]>([]);
  const firmaSecciones = estado?.secciones.map((s) => `${s.archivo}:${s.palabras}`).join('|');
  useEffect(() => {
    api.sinPie(a, d).then(setSinPie).catch(() => {});
  }, [a, d, firmaSecciones, anadiendoPies]);
  const cambiar = (c: Partial<OpcionesExportacion>) => {
    const n = { ...op, ...c };
    setOp(n);
    try {
      localStorage.setItem('opcionesExportar', JSON.stringify(n));
    } catch {}
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await exportarDocumento(a, d, op);
      avisar(`Exportado: ${r.nombre}`, 'ok');
      recargar();
      await api.abrirExportado(a, d, r.nombre);
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setExportando(false);
    }
  };

  const opciones: [keyof OpcionesExportacion, string][] = [
    ['portada', 'Portada'],
    ['indice', 'Índice'],
    ['numerar', 'Numerar apartados'],
    ['saltoSeccion', 'Cada sección en página nueva'],
    ...(estado?.autoevaluacion ? ([['autoevaluacion', 'Incluir autoevaluación']] as [keyof OpcionesExportacion, string][]) : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {FORMATOS.map((f) => (
          <button
            key={f.id}
            onClick={() => cambiar({ formato: f.id })}
            className={cx(
              'rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer',
              op.formato === f.id ? 'border-acento bg-acento-suave' : 'border-borde hover:bg-panel-2',
            )}
          >
            <FileText className={cx('mb-1.5 size-5', op.formato === f.id ? 'text-acento' : 'text-texto-3')} />
            <div className="text-sm font-semibold">{f.nombre}</div>
            <div className="text-[12px] text-texto-3">{f.detalle}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {opciones.map(([clave, texto]) => (
          <label key={clave} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-[var(--acento)]" checked={!!op[clave]} onChange={(e) => cambiar({ [clave]: e.target.checked })} />
            {texto}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Boton variante="primario" icono={<Download className="size-4" />} cargando={exportando} disabled={!estado?.secciones.length} onClick={exportar}>
          {exportando ? 'Exportando…' : `Exportar a ${FORMATOS.find((f) => f.id === op.formato)!.nombre}`}
        </Boton>
        <Boton variante="fantasma" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpeta(a, d, 'exportados')}>
          Carpeta
        </Boton>
      </div>
      {sinPie.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-aviso/40 bg-aviso/10 px-3 py-2 text-[12.5px]">
          <AlertCircle className="size-4 shrink-0 text-aviso" />
          <span className="flex-1">
            {sinPie.length === 1 ? 'Un elemento no tiene' : `${sinPie.length} elementos no tienen`} pie (
            {[...new Set(sinPie.map((x) => x.tipo))].join(', ')}). Se exportarán con un pie genérico numerado.
          </span>
          <Boton
            tam="sm"
            cargando={anadiendoPies}
            onClick={() => api.anadirPies(a, d).catch((e) => avisar(e.message, 'error'))}
          >
            {anadiendoPies ? 'Añadiendo…' : 'Añadir pies con IA'}
          </Boton>
        </div>
      )}
      {op.formato !== 'pdf' && (
        <p className="text-[12px] text-texto-3">Para usar tus propios estilos de {op.formato === 'docx' ? 'Word' : 'LibreOffice'}, sube una plantilla en la ficha de la asignatura.</p>
      )}
      {!!estado?.exportados.length && (
        <div className="divide-y divide-borde rounded-lg border border-borde">
          {estado.exportados.map((x) => (
            <button
              key={x.nombre}
              onClick={() => api.abrirExportado(a, d, x.nombre).catch((e) => avisar(e.message, 'error'))}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-panel-2 cursor-pointer"
            >
              <Insignia color="acento" className="uppercase">
                {x.formato}
              </Insignia>
              <span className="min-w-0 flex-1 truncate">{x.nombre}</span>
              <span className="text-[12px] text-texto-3">{fechaCorta(x.modificado)}</span>
              <ExternalLink className="size-3.5 text-texto-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PasoExportar({ a, d, estado, recargar }: Props) {
  return (
    <Paso
      numero={7}
      titulo="Exportar"
      hecho={estado.exportados.length > 0}
      descripcion="Une las secciones y genera el documento final. Los diagramas se convierten en imágenes."
    >
      <PanelExportar a={a} d={d} estado={estado} recargar={recargar} />
    </Paso>
  );
}
