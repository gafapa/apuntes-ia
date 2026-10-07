import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import type { Ajustes, Motor } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useEstado } from '../lib/estado';
import { Boton, Campo, Entrada, Modal, cx } from './ui';
import { TarjetaMotor } from './TarjetaMotor';
import { EditorAgentes } from './EditorAgentes';

export function ModalAjustes({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { ajustes, motores, cargarMotores, cargarAjustes, cargarAsignaturas, avisar } = useEstado();
  const [max, setMax] = useState(3);
  const [motor, setMotor] = useState<Motor>('claude');
  const [carpeta, setCarpeta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [comprobando, setComprobando] = useState(false);
  const [pestana, setPestana] = useState<'general' | 'agentes'>('general');
  const [agentes, setAgentes] = useState<Ajustes['agentes']>({});
  const [version, setVersion] = useState('');
  useEffect(() => {
    api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!abierto || !ajustes) return;
    setMax(ajustes.maxSimultaneos);
    setMotor(ajustes.motorPorDefecto);
    setCarpeta(ajustes.carpetaDatos);
    setAgentes(ajustes.agentes ?? {});
    cargarMotores().catch(() => {});
  }, [abierto, ajustes, cargarMotores]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const cambiaCarpeta = carpeta.trim() !== ajustes?.carpetaDatos;
      await api.guardarAjustes({ maxSimultaneos: max, motorPorDefecto: motor, carpetaDatos: carpeta, agentes });
      await cargarAjustes();
      if (cambiaCarpeta) {
        await cargarAsignaturas();
        useEstado.getState().seleccionar({});
      }
      avisar('Ajustes guardados', 'ok');
      onCerrar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Ajustes" descripcion={version && `Apuntes IA ${version}`} ancho="max-w-2xl">
      <div className="space-y-6">
        <div className="-mt-1 flex gap-1 border-b border-borde">
          {(
            [
              ['general', 'General'],
              ['agentes', 'Agentes'],
            ] as const
          ).map(([id, txt]) => (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium cursor-pointer',
                pestana === id ? 'border-acento text-acento' : 'border-transparent text-texto-2 hover:text-texto',
              )}
            >
              {txt}
            </button>
          ))}
        </div>
        {pestana === 'agentes' && <EditorAgentes valor={agentes} onCambio={setAgentes} />}
        {pestana === 'general' && (
        <>
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Asistentes de IA</h3>
            <Boton
              tam="sm"
              variante="fantasma"
              icono={<RefreshCw className={cx('size-3.5', comprobando && 'animate-spin')} />}
              onClick={async () => {
                setComprobando(true);
                await cargarMotores().catch(() => {});
                setComprobando(false);
              }}
            >
              Comprobar
            </Boton>
          </div>
          {motores?.map((m) => <TarjetaMotor key={m.motor} estado={m} />)}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Motor por defecto" ayuda="El que se usa si no eliges otro.">
            <div className="flex gap-1 rounded-lg bg-panel-2 p-1">
              {(['claude', 'codex'] as Motor[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotor(m)}
                  className={cx(
                    'flex-1 rounded-md py-1 text-sm font-medium cursor-pointer',
                    motor === m ? 'bg-panel shadow-sm' : 'text-texto-3 hover:text-texto',
                  )}
                >
                  {m === 'claude' ? 'Claude' : 'Codex'}
                </button>
              ))}
            </div>
          </Campo>
          <Campo etiqueta={`Agentes simultáneos: ${max}`} ayuda="Más agentes terminan antes, pero gastan la suscripción más rápido.">
            <input type="range" min={1} max={8} value={max} onChange={(e) => setMax(Number(e.target.value))} className="mt-2 w-full accent-[var(--acento)]" />
          </Campo>
        </section>

        <Campo etiqueta="Carpeta de datos" ayuda="Donde se guardan asignaturas y apuntes. Si la cambias, no se mueven los datos existentes.">
          <div className="flex gap-2">
            <Entrada value={carpeta} onChange={(e) => setCarpeta(e.target.value)} className="font-mono text-[13px]" />
            <Boton type="button" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpeta()} title="Abrir carpeta" />
          </div>
        </Campo>
        </>
        )}

        <div className="flex items-center justify-between pt-2">
          <Boton
            variante="fantasma"
            tam="sm"
            onClick={async () => {
              await api.guardarAjustes({ asistenteCompletado: false });
              await cargarAjustes();
              onCerrar();
            }}
          >
            Repetir asistente inicial
          </Boton>
          <div className="flex gap-2">
            <Boton onClick={onCerrar}>Cancelar</Boton>
            <Boton variante="primario" cargando={guardando} onClick={guardar}>
              Guardar
            </Boton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
