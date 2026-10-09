// Partituras de los bloques ```abc (notación ABC, la habitual para escribir música en texto),
// dibujadas con abcjs.
import abcjs from 'abcjs';

export function dibujarPartitura(contenido: string, oscuro = false): string {
  // abcjs mide el texto con el navegador: el contenedor tiene que estar en la página (fuera de la vista)
  const caja = document.createElement('div');
  caja.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px';
  document.body.appendChild(caja);
  try {
    const r = abcjs.renderAbc(caja, contenido, { staffwidth: 740, paddingtop: 8, paddingbottom: 8, paddingleft: 10, paddingright: 10, add_classes: false });
    const avisos = r?.[0]?.warnings;
    const svg = caja.querySelector('svg');
    if (!svg) throw new Error(avisos?.length ? String(avisos[0]).replace(/<[^>]+>/g, '') : 'No se ha podido dibujar la partitura');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const ancho = Number(svg.getAttribute('width')) || 800;
    const alto = Number(svg.getAttribute('height')) || 200;
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    svg.removeAttribute('style');
    const color = oscuro ? '#e5e7eb' : '#000000';
    // Fondo y color de tinta
    svg.insertAdjacentHTML('afterbegin', `<rect width="100%" height="100%" fill="${oscuro ? 'transparent' : '#ffffff'}"/>`);
    for (const el of svg.querySelectorAll('[fill="currentColor"], [stroke="currentColor"]')) {
      if (el.getAttribute('fill') === 'currentColor') el.setAttribute('fill', color);
      if (el.getAttribute('stroke') === 'currentColor') el.setAttribute('stroke', color);
    }
    svg.setAttribute('color', color);
    return new XMLSerializer().serializeToString(svg);
  } finally {
    caja.remove();
  }
}
