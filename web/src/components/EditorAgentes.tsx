import { useEffect, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type { Ajustes, InfoAgente, Motor } from '../../../shared/tipos';
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

  const cambiar = (id: string, c: { motor?: Motor; instrucciones?: string }) => {
    const actual = { ...valor[id], ...c };
    const nuevo = { ...valor };
    if (!actual.motor && !actual.instrucciones?.trim()) delete nuevo[id];
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
        const personalizado = !!p.instrucciones?.trim() || (!!p.motor && p.motor !== ag.motor);
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
              <div className="border-t border-borde px-3 py-3">
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
                    onClick={() => cambiar(ag.id, { motor: undefined, instrucciones: undefined })}
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
