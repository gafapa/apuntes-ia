// Selección de la enseñanza (etapa, curso, modalidad o ciclo), la asignatura y el idioma,
// a partir del catálogo oficial. Siempre se puede escribir una asignatura que no esté en la lista.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { CURSOS, ETAPAS, IDIOMAS, MODALIDADES_BACHILLERATO, esFP, materias, type Etapa, type Materia } from '../../../shared/catalogo/educacion';
import { Campo, Entrada, cx } from './ui';

type ModuloCatalogoFP = typeof import('../../../shared/catalogo/fp');
let catalogoFP: Promise<ModuloCatalogoFP> | undefined;

/** El catálogo de FP pesa mucho: se carga aparte, al abrir el selector, y no al arrancar la app. */
function useCatalogoFP(enabled: boolean) {
  const [m, setM] = useState<ModuloCatalogoFP>();
  useEffect(() => {
    if (!enabled) return;
    let vigente = true;
    (catalogoFP ??= import('../../../shared/catalogo/fp')).then((x) => vigente && setM(x)).catch(() => (catalogoFP = undefined));
    return () => {
      vigente = false;
    };
  }, [enabled]);
  return m;
}

export interface ValorEnsenanza {
  etapa?: Etapa;
  curso?: string;
  modalidad?: string;
  familia?: string;
  titulo?: string;
  nombre: string; // asignatura o módulo
  nivelLibre: string; // solo en «Otra (libre)»
  idioma: string;
}

const claseSelect =
  'h-9 w-full appearance-none rounded-lg border border-borde bg-panel pr-8 pl-3 text-sm text-texto outline-none focus:border-acento focus:ring-3 focus:ring-acento/15 cursor-pointer';

/** Desplegable; `vacio` es el texto de la opción sin valor (sin él, no hay opción vacía). */
function Select({ valor, onCambio, opciones, vacio }: { valor?: string; onCambio: (v: string) => void; opciones: { id: string; nombre: string }[]; vacio?: string }) {
  return (
    <div className="relative">
      <select className={claseSelect} value={valor ?? ''} onChange={(e) => onCambio(e.target.value)}>
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-texto-3" />
    </div>
  );
}

