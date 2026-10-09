// ---------------------------------------------------------------------------
// Kavi — Foreground scenario memory settlement
// ---------------------------------------------------------------------------
// Waits for the memory a scenario turn published to reach the same durable boundary
// product chat waits for — the structural checkpoint — and decides when a turn is
// expected to close out memory at all.
// ---------------------------------------------------------------------------

import {
  drainIngestionQueueWithWakeup,
  getIngestionJob,
  type IngestionJob,
} from '../../services/memory/ingestionQueue';
import { listIngestionDurabilityReceipts } from '../../services/memory/ingestionStructuralReceiptStore';
import { loadIngestionJobRuntimeContext } from '../../services/memory/lifecycle';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import { cloneAndFreeze } from './foregroundScenarioDriverTypes';
import type {
  ForegroundScenarioMemoryRecord,
  ForegroundScenarioMemorySnapshot,
} from './foregroundScenarioDriverTypes';

const MEMORY_JOB_INITIAL_POLL_MS = 10;
const MEMORY_JOB_MAX_POLL_MS = 500;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function awaitMemorySettlementBeforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  timeoutMessage = 'Timed out settling foreground scenario memory.',
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error(timeoutMessage);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), remainingMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function awaitMemoryJob(jobId: string, deadline: number): Promise<IngestionJob> {
  let requestedDrain = false;
  let pollDelayMs = MEMORY_JOB_INITIAL_POLL_MS;
  while (Date.now() <= deadline) {
    const job = getIngestionJob(jobId);
    if (!job) throw new Error(`Memory ingestion job ${jobId} disappeared before completion.`);
    if (job.structuralCompletedAt !== null) return job;
    if (['degraded', 'completed_structural', 'completed_enriched', 'failed'].includes(job.status)) {
      return job;
    }

    if ((job.status === 'pending' || job.status === 'retrying') && !requestedDrain) {
      requestedDrain = true;
      // Product chat only waits for the durable structural checkpoint; provider
      // enrichment continues in the background. Keep the live evaluator on the
      // same boundary instead of blocking on the full drain/provider request.
      void drainIngestionQueueWithWakeup({
        loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
        maxJobs: 1,
      }).catch(() => undefined);
      continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollDelayMs, remainingMs));
    pollDelayMs = Math.min(pollDelayMs * 2, MEMORY_JOB_MAX_POLL_MS);
  }
  throw new Error(`Timed out waiting for memory ingestion job ${jobId}.`);
}

export async function settleForegroundScenarioMemory(
  records: ReadonlyArray<ForegroundScenarioMemoryRecord>,
  timeoutMs: number,
): Promise<ReadonlyArray<ForegroundScenarioMemorySnapshot>> {
  const deadline = Date.now() + timeoutMs;
  const results = await awaitMemorySettlementBeforeDeadline(
    Promise.all(records.map((record) => record.promise)),
    deadline,
  );
  const seenJobIds = new Set<string>();
  const uniqueResults = results.filter((result) => {
    if (!result.jobId) return true;
    if (seenJobIds.has(result.jobId)) return false;
    seenJobIds.add(result.jobId);
    return true;
  });
  const jobIds = uniqueResults.flatMap((result) => (result.jobId ? [result.jobId] : []));
  const snapshots = await awaitMemorySettlementBeforeDeadline(
    Promise.all(
      uniqueResults.map(async (result) => {
        const job = result.jobId ? await awaitMemoryJob(result.jobId, deadline) : null;
        return {
          publication: result,
          job,
          receipts: result.jobId ? listIngestionDurabilityReceipts(result.jobId) : [],
        };
      }),
    ),
    deadline,
    jobIds.length === 1
      ? `Timed out waiting for memory ingestion job ${jobIds[0]}.`
      : 'Timed out settling foreground scenario memory.',
  );
  return cloneAndFreeze(snapshots);
}

export function shouldExpectForegroundMemoryCloseout(params: {
  disableLongTermMemory: boolean;
  finalAssistantCompleted: boolean;
  graphStatus: AgentRunControlGraphState['status'] | null | undefined;
  isSideThread: boolean;
  timedOut: boolean;
}): boolean {
  return (
    !params.disableLongTermMemory &&
    !params.isSideThread &&
    params.finalAssistantCompleted &&
    params.graphStatus !== 'awaiting_user' &&
    !params.timedOut
  );
}
