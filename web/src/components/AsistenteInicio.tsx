import { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useEstado } from '../lib/estado';
import { Boton, Modal } from './ui';
import { TarjetaMotor } from './TarjetaMotor';

/** Asistente de primer arranque: comprueba Claude Code y Codex y explica cómo funciona la app. */
export function AsistenteInicio() {
  const { ajustes, motores, cargarMotores, cargarAjustes } = useEstado();
  const [paso, setPaso] = useState(0);
  const [comprobando, setComprobando] = useState(false);
  const abierto = ajustes !== undefined && !ajustes.asistenteCompletado;

  const comprobar = async () => {
    setComprobando(true);
    try {
      await cargarMotores();
    } finally {
      setComprobando(false);
    }
  };

  // Mientras está en el paso de motores, vuelve a comprobar cada pocos segundos
  // (el usuario puede estar instalando o iniciando sesión en la terminal)
  useEffect(() => {
    if (!abierto || paso !== 1) return;
    const i = setInterval(() => cargarMotores().catch(() => {}), 5000);
    return () => clearInterval(i);
  }, [abierto, paso, cargarMotores]);

  const listos = motores?.filter((m) => m.instalado && m.sesion) ?? [];

  const terminar = async () => {
    await api.guardarAjustes({
      asistenteCompletado: true,
      motorPorDefecto: listos.some((m) => m.motor === 'claude') ? 'claude' : listos[0]?.motor ?? 'claude',
    });
    await cargarAjustes();
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => {}}
      sinCerrar
      ancho="max-w-xl"
      titulo={['Bienvenido a Apuntes IA', 'Conecta tus asistentes de IA', 'Todo listo'][paso]}
      descripcion={
        [
          'Crea apuntes con un equipo de agentes de IA que investigan, redactan, revisan e ilustran en paralelo.',
          'La app usa Claude Code y/o Codex instalados en este equipo, con tu propia suscripción. No hace falta ninguna clave de API.',
          'Tus apuntes se guardan como archivos normales en tu equipo.',
        ][paso]
      }
    >
      {paso === 0 && (
        <div className="space-y-4">
          <ol className="space-y-3 text-sm">
            {[
              ['Crea una asignatura', 'con su nivel, destinatarios y contexto.'],
              ['Añade documentos de apuntes', 'uno por tema o unidad. Puedes aportar tu material o dejar que los agentes investiguen.'],
              ['Trabaja con los agentes', 'pídeles que propongan el índice, redacten, revisen o añadan diagramas, y supervisa lo que hacen en directo.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-acento-suave text-xs font-semibold text-acento">{i + 1}</span>
                <span>
                  <span className="font-medium">{t}</span> <span className="text-texto-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex justify-end pt-2">
            <Boton
              variante="primario"
              icono={<ArrowRight className="size-4" />}
              onClick={() => {
                setPaso(1);
                comprobar();
              }}
            >
              Empezar
            </Boton>
          </div>
        </div>
      )}

      {paso === 1 && (
        <div className="space-y-3">
          {motores ? (
            motores.map((m) => <TarjetaMotor key={m.motor} estado={m} />)
          ) : (
            <div className="py-8 text-center text-sm text-texto-3">Comprobando…</div>
          )}
          <p className="text-[12.5px] text-texto-3">
            Basta con uno de los dos. Con ambos, los agentes se reparten el trabajo; las imágenes generadas con IA necesitan Codex.
          </p>
          <div className="flex items-center justify-between pt-2">
            <Boton variante="fantasma" icono={<RefreshCw className={comprobando ? 'size-4 animate-spin' : 'size-4'} />} onClick={comprobar}>
              Volver a comprobar
            </Boton>
            <div className="flex gap-2">
              {listos.length === 0 && (
                <Boton variante="fantasma" onClick={() => setPaso(2)}>
                  Lo haré después
                </Boton>
              )}
              <Boton variante="primario" disabled={listos.length === 0} icono={<ArrowRight className="size-4" />} onClick={() => setPaso(2)}>
                Continuar
              </Boton>
            </div>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-borde bg-panel-2 px-4 py-3">
            <div className="text-xs text-texto-3">Carpeta de datos</div>
            <div className="mt-0.5 font-mono text-[13px] break-all">{ajustes?.carpetaDatos}</div>
          </div>
          <p className="text-sm text-texto-2">
            Puedes cambiar la carpeta, el número de agentes simultáneos y el motor por defecto en <b>Ajustes</b> (abajo a la izquierda).
          </p>
          <div className="flex justify-between pt-2">
            <Boton variante="fantasma" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpeta()}>
              Abrir carpeta
            </Boton>
            <Boton variante="primario" onClick={terminar}>
              Empezar a crear apuntes
            </Boton>
          </div>
        </div>
      )}
    </Modal>
  );
}