/** Campo de texto con sugerencias agrupadas; admite cualquier texto. */
function Combo({ valor, onCambio, sugerencias, placeholder }: { valor: string; onCambio: (v: string) => void; sugerencias: Materia[]; placeholder: string }) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtradas = useMemo(() => {
    const q = normal(valor.trim());
    // Si el texto coincide exactamente con una sugerencia, se muestran todas (para poder cambiar)
    if (!q || sugerencias.some((s) => normal(s.nombre) === q)) return sugerencias;
    return sugerencias.filter((s) => normal(s.nombre).includes(q));
  }, [valor, sugerencias]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const elegir = (s: string) => {
    onCambio(s);
    setAbierto(false);
  };

  let grupoPrevio = '';
  return (
    <div ref={caja} className="relative">
      <Entrada
        value={valor}
        placeholder={placeholder}
        onFocus={() => setAbierto(true)}
        onChange={(e) => {
          onCambio(e.target.value);
          setAbierto(true);
          setActivo(0);
        }}
        onKeyDown={(e) => {
          if (!abierto || !filtradas.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActivo((a) => Math.min(a + 1, filtradas.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            elegir(filtradas[activo].nombre);
          } else if (e.key === 'Escape') {
            setAbierto(false);
          }
        }}
        className="pr-8"
      />
      <ChevronDown className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-texto-3" />
      {abierto && filtradas.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-borde bg-panel py-1 shadow-suave">
          {filtradas.map((s, i) => {
            const cabecera = s.grupo !== grupoPrevio ? s.grupo : null;
            grupoPrevio = s.grupo;
            return (
              <div key={`${s.grupo}-${s.nombre}`}>
                {cabecera && <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-texto-3 uppercase">{cabecera}</div>}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(s.nombre)}
                  onMouseEnter={() => setActivo(i)}
                  className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer', i === activo && 'bg-acento-suave text-acento-texto')}
                >
                  <span className="flex-1">{s.nombre}</span>
                  {s.nombre === valor && <Check className="size-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SelectorEnsenanza({ valor, onCambio }: { valor: ValorEnsenanza; onCambio: (v: ValorEnsenanza) => void }) {
  const v = valor;
  const set = (c: Partial<ValorEnsenanza>) => onCambio({ ...v, ...c });
  const fp = esFP(v.etapa);
  const catalogo = useCatalogoFP(fp);
  const familias = useMemo(() => (fp && catalogo ? catalogo.familiasFP(v.etapa!) : []), [fp, catalogo, v.etapa]);
  const titulos = familias.find((f) => f.nombre === v.familia)?.titulos ?? [];
  const titulo = titulos.find((t) => t.nombre === v.titulo);
  const otroIdioma = !IDIOMAS.includes(v.idioma);

  const sugerencias: Materia[] = useMemo(() => {
    if (fp) return (titulo?.modulos ?? []).map((m) => ({ nombre: m.nombre, grupo: 'Módulos profesionales' }));
    if (!v.etapa || v.etapa === 'libre' || !v.curso) return [];
    return materias(v.etapa, v.curso, { modalidad: v.modalidad, idioma: v.idioma });
  }, [fp, titulo, v.etapa, v.curso, v.modalidad, v.idioma]);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Enseñanza</div>
        <div className="grid grid-cols-4 gap-1.5">
          {ETAPAS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => e.id !== v.etapa && set({ etapa: e.id, curso: undefined, modalidad: undefined, familia: undefined, titulo: undefined })}
              className={cx(
                'rounded-lg border px-2 py-2 text-left text-[12.5px] leading-tight transition-colors cursor-pointer',
                v.etapa === e.id ? 'border-acento bg-acento-suave font-medium text-acento-texto' : 'border-borde hover:bg-panel-2',
                e.id === 'libre' && 'border-dashed',
              )}
            >
              {e.corto}
              {e.edades && <span className="block text-[11px] font-normal text-texto-3">{e.edades}</span>}
            </button>
          ))}
        </div>
      </div>

      {(v.etapa === 'primaria' || v.etapa === 'eso' || v.etapa === 'bachillerato') && (
        <div className={cx('grid gap-3', v.etapa === 'bachillerato' ? 'grid-cols-2' : 'grid-cols-1')}>
          <Campo etiqueta="Curso">
            <Select valor={v.curso} onCambio={(curso) => set({ curso })} opciones={CURSOS[v.etapa]!} vacio="Elige el curso" />
          </Campo>
          {v.etapa === 'bachillerato' && (
            <Campo etiqueta="Modalidad">
              <Select
                valor={v.modalidad}
                onCambio={(modalidad) => set({ modalidad })}
                opciones={MODALIDADES_BACHILLERATO}
                vacio="Todas las modalidades"
              />
            </Campo>
          )}
        </div>
      )}

      {fp && (
        <div className="grid gap-3">
          <Campo etiqueta="Familia profesional">
            <Select
              valor={v.familia}
              onCambio={(familia) => set({ familia, titulo: undefined })}
              opciones={familias.map((f) => ({ id: f.nombre, nombre: `${f.nombre} (${f.titulos.length})` }))}
              vacio="Elige la familia"
            />
          </Campo>
          {v.familia && (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Campo etiqueta="Título (ciclo formativo)">
                <Select valor={v.titulo} onCambio={(t) => set({ titulo: t })} opciones={titulos.map((t) => ({ id: t.nombre, nombre: t.nombre }))} vacio="Elige el título" />
              </Campo>
              <Campo etiqueta="Curso">
                <Select valor={v.curso} onCambio={(curso) => set({ curso })} opciones={CURSOS[v.etapa!]!} vacio="—" />
              </Campo>
            </div>
          )}
          {titulo && (
            <a href={titulo.url} target="_blank" rel="noreferrer" className="-mt-1 flex items-center gap-1 text-[12px] text-texto-3 hover:text-acento-texto">
              {titulo.horas ? `${titulo.horas} horas · ` : ''}
              {titulo.modulos.length} módulos · ficha oficial en TodoFP <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {v.etapa === 'libre' && (
        <Campo etiqueta="Nivel o curso" ayuda="Universidad, oposiciones, academia, formación de empresa, enseñanzas artísticas o de idiomas…">
          <Entrada value={v.nivelLibre} onChange={(e) => set({ nivelLibre: e.target.value })} placeholder="2º de Grado en Biología" />
        </Campo>
      )}

      <Campo
        etiqueta={fp ? 'Módulo profesional' : 'Asignatura'}
        ayuda={
          sugerencias.length
            ? `Elige una de la lista oficial o escribe otra (las comunidades autónomas pueden tener materias propias).`
            : fp && !titulo
              ? 'Elige el título para ver sus módulos, o escribe el nombre.'
              : undefined
        }
      >
        <Combo
          valor={v.nombre}
          onCambio={(nombre) => set({ nombre })}
          sugerencias={sugerencias}
          placeholder={fp ? 'Programación' : v.etapa === 'libre' ? 'Bioquímica' : 'Biología y Geología'}
        />
      </Campo>

      <Campo etiqueta="Idioma de los apuntes">
        <div className={cx('grid gap-2', otroIdioma && 'grid-cols-2')}>
          <Select
            valor={otroIdioma ? '__otro' : v.idioma || 'Castellano'}
            onCambio={(x) => set({ idioma: x === '__otro' ? '' : x || 'Castellano' })}
            opciones={[...IDIOMAS.map((i) => ({ id: i, nombre: i })), { id: '__otro', nombre: 'Otro…' }]}
          />
          {otroIdioma && <Entrada autoFocus value={v.idioma} onChange={(e) => set({ idioma: e.target.value })} placeholder="Inglés, francés…" />}
        </div>
      </Campo>
      <p className="text-[11.5px] text-texto-3">
        Catálogo oficial: Reales Decretos 157/2022, 217/2022 y 243/2022 (BOE) y títulos de FP de TodoFP{catalogo && ` (${catalogo.CATALOGO_FP.generado})`}.
      </p>
    </div>
  );
}
