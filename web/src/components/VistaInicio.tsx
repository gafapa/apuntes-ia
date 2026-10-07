import { useState } from 'react';
import { BookOpen, FileText, Plus } from 'lucide-react';
import { useEstado } from '../lib/estado';
import { Boton, Vacio } from './ui';
import { ModalNuevaAsignatura } from './Modales';

export function VistaInicio() {
  const { asignaturas, seleccionar } = useEstado();
  const [nueva, setNueva] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-10 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Tus asignaturas</h1>
        <p className="mt-1 text-texto-2">Cada asignatura guarda su contexto y sus destinatarios; dentro creas los documentos de apuntes.</p>

        {asignaturas.length === 0 ? (
          <Vacio
            icono={<BookOpen className="size-6" />}
            titulo="Aún no tienes asignaturas"
            texto="Empieza creando una. Después podrás añadir documentos de apuntes y pedir a los agentes que trabajen en ellos."
            accion={
              <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setNueva(true)}>
                Nueva asignatura
              </Boton>
            }
          />
        ) : (
          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {asignaturas.map((a) => (
              <button
                key={a.id}
                onClick={() => seleccionar({ asignatura: a.id })}
                className="group relative overflow-hidden rounded-xl border border-borde bg-panel p-5 text-left shadow-suave transition-all hover:-translate-y-0.5 hover:border-acento/50 cursor-pointer"
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: a.color }} />
                <div className="font-semibold">{a.nombre}</div>
                <div className="mt-0.5 text-[13px] text-texto-3">{a.nivel || 'Sin nivel indicado'}</div>
                {a.destinatarios && <p className="mt-3 line-clamp-2 text-[13px] text-texto-2">{a.destinatarios}</p>}
                <div className="mt-4 flex items-center gap-1.5 text-[12.5px] text-texto-3">
                  <FileText className="size-3.5" />
                  {a.documentos.length === 1 ? '1 documento' : `${a.documentos.length} documentos`}
                </div>
              </button>
            ))}
            <button
              onClick={() => setNueva(true)}
              className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borde text-texto-3 transition-colors hover:border-acento hover:text-acento cursor-pointer"
            >
              <Plus className="size-5" />
              Nueva asignatura
            </button>
          </div>
        )}
      </div>
      <ModalNuevaAsignatura abierto={nueva} onCerrar={() => setNueva(false)} />
    </div>
  );
}
