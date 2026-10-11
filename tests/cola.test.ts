// Cola de agentes con un motor falso (tests/motor-falso.mjs): reintentos, límite de uso e inactividad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cola, limiteEnTexto } from '../server/agents/cola';
import type { Trabajo } from '../shared/tipos';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-cola-'));
let cola: Cola;

before(() => {
  process.env.APUNTES_MOTOR_CLAUDE = path.join(import.meta.dirname, process.platform === 'win32' ? 'motor-falso.cmd' : 'motor-falso.sh');
  process.env.FALSO_DIR = dir;
  cola = new Cola(2, path.join(dir, 'trabajos'));
  cola.tiempos = { inactividad: 1500, esperaSinHora: 2000, margenLimite: 200 };
});

after(async () => {
  cola.detenerTodo();
  cola.reanudarCola();
  // El proceso cancelado tarda un poco en soltar la carpeta (en Windows no se puede borrar mientras)
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

function encolar(prompt: string): Trabajo {
  return cola.encolar({ agente: 'prueba', nombreAgente: 'Prueba', motor: 'claude', titulo: prompt, asignatura: 'a', prompt, cwd: dir });
}

async function esperar(cond: () => boolean, ms = 20000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('Tiempo agotado esperando la condición');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('un trabajo que termina bien', async () => {
  const t = encolar('MODO:OK uno');
  await esperar(() => t.estado === 'ok');
  assert.equal(t.resultado, 'Hecho');
  assert.ok(t.sesion);
});

test('reintentar desde el principio un trabajo fallido', async () => {
  const t = encolar('MODO:FALLA dos');
  await esperar(() => t.estado === 'error');
  await cola.reintentar(t.id);
  assert.equal(t.estado === 'en-cola' || t.estado === 'ejecutando', true);
  await esperar(() => t.estado === 'ok');
  assert.ok(t.eventos.some((e) => e.texto === 'Reintento desde el principio'));
});

test('límite de uso: el motor se pausa y los trabajos siguen solos al renovarse', async () => {
  const t = encolar('MODO:LIMITE tres');
  await esperar(() => !!cola.uso.pausas?.claude);
  assert.equal(t.estado, 'en-cola');
  assert.ok(t.eventos.some((e) => /límite de uso/.test(e.texto)));
  // Lo que se encola mientras tanto también espera
  const otro = encolar('MODO:OK cuatro');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(otro.estado, 'en-cola');
  await esperar(() => t.estado === 'ok' && otro.estado === 'ok');
  assert.equal(cola.uso.pausas?.claude, undefined);
  // Continuó su conversación (no empezó de cero)
  assert.ok(t.eventos.some((e) => e.texto === 'Continúo.'));
});

test('aviso de inactividad y «seguir esperando»', async () => {
  const t = encolar('MODO:CUELGA cinco');
  await esperar(() => !!t.inactivo);
  cola.seguirEsperando(t.id);
  assert.equal(t.inactivo, undefined);
  cola.cancelar(t.id);
  assert.equal(t.estado, 'cancelado');
});

test('mensajes de límite de uso de Claude y Codex', () => {
  const ahora = new Date('2026-10-11T14:00:00');
  const hora = (s: string) => {
    const h = limiteEnTexto(s, ahora)?.hasta;
    return h ? new Date(h).toTimeString().slice(0, 5) : limiteEnTexto(s, ahora);
  };
  assert.equal(hora('Claude AI usage limit reached|1791464400'), new Date(1791464400_000).toTimeString().slice(0, 5));
  assert.equal(hora("You've hit your limit · resets 5pm (Europe/Madrid)"), '17:00');
  assert.equal(hora("You've hit your usage limit. Upgrade to Pro or try again at 3:05 PM."), '15:05');
  assert.equal(hora("You've hit your usage limit. Try again in 2 hours 5 minutes."), '16:05');
  assert.equal(hora('Weekly limit reached · resets Oct 13, 10am'), '10:00');
  assert.equal(hora('rate limit exceeded (429)'), '14:02');
  assert.equal(limiteEnTexto('Error: file not found'), undefined);
});
