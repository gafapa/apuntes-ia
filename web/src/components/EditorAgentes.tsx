import { useEffect, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type { Ajustes, Esfuerzo, InfoAgente, Motor } from '../../../shared/tipos';

const ESFUERZOS: { id: Esfuerzo; nombre: string }[] = [
  { id: 'low', nombre: 'Bajo' },
  { id: 'medium', nombre: 'Medio' },
  { id: 'high', nombre: 'Alto' },
];

const MODELOS_CLAUDE = [
  { id: '', nombre: 'Predeterminado' },
  { id: 'opus', nombre: 'Opus (el mejor)' },
  { id: 'sonnet', nombre: 'Sonnet (equilibrado)' },
  { id: 'haiku', nombre: 'Haiku (el más ligero)' },
];
import { api } from '../lib/api';
import { AreaTexto, Insignia, cx } from './ui';

type Personalizacion = Ajustes['agentes'];

/** Permite elegir el motor de cada agente y reescribir sus instrucciones. */
export function EditorAgentes({ valor, onCambio }: { valor: Personalizacion; onCambio: (v: Personalizacion) => void }) {
  const [agentes, setAgentes] = useState<InfoAgente[]>([]);
  const [abierto, setAbierto] = useState<string>();
  useEffect(() => {
    api.agentes().then(setAgentes).catch(() => {});
  }, []);

  const cambiar = (id: string, c: Partial<Ajustes['agentes'][string]>) => {
    const actual = { ...valor[id], ...c };
    const nuevo = { ...valor };
    if (!actual.motor && !actual.instrucciones?.trim() && !actual.esfuerzo && !actual.modelo) delete nuevo[id];
    else nuevo[id] = actual;
    onCambio(nuevo);
  };

  return (
    <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
      <p className="mb-3 text-[13px] text-texto-2">
        Elige con qué motor trabaja cada agente y ajusta sus instrucciones (su papel y su criterio). El formato de lo que entregan lo controla la app,
        así que puedes cambiar el texto con libertad.
      </p>
      {agentes.map((ag) => {
        const p = valor[ag.id] ?? {};
        const motor = ag.soloMotor ?? p.motor ?? ag.motor;
        const personalizado = !!p.instrucciones?.trim() || (!!p.motor && p.motor !== ag.motor) || !!p.esfuerzo || !!p.modelo;
        const esfuerzo = p.esfuerzo ?? ag.esfuerzo;
        const esteAbierto = abierto === ag.id;
        return (
          <div key={ag.id} className={cx('rounded-lg border', esteAbierto ? 'border-acento/40' : 'border-borde')}>
            <div className="flex items-center gap-3 px-3 py-2">
              <button onClick={() => setAbierto(esteAbierto ? undefined : ag.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer">
                <ChevronDown className={cx('size-3.5 shrink-0 text-texto-3 transition-transform', esteAbierto && 'rotate-180')} />
                <span className="min-w-0">
                  <span className="text-sm font-medium">{ag.nombre}</span>
                  {personalizado && <Insignia color="acento" className="ml-2">personalizado</Insignia>}
                  <span className="block truncate text-[12px] text-texto-3">{ag.descripcion}</span>
                </span>
              </button>
              <div className="flex shrink-0 gap-0.5 rounded-lg bg-panel-2 p-0.5">
                {(['claude', 'codex'] as Motor[]).map((m) => (
                  <button
                    key={m}
                    disabled={!!ag.soloMotor}
                    onClick={() => cambiar(ag.id, { motor: m === ag.motor ? undefined : m })}
                    className={cx(
                      'rounded-md px-2 py-0.5 text-[12px] font-medium cursor-pointer disabled:cursor-not-allowed',
                      motor === m ? 'bg-panel shadow-sm' : 'text-texto-3 hover:text-texto',
                    )}
                  >
                    {m === 'claude' ? 'Claude' : 'Codex'}
                  </button>
                ))}
              </div>
            </div>
            {esteAbierto && (
              <div className="space-y-3 border-t border-borde px-3 py-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
                  <label className="flex items-center gap-2">
                    <span className="text-texto-3" title="Cuánto razona antes de responder: más esfuerzo, mejor resultado y más tokens">
                      Esfuerzo
                    </span>
                    <span className="flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
                      {ESFUERZOS.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => cambiar(ag.id, { esfuerzo: e.id === ag.esfuerzo ? undefined : e.id })}
                          className={cx('rounded-md px-2 py-0.5 cursor-pointer', esfuerzo === e.id ? 'bg-panel font-medium shadow-sm' : 'text-texto-3 hover:text-texto')}
                        >
                          {e.nombre}
                        </button>
                      ))}
                    </span>
                  </label>
                  {motor === 'claude' && (
                    <label className="flex items-center gap-2">
                      <span className="text-texto-3">Modelo</span>
                      <select
                        value={p.modelo ?? ''}
                        onChange={(e) => cambiar(ag.id, { modelo: e.target.value || undefined })}
                        className="h-7 rounded-md border border-borde bg-panel px-2 text-[12.5px] outline-none focus:border-acento cursor-pointer"
                      >
                        {MODELOS_CLAUDE.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <AreaTexto
                  rows={8}
                  className="font-mono text-[12.5px]"
                  value={p.instrucciones ?? ag.instrucciones}
                  onChange={(e) => cambiar(ag.id, { instrucciones: e.target.value === ag.instrucciones ? undefined : e.target.value })}
                />
                {ag.id === 'ilustrador' && (
                  <p className="mt-1.5 text-[12px] text-texto-3">Las imágenes generadas con IA siempre usan Codex, sea cual sea el motor elegido.</p>
                )}
                {personalizado && (
                  <button
                    onClick={() => cambiar(ag.id, { motor: undefined, instrucciones: undefined, esfuerzo: undefined, modelo: undefined })}
                    className="mt-2 flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-acento cursor-pointer"
                  >
                    <RotateCcw className="size-3" /> Restaurar valores por defecto
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
