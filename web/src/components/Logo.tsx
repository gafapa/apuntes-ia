// App identity: a folded note and an amber pencil, matching build/icono.svg.

/** Inverted colors keep the mark legible on an accent-colored surface. */
export function Logo({ className, invertido }: { className?: string; invertido?: boolean }) {
  const fondo = invertido ? 'fill-white' : 'fill-acento';
  const paginas = invertido ? 'fill-acento' : 'fill-white';
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="16" className={fondo} />
      <path d="M18 11h20l11 11v27a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z" className={paginas} />
      <path d="M38 11v8a3 3 0 0 0 3 3h8Z" className={invertido ? 'fill-white/30' : 'fill-acento/20'} />
      <path d="M22 25h8M22 33h12M22 41h7" fill="none" className={invertido ? 'stroke-white' : 'stroke-acento'} strokeWidth="3.5" strokeLinecap="round" />
      <path d="m32 49 3-12 15-15a4.95 4.95 0 0 1 7 7L42 44Z" className={invertido ? 'fill-white stroke-white' : 'fill-acento stroke-acento'} strokeWidth="5" strokeLinejoin="round" />
      <path d="m35 37 15-15a4.95 4.95 0 0 1 7 7L42 44Z" className="fill-estrella" />
      <path d="m35 37-3 12 10-5Z" className={paginas} />
      <path d="m33.3 43.7-1.3 5.3 4.8-2.4Z" className={invertido ? 'fill-white' : 'fill-texto'} />
      <path d="m48 24 7 7" fill="none" className={invertido ? 'stroke-white' : 'stroke-acento'} strokeWidth="2.5" />
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
