import { useEffect, useState } from 'react';
import { Check, Copy, LogIn, Download } from 'lucide-react';
import type { EstadoMotor, Motor } from '../../../shared/tipos';
import { api } from '../lib/api';
import { Boton, Insignia } from './ui';

const INFO: Record<Motor, { nombre: string; empresa: string; uso: string }> = {
  claude: { nombre: 'Claude Code', empresa: 'Anthropic', uso: 'Redacción, investigación y revisión' },
  codex: { nombre: 'Codex', empresa: 'OpenAI', uso: 'Revisión de calidad y generación de imágenes' },
};

/** Estado de un motor con botones para instalarlo o iniciar sesión. */
export function TarjetaMotor({ estado }: { estado?: EstadoMotor & { motor: Motor } }) {
  const motor = estado!.motor;
  const info = INFO[motor];
  const [comandos, setComandos] = useState<{ instalar: string; sesion: string }>();
  const [copiado, setCopiado] = useState(false);
  const listo = estado?.instalado && estado.sesion;

  useEffect(() => {
    api.comandosMotor(motor).then(setComandos).catch(() => {});
  }, [motor, estado?.instalado]);

  const copiar = (t: string) => {
    navigator.clipboard.writeText(t);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  };

  return (
    <div className="rounded-2xl border border-borde bg-panel p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-panel-2 font-titulo text-[18px] font-extrabold">{motor === 'claude' ? 'C' : 'Cx'}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[16px] font-semibold whitespace-nowrap">{info.nombre}</span>
            <span className="text-xs whitespace-nowrap text-texto-3">de {info.empresa}</span>
          </div>
          <div className="text-[13.5px] text-texto-2">{info.uso}</div>
          {estado?.version && <div className="mt-0.5 text-[11.5px] text-texto-3">{estado.version}</div>}
        </div>
        {listo ? (
          <Insignia color="ok">
            <Check className="size-3" /> Listo
          </Insignia>
        ) : estado?.instalado ? (
          <Insignia color="aviso">Falta iniciar sesión</Insignia>
        ) : (
          <Insignia>No instalado</Insignia>
        )}
      </div>

      {!listo && comandos && (
        <div className="mt-4 space-y-2.5 border-t border-borde pt-4">
          {!estado?.instalado ? (
            <>
              <p className="text-[12.5px] text-texto-2">
                {motor === 'codex'
                  ? 'Se instala con npm (necesita Node.js). Pulsa «Instalar» para abrir una terminal que lo hace por ti.'
                  : 'Pulsa «Instalar» para abrir una terminal con el instalador oficial.'}
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 font-mono text-[12px]">
                <span className="min-w-0 flex-1 truncate">{comandos.instalar}</span>
                <button onClick={() => copiar(comandos.instalar)} title="Copiar" className="text-texto-3 hover:text-texto cursor-pointer">
                  {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
              <Boton tam="sm" variante="primario" icono={<Download className="size-3.5" />} onClick={() => api.accionMotor(motor, 'instalar')}>
                Instalar
              </Boton>
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-texto-2">
                Inicia sesión con tu cuenta de {motor === 'claude' ? 'Claude (Pro o Max)' : 'ChatGPT (Plus o Pro)'}. Se abrirá una terminal y después el navegador.
              </p>
              <Boton tam="sm" variante="primario" icono={<LogIn className="size-3.5" />} onClick={() => api.accionMotor(motor, 'sesion')}>
                Iniciar sesión
              </Boton>
            </>
          )}
        </div>
      )}
    </div>
  );
}
