// ---------------------------------------------------------------------------
// Kavi — Memory ingestion queue
// ---------------------------------------------------------------------------
// Durable, restart-safe queue for post-turn consolidation. Layer-1 working
// memory updates happen synchronously in turnProcessor; this queue handles
// episode/fact enrichment without blocking chat responses.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { unrefTimerIfSupported } from '../../utils/timers';
import { runConsolidation } from './consolidation/orchestrator';
import { sliceClosedTurnMessages } from './deterministicExtractor';
import { composeActiveFocusContent } from './focus';
import {
  claimIngestionJob,
  completeIngestionJob,
  discardIngestionJob,
  discardPendingIngestionJobs,
  getIngestionJob,
  getNextPendingIngestionAttemptAt,
  INGESTION_RETRY_BASE_DELAY_MS,
  listPendingIngestionJobs,
  markIngestionJobStructuralComplete,
  recoverStaleIngestionJobs,
  retryOrCompleteIngestionJob,
} from './ingestionQueueStore';
import type {
  IngestionJob,
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from './ingestionQueueStore';
import {
  acquireIngestionSlot,
  INGESTION_BATCH_LIMIT,
  releaseIngestionSlot,
  shouldAbortIngestionDueToMemoryPressure,
} from './onDeviceGuards';
import { canWriteLongTermMemory, registerMemoryOptOutHandler } from './policy';
import { refreshThreadReflection } from './reflections';
import type { ProcessTurnResult } from './turnProcessor';
import { editWorkingBlock, getWorkingBlock } from './workingBlocks';

export {
  computeNextIngestionAttemptAt,
  countCompletedIngestionJobsForThread,
  countPendingIngestionJobs,
  discardPendingIngestionJobs,
  enqueueIngestionJob,
  getIngestionJob,
  getIngestionQueueDiagnostics,
  getNextPendingIngestionAttemptAt,
  INGESTION_PROCESSING_LEASE_MS,
  INGESTION_RETRY_BASE_DELAY_MS,
  INGESTION_RETRY_MAX_DELAY_MS,
  listPendingIngestionJobs,
  recoverStaleIngestionJobs,
} from './ingestionQueueStore';
export type {
  EnqueueIngestionJobInput,
  IngestionJob,
  IngestionJobReason,
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
  IngestionQueueDiagnostics,
  StaleIngestionRecoveryResult,
} from './ingestionQueueStore';

const logger = createLogger('memory.ingestionQueue');

function preserveThreadTitleFocus(input: {
  memoryConversationId: string;
  threadTitle?: string;
  now: number;
}): void {
  const threadId = input.memoryConversationId.trim();
  const threadTitle = input.threadTitle?.trim();
  if (!threadId || !threadTitle) {
    return;
  }

  const scope = { conversationId: threadId, threadId };
  const existing = getWorkingBlock('active_focus', scope)?.content;
  const content = composeActiveFocusContent({
    threadTitle,
    activeFocus: existing,
  });
  if (content && content !== existing?.trim()) {
    editWorkingBlock('active_focus', content, scope, { now: input.now });
  }
}

export interface ProcessIngestionJobInput {
  jobId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
  now?: number;
}

type IngestionOutcomeDecision =
  | {
      kind: 'complete';
      status: 'completed_structural' | 'completed_enriched';
      providerOutcome: IngestionProviderOutcome;
    }
  | {
      kind: 'retry';
      providerOutcome: IngestionProviderOutcome | null;
      outcomeCode: IngestionOutcomeCode;
    };

function classifyIngestionOutcome(
  result: ProcessTurnResult,
  providerEnrichment: boolean,
): IngestionOutcomeDecision {
  if (!result.processed) {
    return {
      kind: 'retry',
      providerOutcome: null,
      outcomeCode: 'processing_incomplete',
    };
  }

  const outcome = result.providerOutcome;
  if (outcome.status === 'not_requested') {
    return {
      kind: 'complete',
      status: 'completed_structural',
      providerOutcome: 'structural_only',
    };
  }
  if (!providerEnrichment) {
    return {
      kind: 'retry',
      providerOutcome: null,
      outcomeCode: 'processing_incomplete',
    };
  }
  if (outcome.status === 'valid' || outcome.status === 'empty_valid') {
    return {
      kind: 'complete',
      status: 'completed_enriched',
      providerOutcome: outcome.status,
    };
  }
  return {
    kind: 'retry',
    providerOutcome: outcome.status,
    outcomeCode: outcome.code,
  };
}

function resolveJobSourceWindow(job: IngestionJob, messages: Message[]): Message[] | null {
  const endIndex = messages.findIndex((message) => message.id === job.sourceEndMessageId);
  if (endIndex < 0) {
    return null;
  }

  if (job.sourceStartMessageId) {
    const startIndex = messages.findIndex((message) => message.id === job.sourceStartMessageId);
    if (startIndex < 0 || startIndex > endIndex) {
      return null;
    }
  }

  const window = sliceClosedTurnMessages(
    messages,
    job.sourceStartMessageId ?? undefined,
    job.sourceEndMessageId,
  );
  if (window.at(-1)?.id !== job.sourceEndMessageId) {
    return null;
  }
  if (job.sourceStartMessageId && window[0]?.id !== job.sourceStartMessageId) {
    return null;
  }
  return window;
}

export async function processIngestionJob(input: ProcessIngestionJobInput): Promise<{
  processed: boolean;
  status?: IngestionJobStatus;
  skipped?:
    | 'missing_or_terminal'
    | 'source_window_unavailable'
    | 'memory_pressure'
    | 'slot_unavailable'
    | 'not_due'
    | 'claim_lost'
    | 'processing_error'
    | 'opt_out';
}> {
  const startedAt = input.now ?? Date.now();
  if (!canWriteLongTermMemory()) {
    discardIngestionJob(input.jobId);
    return { processed: false, skipped: 'opt_out' };
  }
  recoverStaleIngestionJobs(startedAt);
  const job = getIngestionJob(input.jobId);
  if (
    !job ||
    ['degraded', 'completed_structural', 'completed_enriched', 'failed'].includes(job.status)
  ) {
    return { processed: false, skipped: 'missing_or_terminal' };
  }
  if (job.status === 'processing' || (job.nextAttemptAt ?? Number.POSITIVE_INFINITY) > startedAt) {
    return { processed: false, status: job.status, skipped: 'not_due' };
  }
  const sourceWindow = resolveJobSourceWindow(job, input.messages);
  if (!sourceWindow) {
    return { processed: false, skipped: 'source_window_unavailable' };
  }
  if (shouldAbortIngestionDueToMemoryPressure()) {
    return { processed: false, skipped: 'memory_pressure' };
  }
  if (!acquireIngestionSlot(job.id)) {
    return { processed: false, skipped: 'slot_unavailable' };
  }

  if (!claimIngestionJob(job.id, startedAt)) {
    releaseIngestionSlot(job.id);
    return { processed: false, skipped: 'claim_lost' };
  }

  try {
    const turnResult = await runConsolidation({
      threadId: job.threadId,
      memoryConversationId: job.memoryConversationId,
      messages: sourceWindow,
      threadTitle: input.threadTitle,
      personaSummary: input.personaSummary,
      activeChatProvider: job.providerEnrichment ? input.activeChatProvider : undefined,
      requireExplicitChatProvider: Boolean(job.chatProviderId),
      ...(job.providerEnrichment ? {} : { extractor: null }),
      taskId: job.taskId ?? undefined,
      graphGoalEvidence: input.graphGoalEvidence,
      sourceRunId: input.sourceRunId,
      now: startedAt,
      skipWorkingMemorySync: true,
    });
    if (turnResult.skipped === 'opt_out' || !canWriteLongTermMemory()) {
      discardIngestionJob(job.id);
      return { processed: false, skipped: 'opt_out' };
    }
    const transitionAt = input.now ?? Date.now();
    if (turnResult.processed) {
      markIngestionJobStructuralComplete(job.id, transitionAt);
    }
    const decision = classifyIngestionOutcome(turnResult, job.providerEnrichment);
    let status: IngestionJobStatus;
    if (decision.kind === 'complete') {
      completeIngestionJob(job.id, decision.status, decision.providerOutcome, transitionAt);
      status = decision.status;
    } else {
      status = retryOrCompleteIngestionJob({
        jobId: job.id,
        providerOutcome: decision.providerOutcome,
        outcomeCode: decision.outcomeCode,
        now: transitionAt,
      });
    }

    if (turnResult.processed) {
      try {
        preserveThreadTitleFocus({
          memoryConversationId: job.memoryConversationId,
          threadTitle: input.threadTitle,
          now: transitionAt,
        });
      } catch {
        logger.devWarn(`Ingestion job ${job.id} focus refresh skipped`);
      }
      try {
        refreshThreadReflection({
          threadId: job.memoryConversationId,
          taskId: job.taskId,
          now: transitionAt,
        });
      } catch {
        logger.devWarn(`Ingestion job ${job.id} reflection refresh skipped`);
      }
    }
    return { processed: turnResult.processed, status };
  } catch {
    if (!canWriteLongTermMemory()) {
      discardIngestionJob(job.id);
      return { processed: false, skipped: 'opt_out' };
    }
    const transitionAt = input.now ?? Date.now();
    const status = retryOrCompleteIngestionJob({
      jobId: job.id,
      providerOutcome: null,
      outcomeCode: 'processing_error',
      now: transitionAt,
    });
    logger.devWarn(`Ingestion job ${job.id} failed with processing_error`);
    return { processed: false, status, skipped: 'processing_error' };
  } finally {
    releaseIngestionSlot(job.id);
  }
}

export interface IngestionJobRuntimeContext {
  threadTitle?: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
}

export interface DrainIngestionQueueInput {
  loadMessagesForThread: (threadId: string) => Message[];
  loadRuntimeContextForJob?: (job: IngestionJob) => IngestionJobRuntimeContext;
  maxJobs?: number;
  now?: number;
}

export interface DrainIngestionQueueResult {
  attempted: number;
  completed: number;
  completedStructural: number;
  completedEnriched: number;
  retrying: number;
  degraded: number;
  deferred: number;
  sourceDeferred: number;
  resourceDeferred: number;
  failed: number;
}

export async function drainIngestionQueue(
  input: DrainIngestionQueueInput,
): Promise<DrainIngestionQueueResult> {
  const result: DrainIngestionQueueResult = {
    attempted: 0,
    completed: 0,
    completedStructural: 0,
    completedEnriched: 0,
    retrying: 0,
    degraded: 0,
    deferred: 0,
    sourceDeferred: 0,
    resourceDeferred: 0,
    failed: 0,
  };

  const now = input.now ?? Date.now();
  const jobs = listPendingIngestionJobs(input.maxJobs ?? INGESTION_BATCH_LIMIT, now);
  for (const job of jobs) {
    result.attempted += 1;
    const messages = input.loadMessagesForThread(job.threadId);
    if (messages.length === 0) {
      result.deferred += 1;
      result.sourceDeferred += 1;
      continue;
    }
    const runtimeContext = input.loadRuntimeContextForJob?.(job) ?? {};
    const processed = await processIngestionJob({
      jobId: job.id,
      messages,
      threadTitle: runtimeContext.threadTitle,
      personaSummary: runtimeContext.personaSummary,
      activeChatProvider: runtimeContext.activeChatProvider,
      graphGoalEvidence: runtimeContext.graphGoalEvidence,
      sourceRunId: runtimeContext.sourceRunId,
      ...(input.now === undefined ? {} : { now }),
    });
    if (processed.status === 'completed_structural') {
      result.completed += 1;
      result.completedStructural += 1;
    } else if (processed.status === 'completed_enriched') {
      result.completed += 1;
      result.completedEnriched += 1;
    } else if (processed.status === 'retrying') {
      result.retrying += 1;
    } else if (processed.status === 'degraded') {
      result.degraded += 1;
    } else if (processed.status === 'failed') {
      result.failed += 1;
    } else {
      result.deferred += 1;
      if (processed.skipped === 'source_window_unavailable') {
        result.sourceDeferred += 1;
      } else if (
        processed.skipped === 'memory_pressure' ||
        processed.skipped === 'slot_unavailable'
      ) {
        result.resourceDeferred += 1;
      }
    }
  }

  return result;
}

export type ScheduledIngestionDrainInput = Omit<DrainIngestionQueueInput, 'now'>;

let scheduledRuntime: ScheduledIngestionDrainInput | null = null;
let drainMicrotaskScheduled = false;
let drainRunning = false;
let drainRequested = false;
let retryWakeTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryWakeTimer(): void {
  if (retryWakeTimer !== null) {
    clearTimeout(retryWakeTimer);
    retryWakeTimer = null;
  }
}

function scheduleRetryWake(delayMs: number): void {
  clearRetryWakeTimer();
  retryWakeTimer = setTimeout(
    () => {
      retryWakeTimer = null;
      const runtime = scheduledRuntime;
      if (runtime) scheduleIngestionDrain(runtime);
    },
    Math.max(0, delayMs),
  );
  unrefTimerIfSupported(retryWakeTimer);
}

function scheduleNextDrain(
  runtime: ScheduledIngestionDrainInput,
  result: DrainIngestionQueueResult,
): void {
  if (!canWriteLongTermMemory() || scheduledRuntime === null) return;
  const nextAttemptAt = getNextPendingIngestionAttemptAt();
  if (nextAttemptAt === null) return;
  const now = Date.now();
  if (nextAttemptAt > now) {
    scheduleRetryWake(nextAttemptAt - now);
    return;
  }

  const madeProgress = result.completed + result.retrying + result.degraded + result.failed > 0;
  if (madeProgress) {
    scheduleIngestionDrain(runtime);
  } else if (result.resourceDeferred > 0) {
    scheduleRetryWake(INGESTION_RETRY_BASE_DELAY_MS);
  }
}

export async function drainIngestionQueueWithWakeup(
  input: ScheduledIngestionDrainInput,
): Promise<DrainIngestionQueueResult> {
  scheduledRuntime = input;
  const result = await drainIngestionQueue(input);
  scheduleNextDrain(input, result);
  return result;
}

async function runScheduledDrain(): Promise<void> {
  drainMicrotaskScheduled = false;
  if (drainRunning || !drainRequested) return;
  const runtime = scheduledRuntime;
  if (!runtime || !canWriteLongTermMemory()) return;

  drainRequested = false;
  drainRunning = true;
  try {
    await drainIngestionQueueWithWakeup(runtime);
  } catch {
    logger.devWarn('Ingestion drain failed with processing_error');
  } finally {
    drainRunning = false;
  }

  if (drainRequested && !drainMicrotaskScheduled) {
    drainMicrotaskScheduled = true;
    queueMicrotask(() => void runScheduledDrain());
  }
}

export function scheduleIngestionDrain(input: ScheduledIngestionDrainInput): void {
  if (!canWriteLongTermMemory()) return;
  scheduledRuntime = input;
  drainRequested = true;
  clearRetryWakeTimer();
  if (drainRunning || drainMicrotaskScheduled) return;
  drainMicrotaskScheduled = true;
  queueMicrotask(() => void runScheduledDrain());
}

export function cancelScheduledIngestionDrain(): void {
  scheduledRuntime = null;
  drainRequested = false;
  drainMicrotaskScheduled = false;
  clearRetryWakeTimer();
}

registerMemoryOptOutHandler(() => {
  cancelScheduledIngestionDrain();
  discardPendingIngestionJobs();
});

export function __resetIngestionQueueForTests(): void {
  cancelScheduledIngestionDrain();
  drainRunning = false;
}
