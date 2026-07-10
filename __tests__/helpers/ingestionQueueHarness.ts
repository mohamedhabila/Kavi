import {
  getIngestionJob,
  type IngestionJob,
  type IngestionJobStatus,
} from '../../src/services/memory/ingestionQueue';

const TERMINAL_INGESTION_STATUSES: ReadonlySet<IngestionJobStatus> = new Set([
  'degraded',
  'completed_structural',
  'completed_enriched',
  'failed',
]);

export async function waitForIngestionJobTerminal(
  jobId: string,
  maxEventLoopTurns = 50,
): Promise<IngestionJob> {
  for (let turn = 0; turn < maxEventLoopTurns; turn += 1) {
    const job = getIngestionJob(jobId);
    if (!job) {
      throw new Error(`Ingestion job ${jobId} disappeared before reaching a terminal state`);
    }
    if (TERMINAL_INGESTION_STATUSES.has(job.status)) {
      return job;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const status = getIngestionJob(jobId)?.status ?? 'missing';
  throw new Error(`Ingestion job ${jobId} did not finish; current status: ${status}`);
}
