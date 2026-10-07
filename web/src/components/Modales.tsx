import { useEffect, useState, type FormEvent } from 'react';
import { useEstado } from '../lib/estado';
import { api } from '../lib/api';
import { AreaTexto, Boton, Campo, Entrada, Modal } from './ui';

export function ModalNuevaAsignatura({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { cargarAsignaturas, seleccionar, avisar } = useEstado();
  const vacio = { nombre: '', nivel: '', destinatarios: '', idioma: 'español' };
  const [f, setF] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (abierto) setF(vacio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const a = await api.crearAsignatura(f);
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
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Nueva asignatura" descripcion="Define el contexto común de todos sus apuntes. Podrás completarlo después.">
      <form onSubmit={crear} className="space-y-4">
        <Campo etiqueta="Nombre">
          <Entrada autoFocus required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Biología" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nivel o curso">
            <Entrada value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value })} placeholder="2º Bachillerato" />
          </Campo>
          <Campo etiqueta="Idioma de los apuntes">
            <Entrada value={f.idioma} onChange={(e) => setF({ ...f, idioma: e.target.value })} />
          </Campo>
        </div>
        <Campo etiqueta="Destinatarios" ayuda="A quién van dirigidos. Cada documento puede indicar otros distintos.">
          <AreaTexto
            rows={2}
            value={f.destinatarios}
            onChange={(e) => setF({ ...f, destinatarios: e.target.value })}
            placeholder="Alumnado de 17-18 años que prepara la PAU; nivel medio, poco tiempo de estudio"
          />
        </Campo>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando}>
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
