import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexUsage, parseCodexUsage } from '../server/agents/codexUsage';
import { Cola } from '../server/agents/cola';

test('Codex quota parsing preserves weekly-only windows and prefers the Codex bucket', () => {
  const usage = parseCodexUsage({
    rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300 } },
    rateLimitsByLimitId: { codex: { primary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 1792000000 }, secondary: null } },
  });
  assert.deepEqual(usage.windows, [{ usedPercent: 31, durationMinutes: 10080, resetsAt: 1792000000 }]);
  assert.equal(usage.unavailable, undefined);
});

test('Codex quota parsing supports legacy responses, zero use and unavailable quotas', () => {
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 }, secondary: { usedPercent: 105, windowDurationMins: 10080 } } }).windows.map((window) => window.usedPercent), [0, 100]);
  assert.equal(parseCodexUsage({ rateLimits: { primary: { usedPercent: '20' } } }).unavailable, true);
  assert.equal(parseCodexUsage(null).unavailable, true);
});

function fakeServer(mode: string) {
  return `
    const readline = require('node:readline');
    let initialized = false;
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'initialize') {
        process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
      } else if (request.method === 'initialized') initialized = true;
      else if (request.method === 'account/rateLimits/read' && initialized) {
        if ('${mode}' === 'timeout') return;
        if ('${mode}' === 'exit') return process.exit(0);
        const response = '${mode}' === 'error' ? { id: request.id, error: { message: 'private details' } } :
          { id: request.id, result: { rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300 } } } };
        const encoded = JSON.stringify(response) + '\\n';
        process.stdout.write(encoded.slice(0, 12));
        setTimeout(() => process.stdout.write(encoded.slice(12)), 10);
      } else process.exit(2);
    });`;
}

test('Quota reader completes the handshake and handles fragmented protocol responses', async () => {
  const usage = await readCodexUsage({ executable: process.execPath, args: ['-e', fakeServer('ok')] });
  assert.equal(usage.windows[0].usedPercent, 42);
});

test('Quota reader handles server errors, early exit, timeout and cancellation', async () => {
  for (const mode of ['error', 'exit', 'timeout']) {
    await assert.rejects(readCodexUsage({ executable: process.execPath, args: ['-e', fakeServer(mode)], timeoutMs: 500 }), /Codex usage/);
  }
  const controller = new AbortController();
  const pending = readCodexUsage({ executable: process.execPath, args: ['-e', fakeServer('timeout')], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('Claude rate-limit events preserve the independent Codex snapshot and engine pauses', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-usage-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const queue = new Cola(1, directory);
  const codex = parseCodexUsage({ rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300 } } });
  queue.uso = { codex, pausas: { codex: Date.now() + 10000 }, actualizado: Date.now() };
  (queue as any).traducirClaude({}, { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.2 } } } }, true);
  assert.equal(queue.uso.codex, codex);
  assert.equal(queue.uso.cincoHoras, 0.2);
  assert.ok(queue.uso.pausas?.codex);
});
