import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import type { Motor, Tokens } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useEstado } from '../lib/estado';
import { abreviar } from '../lib/formato';
import { confirmar, cx } from './ui';

const cero: Tokens = { entrada: 0, salida: 0, cache: 0 };
const suma = (l: Tokens[]) => l.reduce((a, b) => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, cache: a.cache + b.cache }), cero);

/** «↓ 12 k ↑ 1,3 k» */
export function ParTokens({ t, className }: { t: Tokens; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 tabular-nums', className)} title={`Entrada: ${t.entrada.toLocaleString('es')} tokens (${t.cache.toLocaleString('es')} de caché) · Salida: ${t.salida.toLocaleString('es')} tokens`}>
      <span className="inline-flex items-center">
        <ArrowDown className="size-3" />
        {abreviar(t.entrada)}
      </span>
      <span className="inline-flex items-center">
        <ArrowUp className="size-3" />
        {abreviar(t.salida)}
      </span>
    </span>
  );
}

/** Contador de la barra lateral: tokens de hoy, con desglose al pulsarlo. */
export function ContadorTokensPie() {
  const contador = useEstado((s) => s.tokens);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  if (!contador) return null;

  const motores: Motor[] = ['claude', 'codex'];
  const hoy = suma(motores.map((m) => contador.hoy.porMotor[m] ?? cero));
  const total = suma(motores.map((m) => contador.total[m] ?? cero));

  const Fila = ({ etiqueta, t, fuerte }: { etiqueta: string; t: Tokens; fuerte?: boolean }) => (
    <tr className={cx(fuerte && 'font-semibold text-texto')}>
      <td className="py-0.5 pr-3">{etiqueta}</td>
      <td className="py-0.5 pr-3 text-right tabular-nums">{t.entrada.toLocaleString('es')}</td>
      <td className="py-0.5 pr-3 text-right tabular-nums text-texto-3">{t.cache.toLocaleString('es')}</td>
      <td className="py-0.5 text-right tabular-nums">{t.salida.toLocaleString('es')}</td>
    </tr>
  );

  const Tabla = ({ titulo, datos, totalFila }: { titulo: string; datos: Record<Motor, Tokens>; totalFila: Tokens }) => (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">{titulo}</div>
      <table className="w-full text-[12px] text-texto-2">
        <thead>
          <tr className="text-[10.5px] text-texto-3">
            <th className="pr-3 text-left font-normal" />
            <th className="pr-3 text-right font-normal">Entrada</th>
            <th className="pr-3 text-right font-normal">de caché</th>
            <th className="text-right font-normal">Salida</th>
          </tr>
        </thead>
        <tbody>
          <Fila etiqueta="Claude" t={datos.claude ?? cero} />
          <Fila etiqueta="Codex" t={datos.codex ?? cero} />
          <Fila etiqueta="Total" t={totalFila} fuerte />
        </tbody>
      </table>
    </div>
  );

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto(!abierto)}
        className="flex w-full items-center justify-between rounded-md text-[11.5px] text-texto-3 hover:text-texto cursor-pointer"
        title="Tokens consumidos hoy (entrada ↓, salida ↑). Pulsa para ver el desglose."
      >
        <span>Tokens hoy</span>
        <ParTokens t={hoy} />
      </button>
      {abierto && (
        <div className="aparecer absolute bottom-full left-0 z-30 mb-2 w-80 space-y-3 rounded-xl border border-borde bg-panel p-4 shadow-suave">
          <Tabla titulo="Hoy" datos={contador.hoy.porMotor} totalFila={hoy} />
          <Tabla
            titulo={`Total desde el ${new Date(contador.desde).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            datos={contador.total}
            totalFila={total}
          />
          <p className="text-[11px] leading-snug text-texto-3">
            La entrada incluye los tokens leídos de caché, que cuentan menos para el límite de la suscripción.
          </p>
          <button
            onClick={async () => {
              if (await confirmar('¿Poner a cero el contador de tokens?', { boton: 'Poner a cero', peligro: true })) {
                useEstado.setState({ tokens: await api.reiniciarTokens() });
              }
            }}
            className="flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-error cursor-pointer"
          >
            <RotateCcw className="size-3" /> Poner a cero
          </button>
        </div>
      )}
    </div>
  );
}
