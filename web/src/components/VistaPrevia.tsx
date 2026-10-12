import { useEffect, useMemo, useRef, useState } from 'react';
import { dibujarDiagramas, renderizar } from '../lib/markdown';
import { useEstado } from '../lib/estado';
import { Visor, type ContenidoVisor } from './Visor';
import { Estrella } from './Logo';

/** Rango de líneas [desde, hasta) de un bloque de la vista previa (atributo data-l). */
function lineasDe(el: Element): [number, number] | undefined {
  const m = el.getAttribute('data-l')?.match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

const FIGURAS = 'figure, .mermaid, .molecula, .bloque-dibujado, table';

/** El bloque de primer nivel que es una figura (imagen, diagrama, mapa, molécula o tabla) y contiene `el`. */
function figuraDe(el: Element | null, raiz: HTMLElement): HTMLElement | undefined {
  let b = el?.closest('[data-l]') ?? null;
  while (b && b.parentElement !== raiz) b = b.parentElement?.closest('[data-l]') ?? null;
  if (!b || !lineasDe(b)) return;
  return b.matches(FIGURAS) || b.querySelector(':scope > img') ? (b as HTMLElement) : undefined;
}

/** Nombre corto de una figura: su pie, o qué es. */
function nombreFigura(b: HTMLElement): string {
  const pie = b.querySelector('figcaption')?.textContent || (b.nextElementSibling?.matches('p.pie') ? b.nextElementSibling.textContent : '');
  if (pie?.trim()) return pie.trim();
  if (b.matches('.mermaid')) return 'Diagrama';
  if (b.matches('.molecula')) return 'Molécula';
  if (b.matches('table')) return 'Tabla';
  if (b.matches('.bloque-dibujado')) return b.dataset.tipo === 'mapa' ? 'Mapa' : 'Figura';
  return 'Imagen';
}

/**
 * Vista previa de Markdown con fórmulas y diagramas. `base` es la URL de la carpeta del documento.
 * Con `seccion`, se puede seleccionar texto (arrastrando), una figura (botón «Pedir cambios» al pasar
 * el ratón) o elementos enteros (Ctrl+clic), y el chat de la derecha actúa solo sobre ese fragmento.
 */
export function VistaPrevia({ texto, base, seccion }: { texto: string; base: string; seccion?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderizar(texto, base), [texto, base]);
  const [ampliado, setAmpliado] = useState<ContenidoVisor>();
  const [figura, setFigura] = useState<{ el: HTMLElement; top: number; left: number }>();
  const seleccion = useEstado((s) => (seccion && s.seleccionTexto?.seccion === seccion ? s.seleccionTexto : undefined));

  useEffect(() => {
    if (!ref.current) return;
    const t = setTimeout(() => ref.current && dibujarDiagramas(ref.current), 150);
    return () => clearTimeout(t);
  }, [html]);
  useEffect(() => setFigura(undefined), [html]);

  // Resaltar los bloques seleccionados (también tras volver a dibujar la vista)
  useEffect(() => {
    if (!ref.current) return;
    for (const el of ref.current.querySelectorAll('[data-l]')) {
      const l = lineasDe(el);
      el.classList.toggle('seleccionado', !!seleccion && !!l && l[0] < seleccion.hasta && l[1] > seleccion.desde);
    }
  }, [html, seleccion]);

  const seleccionar = (desde: number, hasta: number, visible: string, esFigura = false) => {
    if (!seccion) return;
    const lineas = texto.split('\n');
    useEstado.setState({
      seleccionTexto: { seccion, desde, hasta, fragmento: lineas.slice(desde, hasta).join('\n').trim(), texto: visible.trim(), ...(esFigura && { figura: true }) },
    });
  };

  // Arrastrar para seleccionar texto: se toman los bloques que toca la selección
  const alSoltar = () => {
    if (!seccion || !ref.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const rango = sel.getRangeAt(0);
    if (!ref.current.contains(rango.commonAncestorContainer)) return;
    const tocados = [...ref.current.children].filter((el) => el.hasAttribute('data-l') && rango.intersectsNode(el));
    const lineas = tocados.map(lineasDe).filter((l): l is [number, number] => !!l);
    if (!lineas.length) return;
    seleccionar(Math.min(...lineas.map((l) => l[0])), Math.max(...lineas.map((l) => l[1])), sel.toString());
  };

  // «Pedir cambios» en una figura: se selecciona con su pie y su referencia, y el cursor va al chat
  const pedirCambios = (b: HTMLElement) => {
    let [desde, hasta] = lineasDe(b)!;
    for (let sig = b.nextElementSibling; sig?.matches('p.pie'); sig = sig.nextElementSibling) {
      const l = lineasDe(sig);
      if (l) hasta = Math.max(hasta, l[1]);
    }
    for (let ant = b.previousElementSibling; ant?.matches('p.pie') && !ant.matches('.referencia'); ant = ant.previousElementSibling) {
      const l = lineasDe(ant); // pie de tabla encima
      if (l) desde = Math.min(desde, l[0]);
    }
    seleccionar(desde, hasta, nombreFigura(b), true);
    useEstado.setState({ enfocarChat: Date.now() });
  };

  const alMover = (e: React.MouseEvent) => {
    if (!seccion || !ref.current || !caja.current) return;
    const b = figuraDe(e.target as Element, ref.current);
    if (!b) return setFigura(undefined);
    if (figura?.el === b) return;
    const r = b.getBoundingClientRect();
    const c = caja.current.getBoundingClientRect();
    setFigura({ el: b, top: r.top - c.top + 8, left: Math.min(r.right, c.right) - c.left - 8 });
  };

  // Clic en una imagen o un diagrama: verlo ampliado. Ctrl+clic: seleccionar el elemento entero
  // (o añadirlo a la selección, que abarca desde el primero hasta el último)
  const alPulsar = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (seccion && (e.ctrlKey || e.metaKey)) {
      const bloque = el.closest('[data-l]');
      const l = bloque && ref.current?.contains(bloque) ? lineasDe(bloque) : undefined;
      if (!l) return;
      e.preventDefault();
      const nombre = bloque!.matches('figure, .mermaid, .molecula, table') ? `[${bloque!.querySelector('figcaption')?.textContent || bloque!.tagName.toLowerCase()}]` : bloque!.textContent ?? '';
      if (seleccion) seleccionar(Math.min(seleccion.desde, l[0]), Math.max(seleccion.hasta, l[1]), `${seleccion.texto} … ${nombre}`);
      else seleccionar(l[0], l[1], nombre);
      return;
    }
    const img = el.closest('img');
    if (img) return setAmpliado({ tipo: 'imagen', src: img.src });
    const svg = el.closest('.mermaid, .molecula, .bloque-dibujado')?.querySelector('svg');
    if (svg) setAmpliado({ tipo: 'svg', html: svg.outerHTML });
  };

  // Esc: quitar la selección
  useEffect(() => {
    if (!seleccion) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && useEstado.setState({ seleccionTexto: undefined });
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [seleccion]);

  const figuraSeleccionada = (() => {
    const l = figura && lineasDe(figura.el);
    return !!seleccion?.figura && !!l && l[0] >= seleccion.desde && l[1] <= seleccion.hasta;
  })();

  return (
    <div ref={caja} className="relative" onMouseLeave={() => setFigura(undefined)}>
      <div
        ref={ref}
        className="apunte"
        onClick={alPulsar}
        onMouseUp={alSoltar}
        onMouseMove={alMover}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {figura && (
        <button
          type="button"
          onClick={() => pedirCambios(figura.el)}
          title="Selecciona esta figura con su pie para pedir cambios a un agente en el chat de la derecha"
          className="aparecer absolute z-10 inline-flex -translate-x-full items-center gap-1.5 rounded-full bg-acento px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white shadow-suave transition-colors hover:bg-acento-2 cursor-pointer"
          style={{ top: figura.top, left: figura.left }}
        >
          <Estrella className="size-3.5 text-estrella" />
          {figuraSeleccionada ? 'Seleccionada' : 'Pedir cambios'}
        </button>
      )}
      <Visor contenido={ampliado} onCerrar={() => setAmpliado(undefined)} />
    </div>
  );
}
