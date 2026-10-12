import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Trabajo } from '../shared/tipos';
import { isImportProcessing } from '../web/src/lib/import-status';

const job = (step: Trabajo['paso'], state: Trabajo['estado']) => ({ paso: step, estado: state }) as Trabajo;

test('The import stays busy during initial status loading, transcription and queued diagnosis', () => {
  assert.equal(isImportProcessing(false, []), true);
  assert.equal(isImportProcessing(true, [job('importacion', 'ejecutando')]), true);
  assert.equal(isImportProcessing(true, [job('importacion', 'ok'), job('diagnostico', 'en-cola')]), true);
  assert.equal(isImportProcessing(true, [job('importacion', 'ok'), job('diagnostico', 'ejecutando')]), true);
});

test('Finished and failed imports unlock the report; unrelated generation does not block it', () => {
  assert.equal(isImportProcessing(true, [job('importacion', 'ok'), job('diagnostico', 'ok')]), false);
  assert.equal(isImportProcessing(true, [job('diagnostico', 'error')]), false);
  assert.equal(isImportProcessing(true, [job('importacion', 'cancelado')]), false);
  assert.equal(isImportProcessing(true, [job('redaccion', 'ejecutando')]), false);
});
