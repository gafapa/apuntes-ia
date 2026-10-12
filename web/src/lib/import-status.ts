import type { Trabajo } from '../../../shared/tipos';

/** Include the diagnosis queued after transcription, rather than treating upload completion as readiness. */
export function isImportProcessing(loaded: boolean, jobs: Trabajo[]): boolean {
  return !loaded || jobs.some(job => (job.paso === 'importacion' || job.paso === 'diagnostico') && (job.estado === 'en-cola' || job.estado === 'ejecutando'));
}
