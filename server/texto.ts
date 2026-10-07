// Utilidades para localizar fragmentos en el Markdown de forma tolerante
// (los agentes a veces cambian espacios, saltos de línea o comillas al citar el texto).

function escapar(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normaliza comillas y guiones tipográficos para comparar. */
function patronFlexible(fragmento: string): RegExp {
  const palabras = fragmento.trim().split(/\s+/).filter(Boolean).map((p) =>
    escapar(p)
      .replace(/["“”«»]/g, '["“”«»]')
      .replace(/['‘’]/g, "['‘’]")
      .replace(/[-–—]/g, '[-–—]'),
  );
  return new RegExp(palabras.join('\\s+'));
}

/** Busca un fragmento: primero literal y después ignorando espacios y tipografía. */
export function buscarFragmento(texto: string, fragmento: string): { inicio: number; fin: number } | null {
  if (!fragmento.trim()) return null;
  const i = texto.indexOf(fragmento);
  if (i >= 0) return { inicio: i, fin: i + fragmento.length };
  const m = patronFlexible(fragmento).exec(texto);
  return m ? { inicio: m.index, fin: m.index + m[0].length } : null;
}

export function sustituirFragmento(texto: string, original: string, nuevo: string): string | null {
  const r = buscarFragmento(texto, original);
  if (!r) return null;
  return texto.slice(0, r.inicio) + nuevo + texto.slice(r.fin);
}

/**
 * Inserta un bloque tras el párrafo que contiene el ancla. Si no se encuentra
 * (ni siquiera su comienzo), se añade al final de la sección.
 */
export function insertarTrasAncla(texto: string, ancla: string, bloque: string): { texto: string; encontrado: boolean } {
  let r = buscarFragmento(texto, ancla);
  if (!r) {
    // Probar con las primeras palabras del ancla
    const inicio = ancla.trim().split(/\s+/).slice(0, 8).join(' ');
    if (inicio.length >= 15) r = buscarFragmento(texto, inicio);
  }
  if (!r) return { texto: `${texto.trimEnd()}\n\n${bloque.trim()}\n`, encontrado: false };
  // Fin del párrafo (siguiente línea en blanco) o fin del texto
  const resto = texto.slice(r.fin);
  const salto = resto.search(/\n\s*\n/);
  const pos = salto < 0 ? texto.length : r.fin + salto;
  const antes = texto.slice(0, pos).trimEnd();
  const despues = texto.slice(pos).replace(/^\s*\n/, '');
  return { texto: `${antes}\n\n${bloque.trim()}\n\n${despues}`.replace(/\n{3,}/g, '\n\n'), encontrado: true };
}

/** Extrae el primer objeto JSON de un texto (por si el agente lo envuelve en ```json). */
export function extraerJson<T>(texto: string): T {
  const limpio = texto.replace(/^﻿/, '').trim();
  try {
    return JSON.parse(limpio) as T;
  } catch {
    const bloque = limpio.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (bloque) return JSON.parse(bloque[1]) as T;
    const i = limpio.indexOf('{');
    const f = limpio.lastIndexOf('}');
    if (i >= 0 && f > i) return JSON.parse(limpio.slice(i, f + 1)) as T;
    throw new Error('No contiene JSON válido');
  }
}

export { hashTexto } from '../shared/hash';

export function contarPalabras(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}
