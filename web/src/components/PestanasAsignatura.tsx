import { useEffect, useRef, useState } from 'react';
import { BookA, Download, FileType, Landmark, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { api, urlDatos } from '../lib/api';
import { useEstado } from '../lib/estado';
import { AreaTexto, Boton, Insignia, confirmar } from './ui';
import { VistaPrevia } from './VistaPrevia';
import { ActividadAgente, BotonAgente } from './flujo/comun';

/** Glosario común de la asignatura: lo mantiene un agente y se puede editar a mano. */
export function PestanaGlosario({ a }: { a: string }) {
  const { avisar, versiones, reconexion, trabajos } = useEstado();
  const version = `${versiones[`${a}/`] ?? 0}-${reconexion}`; // también al reconectar con el servidor
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(false);
  const activos = Object.values(trabajos).filter((t) => t.asignatura === a && t.paso === 'glosario' && (t.estado === 'ejecutando' || t.estado === 'en-cola'));

  useEffect(() => {
    if (!editando) api.glosario(a).then((r) => setTexto(r.contenido)).catch(() => {});
  }, [a, version, editando]);

  const guardar = async () => {
    await api.guardarGlosario(a, texto).catch((e) => avisar(e.message, 'error'));
    setEditando(false);
    avisar('Glosario guardado', 'ok');
  };

  const vacio = texto.replace(/^#\s*Glosario\s*/i, '').trim() === '';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-texto-2">
          Términos, definiciones y notación comunes a todos los documentos. Los agentes lo consultan para usar siempre los mismos nombres. El agente de
          glosario lo completa a partir de los documentos y avisa de incoherencias entre ellos.
        </p>
        {editando ? (
          <Boton variante="primario" icono={<Save className="size-4" />} onClick={guardar}>
            Guardar
          </Boton>
        ) : (
          <>
            <Boton icono={<Pencil className="size-4" />} onClick={() => setEditando(true)}>
              Editar
            </Boton>
            <BotonAgente
              texto="Actualizar con IA"
              icono={<BookA className="size-4" />}
              disabled={activos.length > 0}
              onLanzar={(ind) => api.actualizarGlosario(a, ind)}
            />
          </>
        )}
      </div>
      {activos.map((t) => (
        <ActividadAgente key={t.id} t={t} />
      ))}
      <div className="rounded-xl border border-borde bg-panel px-6 py-5">
        {editando ? (
          <AreaTexto className="min-h-[50vh] border-0 font-mono text-[13px] focus:ring-0" value={texto} onChange={(e) => setTexto(e.target.value)} />
        ) : vacio ? (
          <p className="py-6 text-center text-sm text-texto-3">El glosario está vacío. Pulsa «Actualizar con IA» cuando haya documentos redactados.</p>
        ) : (
          <VistaPrevia texto={texto} base={urlDatos(a)} />
        )}
      </div>
    </div>
  );
}

/** Plantillas de Word / LibreOffice con los estilos del centro o del profesor. */
export function PestanaPlantillas({ a }: { a: string }) {
  const { avisar } = useEstado();
  const [plantillas, setPlantillas] = useState<{ docx: boolean; odt: boolean }>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.plantillas(a).then(setPlantillas).catch(() => {});
  }, [a]);

  const subir = async (f?: File) => {
    if (!f) return;
    try {
      setPlantillas(await api.subirPlantilla(a, f));
      avisar('Plantilla guardada', 'ok');
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };
  const [descargando, setDescargando] = useState<'docx' | 'odt'>();
  const descargarBase = async (formato: 'docx' | 'odt') => {
    setDescargando(formato);
    try {
      await api.descargarPlantillaBase(a, formato);
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setDescargando(undefined);
    }
  };
  const quitar = async (formato: 'docx' | 'odt') => {
    if (!(await confirmar('¿Quitar la plantilla?', { texto: 'Se volverán a usar los estilos por defecto.', boton: 'Quitar', peligro: true }))) return;
    setPlantillas(await api.eliminarPlantilla(a, formato));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-texto-2">
        Al exportar a Word o LibreOffice se usan los estilos de estas plantillas (fuentes, colores, márgenes, encabezados…); su contenido se ignora.
      </p>
      <div className="rounded-xl border border-borde bg-panel-2/50 p-4">
        <div className="text-sm font-medium">Crear una plantilla a partir del documento de base</div>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] text-texto-2">
          <li>Descarga el documento de base: trae un ejemplo de cada elemento (portada, índice, títulos, listas, citas, código, tablas, figuras, notas…) con el nombre de su estilo.</li>
          <li>Ábrelo y cambia los estilos a tu gusto (no el texto), además de márgenes, encabezado y pie de página.</li>
          <li>Guárdalo y súbelo aquí.</li>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['docx', 'odt'] as const).map((f) => (
            <Boton key={f} tam="sm" icono={<Download className="size-3.5" />} cargando={descargando === f} onClick={() => descargarBase(f)}>
              Documento de base {f === 'docx' ? 'Word' : 'LibreOffice'}
            </Boton>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-texto-3">Si la asignatura ya tiene plantilla propia, el documento de base parte de ella, para seguir retocándola.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(['docx', 'odt'] as const).map((f) => (
          <div key={f} className="flex items-center gap-3 rounded-xl border border-borde bg-panel p-4">
            <FileType className="size-6 text-acento" />
            <div className="flex-1">
              <div className="font-medium">{f === 'docx' ? 'Word (.docx)' : 'LibreOffice (.odt)'}</div>
              {plantillas?.[f] ? <Insignia color="ok">Plantilla propia</Insignia> : <span className="text-xs text-texto-3">Estilos por defecto</span>}
            </div>
            {plantillas?.[f] && (
              <Boton tam="sm" variante="fantasma" icono={<Trash2 className="size-3.5" />} onClick={() => quitar(f)}>
                Quitar
              </Boton>
            )}
          </div>
        ))}
      </div>
      <Boton icono={<Upload className="size-4" />} onClick={() => input.current?.click()}>
        Subir plantilla (.docx o .odt)
      </Boton>
      <input
        ref={input}
        type="file"
        accept=".docx,.odt"
        hidden
        onChange={(e) => {
          subir(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="text-[12.5px] text-texto-3">El PDF usa un diseño propio con el color de la asignatura.</p>
    </div>
  );
}

const COMUNIDADES = [
  'Andalucía', 'Aragón', 'Principado de Asturias', 'Illes Balears', 'Canarias', 'Cantabria', 'Castilla-La Mancha', 'Castilla y León',
  'Cataluña', 'Comunitat Valenciana', 'Extremadura', 'Galicia', 'Comunidad de Madrid', 'Región de Murcia', 'Comunidad Foral de Navarra',
  'País Vasco', 'La Rioja', 'Ceuta', 'Melilla',
];

/**
 * Currículo oficial de la asignatura (curriculo.md): resultados de aprendizaje y criterios en FP;
 * competencias, criterios y saberes básicos en ESO y Bachillerato. Lo busca un agente en la norma
 * oficial y se puede editar. El índice director lo usa y la revisión «Currículo» comprueba que los
 * apuntes cubren lo que les toca.
 */
export function PestanaCurriculo({ a, comunidad, onComunidad }: { a: string; comunidad?: string; onComunidad: (c: string) => void }) {
  const { avisar, versiones, reconexion, trabajos } = useEstado();
  const version = `${versiones[`${a}/`] ?? 0}-${reconexion}`;
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(false);
  const activos = Object.values(trabajos).filter((t) => t.asignatura === a && t.paso === 'curriculo' && (t.estado === 'ejecutando' || t.estado === 'en-cola'));

  useEffect(() => {
    if (!editando) api.curriculo(a).then((r) => setTexto(r.contenido)).catch(() => {});
  }, [a, version, editando]);

  const guardar = async () => {
    await api.guardarCurriculo(a, texto).catch((e) => avisar(e.message, 'error'));
    setEditando(false);
    avisar('Currículo guardado', 'ok');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-texto-2">
          El currículo oficial de la asignatura, transcrito de la norma: en FP, los resultados de aprendizaje y criterios de evaluación del módulo; en
          ESO y Bachillerato, las competencias específicas, los criterios de evaluación y los saberes básicos. El arquitecto del índice planifica cada
          documento para cubrir lo que le toca, y la revisión «Currículo» comprueba que los apuntes lo cubren.
        </p>
        {editando ? (
          <Boton variante="primario" icono={<Save className="size-4" />} onClick={guardar}>
            Guardar
          </Boton>
        ) : (
          <>
            <Boton icono={<Pencil className="size-4" />} onClick={() => setEditando(true)}>
              Editar
            </Boton>
            <BotonAgente
              texto={texto.trim() ? 'Volver a buscar' : 'Buscar el currículo oficial'}
              icono={<Landmark className="size-4" />}
              disabled={activos.length > 0}
              onLanzar={(ind) => api.buscarCurriculo(a, ind)}
              ayudaIndicaciones="Por ejemplo: usa el Decreto de la Comunidad de Madrid, o el RD 1691/2007 del título…"
            />
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-texto-2">
        Comunidad autónoma
        <select
          value={comunidad ?? ''}
          onChange={(e) => onComunidad(e.target.value)}
          className="h-8 rounded-lg border border-borde bg-panel px-2 text-[13px] outline-none focus:border-acento cursor-pointer"
        >
          <option value="">Solo la norma estatal</option>
          {COMUNIDADES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-texto-3">Su decreto concreta el currículo estatal.</span>
      </label>
      {activos.map((t) => (
        <ActividadAgente key={t.id} t={t} />
      ))}
      <div className="rounded-xl border border-borde bg-panel px-6 py-5">
        {editando ? (
          <AreaTexto rows={24} className="font-mono text-[13px]" value={texto} onChange={(e) => setTexto(e.target.value)} />
        ) : texto.trim() ? (
          <VistaPrevia texto={texto} base={urlDatos(a)} />
        ) : (
          <p className="py-6 text-center text-sm text-texto-3">Aún no hay currículo. Pulsa «Buscar el currículo oficial» para que un agente lo localice en el BOE.</p>
        )}
      </div>
    </div>
  );
}
