// Motor falso para las pruebas: imita la salida stream-json de `claude -p`. Lo que hace depende del
// prompt (stdin):
//   MODO:OK      → termina bien
//   MODO:LIMITE  → la primera vez agota el límite de uso (se renueva en 1 s); al continuar, termina bien
//   MODO:FALLA   → la primera vez falla; la siguiente, termina bien
//   MODO:CUELGA  → no da señales durante 60 s
// FALSO_DIR: carpeta donde anota cuántas veces ha recibido cada prompt.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const prompt = fs.readFileSync(0, 'utf8');
const args = process.argv.slice(2);
const reanudar = args.includes('--resume');
const sesion = reanudar ? args[args.indexOf('--resume') + 1] : randomUUID();
const salida = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const fin = (texto, error = false) => {
  // Flush the complete stream before exiting, including preceding rate-limit events.
  process.stdout.write(JSON.stringify({ type: 'result', is_error: error, result: texto, usage: { input_tokens: 10, output_tokens: 5 } }) + '\n', () => process.exit(error ? 1 : 0));
};

const dir = process.env.FALSO_DIR ?? '.';
const clave = createHash('sha1').update(prompt).digest('hex').slice(0, 12);
const contador = path.join(dir, `${clave}.n`);
const veces = (fs.existsSync(contador) ? Number(fs.readFileSync(contador, 'utf8')) : 0) + 1;
fs.writeFileSync(contador, String(veces));

salida({ type: 'system', subtype: 'init', session_id: sesion, model: 'falso' });
salida({ type: 'assistant', message: { content: [{ type: 'text', text: reanudar ? 'Continúo.' : 'Empiezo.' }] } });

if (prompt.includes('MODO:LIMITE') && !reanudar) {
  const renueva = Math.floor(Date.now() / 1000) + 1;
  salida({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: renueva, unifiedWindows: { five_hour: { utilization: 1, resetsAt: renueva } } } });
  fin(`Claude AI usage limit reached|${renueva}`, true);
} else if (prompt.includes('MODO:FALLA') && veces === 1) {
  fin('Algo ha fallado', true);
} else if (prompt.includes('MODO:CUELGA')) {
  setTimeout(() => fin('Terminado tras colgarse'), 60_000);
} else {
  fin('Hecho');
}
