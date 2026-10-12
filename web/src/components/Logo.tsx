// Logotipo de la app (el mismo dibujo que build/icono.svg) y la estrella que marca el trabajo de la IA.

const PAGINA_IZQUIERDA = 'M13 21c6.5-2.2 12.5-1.6 17.5 1.6V49c-5-3-11-3.6-17.5-1.6Z';
const PAGINA_DERECHA = 'M51 21c-6.5-2.2-12.5-1.6-17.5 1.6V49c5-3 11-3.6 17.5-1.6Z';
const ESTRELLA_LOGO = 'M48 5.5c.8 5.4 3.6 8.2 9 9-5.4.8-8.2 3.6-9 9-.8-5.4-3.6-8.2-9-9 5.4-.8 8.2-3.6 9-9Z';

/** Cuaderno abierto con la estrella. `invertido`: en blanco, para ponerlo sobre el color de acento. */
export function Logo({ className, invertido }: { className?: string; invertido?: boolean }) {
  const fondo = invertido ? 'fill-white' : 'fill-acento';
  const paginas = invertido ? 'fill-acento' : 'fill-white';
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="17" className={fondo} />
      <path d={PAGINA_IZQUIERDA} className={paginas} />
      <path d={PAGINA_DERECHA} className={paginas} fillOpacity={invertido ? 0.75 : 0.86} />
      <path d={ESTRELLA_LOGO} className="fill-estrella" />
    </svg>
  );
}

/** Estrella de cuatro puntas (toma el color del texto). */
export function Estrella({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2.5c.8 5.4 3.6 8.2 9 9-5.4.8-8.2 3.6-9 9-.8-5.4-3.6-8.2-9-9 5.4-.8 8.2-3.6 9-9Z" fill="currentColor" />
    </svg>
  );
}
