import { useEffect, useState, type FormEvent } from 'react';
import { useEstado } from '../lib/estado';
import { api } from '../lib/api';
import { FileUp } from 'lucide-react';
import type { ModoMejora } from '../../../shared/tipos';
import { AreaTexto, Boton, Campo, Entrada, Modal, cx } from './ui';
import { SelectorEnsenanza, type ValorEnsenanza } from './SelectorEnsenanza';
import { describirNivel, destinatariosSugeridos } from '../../../shared/catalogo/educacion';

export function ModalNuevaAsignatura({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { cargarAsignaturas, seleccionar, avisar } = useEstado();
  const vacio: ValorEnsenanza = { nombre: '', nivelLibre: '', idioma: 'Castellano' };
  const [v, setV] = useState<ValorEnsenanza>(vacio);
  const [destinatarios, setDestinatarios] = useState('');
  const [destinatariosTocados, setDestinatariosTocados] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (abierto) {
      setV(vacio);
      setDestinatarios('');
      setDestinatariosTocados(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Destinatarios sugeridos según la enseñanza, mientras el usuario no los escriba
  useEffect(() => {
    if (!destinatariosTocados) setDestinatarios(destinatariosSugeridos(v));
  }, [v, destinatariosTocados]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.nombre.trim()) return avisar('Indica la asignatura', 'error');
    setGuardando(true);
    try {
      const a = await api.crearAsignatura({
        nombre: v.nombre.trim(),
        nivel: v.etapa === 'libre' || !v.etapa ? v.nivelLibre.trim() : describirNivel(v),
        etapa: v.etapa,
        curso: v.curso,
        modalidad: v.modalidad,
        familia: v.familia,
        titulo: v.titulo,
        idioma: v.idioma.trim() || 'Castellano',
        destinatarios,
      });
      await cargarAsignaturas();
      seleccionar({ asignatura: a.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="max-w-xl"
      titulo="Nueva asignatura"
      descripcion="Elige la enseñanza y la asignatura del catálogo oficial, o escribe la tuya. Podrás completar el contexto después."
    >
      <form onSubmit={crear} className="space-y-4">
        <SelectorEnsenanza valor={v} onCambio={setV} />
        <Campo etiqueta="Destinatarios" ayuda="A quién van dirigidos. Cada documento puede indicar otros distintos.">
          <AreaTexto
            rows={2}
            value={destinatarios}
            onChange={(e) => {
              setDestinatarios(e.target.value);
              setDestinatariosTocados(true);
            }}
            placeholder="Alumnado de 17-18 años que prepara la PAU; nivel medio, poco tiempo de estudio"
          />
        </Campo>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando} disabled={!v.nombre.trim()}>
            Crear asignatura
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export function ModalNuevoDocumento({ asignatura, onCerrar }: { asignatura?: string; onCerrar: () => void }) {
  const { asignaturas, cargarAsignaturas, seleccionar, avisar } = useEstado();
  const asig = asignaturas.find((a) => a.id === asignatura);
  const vacio = { titulo: '', objetivo: '', destinatarios: '', extension: '' };
  const [f, setF] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (asignatura) setF(vacio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignatura]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!asignatura) return;
    setGuardando(true);
    try {
      const d = await api.crearDocumento(asignatura, f);
      await cargarAsignaturas();
      seleccionar({ asignatura, documento: d.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal abierto={!!asignatura} onCerrar={onCerrar} titulo="Nuevo documento de apuntes" descripcion={asig ? `En ${asig.nombre}` : undefined}>
      <form onSubmit={crear} className="space-y-4">
        <Campo etiqueta="Título">
          <Entrada autoFocus required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Tema 3: La célula" />
        </Campo>
        <Campo etiqueta="Objetivo" ayuda="Qué deben saber o saber hacer al terminar de estudiarlo.">
          <AreaTexto rows={2} value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} />
        </Campo>
        <Campo
          etiqueta="Destinatarios"
          ayuda={asig?.destinatarios ? `Si lo dejas vacío se usan los de la asignatura: «${asig.destinatarios}»` : 'Si lo dejas vacío se usan los de la asignatura.'}
        >
          <Entrada value={f.destinatarios} onChange={(e) => setF({ ...f, destinatarios: e.target.value })} placeholder="Los de la asignatura" />
        </Campo>
        <Campo etiqueta="Extensión orientativa">
          <Entrada value={f.extension} onChange={(e) => setF({ ...f, extension: e.target.value })} placeholder="10-15 páginas" />
        </Campo>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando}>
            Crear documento
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

const MODOS_MEJORA: { id: ModoMejora; nombre: string; texto: string }[] = [
  {
    id: 'conservador',
    nombre: 'Mejorar sobre el texto',
    texto: 'Tus apuntes pasan a ser las secciones del documento. Los agentes solo proponen cambios y tú decides cuáles aceptar. Puedes comparar siempre con el original.',
  },
  {
    id: 'reestructurar',
    nombre: 'Reorganizar',
    texto: 'El contenido es bueno pero la organización no: se propone un índice nuevo y los redactores reparten y mejoran tu texto, conservando sus explicaciones y ejemplos.',
  },
  {
    id: 'reescribir',
    nombre: 'Rehacer',
    texto: 'Tus apuntes son la fuente principal de unos nuevos: mismo contenido (y lo que falte), redactado de nuevo y actualizado.',
  },
];

/** Crear un documento a partir de unos apuntes existentes. */
export function ModalImportar({ asignatura, onCerrar }: { asignatura?: string; onCerrar: () => void }) {
  const { asignaturas, cargarAsignaturas, seleccionar, avisar } = useEstado();
  const asig = asignaturas.find((a) => a.id === asignatura);
  const [archivo, setArchivo] = useState<File>();
  const [titulo, setTitulo] = useState('');
  const [modo, setModo] = useState<ModoMejora>('conservador');
  const [estiloOriginal, setEstiloOriginal] = useState(true);
  const [diagnosticar, setDiagnosticar] = useState(true);
  const [importando, setImportando] = useState(false);
  useEffect(() => {
    if (!asignatura) return;
    setArchivo(undefined);
    setTitulo('');
    setModo('conservador');
  }, [asignatura]);
  const ext = archivo?.name.split('.').pop()?.toLowerCase() ?? '';
  const esOficina = ext === 'docx' || ext === 'odt';
  const esPdf = ext === 'pdf';

  const importar = async (e: FormEvent) => {
    e.preventDefault();
    if (!asignatura || !archivo) return;
    setImportando(true);
    try {
      const r = await api.importarApuntes(asignatura, archivo, { titulo: titulo.trim() || undefined, modo, estiloOriginal: esOficina && estiloOriginal, diagnosticar });
      await cargarAsignaturas();
      const partes = [
        r.secciones ? `${r.secciones} ${r.secciones === 1 ? 'sección' : 'secciones'}` : '',
        r.imagenes ? `${r.imagenes} ${r.imagenes === 1 ? 'imagen' : 'imágenes'}` : '',
      ].filter(Boolean);
      avisar(`Apuntes importados${partes.length ? `: ${partes.join(' y ')}` : ''}.${r.trabajos ? ' Los agentes ya están trabajando.' : ''}`, 'ok');
      for (const a of r.avisos) avisar(a, 'info');
      seleccionar({ asignatura, documento: r.documento.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setImportando(false);
    }
  };

  return (
    <Modal
      abierto={!!asignatura}
      onCerrar={onCerrar}
      ancho="max-w-2xl"
      titulo="Mejorar unos apuntes existentes"
      descripcion={asig ? `Se crea un documento nuevo en ${asig.nombre}. El archivo original no se modifica.` : undefined}
    >
      <form onSubmit={importar} className="space-y-4">
        <Campo etiqueta="Archivo" ayuda="Word (.docx), LibreOffice (.odt), Markdown (.md, o un .zip con el .md y sus imágenes) o PDF.">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-borde px-4 py-3 transition-colors hover:border-acento">
            <FileUp className="size-5 shrink-0 text-acento" />
            <span className={cx('min-w-0 flex-1 truncate text-sm', !archivo && 'text-texto-3')}>{archivo ? archivo.name : 'Elige el archivo de tus apuntes…'}</span>
            <input
              type="file"
              className="hidden"
              accept=".docx,.odt,.md,.markdown,.txt,.zip,.pdf"
              onChange={(e) => {
                setArchivo(e.target.files?.[0]);
              }}
            />
          </label>
        </Campo>
        {esPdf && (
          <p className="rounded-lg bg-aviso/10 px-3 py-2 text-[12.5px] text-texto-2">
            Del PDF se pierde la estructura: en «Mejorar sobre el texto», un agente lo transcribe primero (gasta más tokens cuanto más largo sea) y sus imágenes no se pueden extraer.
            Si tienes el Word o el ODT original, mejor impórtalo.
          </p>
        )}
        <Campo etiqueta="Título" ayuda="Si lo dejas vacío, se usa el título de los apuntes.">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Tema 3: La célula" />
        </Campo>
        <Campo etiqueta="Qué hacer con ellos">
          <div className="space-y-1.5">
            {MODOS_MEJORA.map((m) => (
              <label
                key={m.id}
                className={cx(
                  'flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  modo === m.id ? 'border-acento/50 bg-acento-suave' : 'border-borde hover:bg-panel-2',
                )}
              >
                <input type="radio" name="modo" className="mt-1 accent-[var(--acento)]" checked={modo === m.id} onChange={() => setModo(m.id)} />
                <span>
                  <span className="text-[13.5px] font-medium">{m.nombre}</span>
                  <span className="block text-[12.5px] text-texto-2">{m.texto}</span>
                </span>
              </label>
            ))}
          </div>
        </Campo>
        <div className="space-y-1.5">
          {modo === 'conservador' && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-texto-2">
              <input type="checkbox" className="accent-[var(--acento)]" checked={diagnosticar} onChange={(e) => setDiagnosticar(e.target.checked)} />
              Hacer un diagnóstico al importar (qué conservar, qué falta, qué corregir)
            </label>
          )}
          {esOficina && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-texto-2">
              <input type="checkbox" className="accent-[var(--acento)]" checked={estiloOriginal} onChange={(e) => setEstiloOriginal(e.target.checked)} />
              Exportar con el estilo del original (fuentes, colores y títulos de tu {ext === 'odt' ? 'ODT' : 'Word'})
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={importando} disabled={!archivo}>
            Importar
          </Boton>
        </div>
      </form>
    </Modal>
  );
}
