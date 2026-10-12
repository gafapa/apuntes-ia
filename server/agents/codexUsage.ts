import { createInterface } from 'node:readline';
import os from 'node:os';
import type { CodexUsage } from '../../shared/tipos';
import { lanzar, rutaMotor } from './motores';

/** Keep the server's window durations: primary is not always the five-hour quota. */
export function parseCodexUsage(result: any): CodexUsage {
  const snapshot = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  const windows: CodexUsage['windows'] = [];
  for (const window of [snapshot?.primary, snapshot?.secondary]) {
    if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue;
    windows.push({
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
      durationMinutes: typeof window.windowDurationMins === 'number' && window.windowDurationMins > 0 ? window.windowDurationMins : undefined,
      resetsAt: typeof window.resetsAt === 'number' && window.resetsAt > 0 ? window.resetsAt : undefined,
    });
  }
  return { windows, updatedAt: Date.now(), unavailable: windows.length === 0 || undefined };
}

/** Read account quotas without starting a thread, running an agent, or reading document data. */
export function readCodexUsage(options: {
  signal?: AbortSignal;
  executable?: string;
  args?: string[];
  timeoutMs?: number;
} = {}): Promise<CodexUsage> {
  const executable = options.executable ?? rutaMotor('codex');
  if (!executable || options.signal?.aborted) return Promise.reject(new Error('Codex usage unavailable'));
  return new Promise((resolve, reject) => {
    const child = lanzar(executable, options.args ?? ['app-server'], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout! });
    let settled = false;
    const finish = (error?: Error, usage?: CodexUsage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      lines.close();
      child.stdin?.end();
      child.kill();
      if (error) reject(error);
      else resolve(usage!);
    };
    const abort = () => finish(new Error('Codex usage cancelled'));
    const timeout = setTimeout(() => finish(new Error('Codex usage timed out')), options.timeoutMs ?? 15000);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Codex usage unavailable')));
    child.stdin?.on('error', () => finish(new Error('Codex usage unavailable')));
    child.stderr?.resume();
    child.on('close', () => finish(new Error('Codex usage connection closed')));
    const send = (message: object) => child.stdin?.write(`${JSON.stringify(message)}\n`);
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) return finish(new Error('Codex usage unavailable'));
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else finish(undefined, parseCodexUsage(message.result));
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'apuntes_ia_usage', version: '1.0.0' } } });
  });
}
