// ---------------------------------------------------------------------------
// Kavi — Memory ingestion queue
// ---------------------------------------------------------------------------
// Durable, restart-safe queue for post-turn consolidation. Layer-1 working
// memory updates happen synchronously in turnProcessor; this queue handles
// episode/fact enrichment without blocking chat responses.
// ---------------------------------------------------------------------------

import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { unrefTimerIfSupported } from '../../utils/timers';
import { runConsolidation } from './consolidation/orchestrator';
import { composeActiveFocusContent } from './focus';
import {
  commitIngestionPersistenceReceipt,
  type IngestionReceiptProviderOutcomeCode,
} from './ingestionReceiptStore';
import { hasSealedIngestionJobIdentity } from './ingestionQueueIdentity';
import {
  claimIngestionJobWithSourceSnapshot,
  completeIngestionJob,
  deferIngestionEnrichmentAfterStructuralCheckpoint,
  discardIngestionJob,
  discardPendingIngestionJobs,
  failIngestionJobForInvalidIdentity,
  getIngestionJob,
  getIngestionJobForProcessing,
  getNextPendingIngestionAttemptAt,
  INGESTION_RETRY_BASE_DELAY_MS,
  listPendingIngestionJobs,
  markIngestionJobStructuralComplete,
  ownsIngestionClaim,
  retryOrCompleteIngestionJob,
} from './ingestionQueueStore';
import type {
  IngestionJob,
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from './ingestionQueueStore';
import {
  beginActiveIngestionAttempt,
  finishActiveIngestionAttempt,
  preemptActiveIngestionAttempt,
  preemptActiveIngestionAttemptAndWait,
  protectActiveRemoteIngestionAttemptFromForeground,
} from './ingestionAttemptPreemption';
import { recoverStaleIngestionJobs } from './ingestionQueueRecovery';
import {
  acquireIngestionSlot,
  INGESTION_BATCH_LIMIT,
  registerIngestionPreemptionHandler,
  releaseIngestionSlot,
  shouldAbortIngestionDueToMemoryPressure,
} from './onDeviceGuards';
import { canWriteLongTermMemory, registerMemoryOptOutHandler } from './policy';
import { refreshThreadReflection } from './reflections';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import type { ProcessTurnResult, TurnProviderOutcome } from './turnProcessor';
import { editPromptEligibleWorkingBlock, getWorkingBlock } from './workingBlocks';

export {
  computeNextIngestionAttemptAt,
  countCompletedIngestionJobsForThread,
  countPendingIngestionJobs,
  discardPendingIngestionJobs,
  enqueueIngestionJob,
  getIngestionJob,
  getNextPendingIngestionAttemptAt,
  INGESTION_PROCESSING_LEASE_MS,
  INGESTION_RETRY_BASE_DELAY_MS,
  INGESTION_RETRY_MAX_DELAY_MS,
  listPendingIngestionJobs,
} from './ingestionQueueStore';
export { recoverStaleIngestionJobs } from './ingestionQueueRecovery';
export {
  EXACT_INGESTION_PREEMPTION_WAIT_MS,
  preemptIngestionJobAndWait,
} from './ingestionJobPreemption';
export type {
  ExactIngestionJobPreemptionResult,
  PreemptIngestionJobAndWaitInput,
} from './ingestionJobPreemption';
export {
  getIngestionPersistenceReceipt,
  listIngestionPersistenceReceipts,
} from './ingestionReceiptStore';
export type {
  IngestionPersistenceReceipt,
  IngestionReceiptProviderOutcomeCode,
} from './ingestionReceiptStore';
export type {
  EnqueueIngestionJobInput,
  IngestionJob,
  IngestionJobReason,
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from './ingestionQueueStore';
export type { StaleIngestionRecoveryResult } from './ingestionQueueRecovery';

const logger = createLogger('memory.ingestionQueue');

function preserveThreadTitleFocus(input: {
  memoryConversationId: string;
  threadTitle?: string;
  now: number;
}): void {
  const threadId = input.memoryConversationId;
  const threadTitle = input.threadTitle?.trim();
  if (!isExactMemoryScopeId(threadId) || !threadTitle) {
    return;
  }

  const scope = { conversationId: threadId, threadId };
  const existing = getWorkingBlock('active_focus', scope)?.content;
  const content = composeActiveFocusContent({
    threadTitle,
    activeFocus: existing,
  });
  if (content && content !== existing?.trim()) {
    editPromptEligibleWorkingBlock('active_focus', content, scope, { now: input.now });
  }
}

export interface ProcessIngestionJobInput {
  jobId: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  now?: number;
}

function resolveSealedActiveChatProvider(
  job: IngestionJob,
  runtimeProvider: LlmProviderConfig | undefined,
): LlmProviderConfig | undefined {
  if (
    !job.providerEnrichment ||
    !job.chatProviderId ||
    !job.chatModel ||
    !runtimeProvider?.enabled ||
    runtimeProvider.id !== job.chatProviderId
  ) {
    return undefined;
  }
  return { ...runtimeProvider, model: job.chatModel };
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

function mapReceiptProviderOutcome(outcome: TurnProviderOutcome): {
  providerOutcome: IngestionProviderOutcome;
  providerOutcomeCode: IngestionReceiptProviderOutcomeCode | null;
} {
  if (outcome.status === 'not_requested') {
    return { providerOutcome: 'structural_only', providerOutcomeCode: null };
  }
  if (outcome.status === 'valid' || outcome.status === 'empty_valid') {
    return { providerOutcome: outcome.status, providerOutcomeCode: null };
  }
  return { providerOutcome: outcome.status, providerOutcomeCode: outcome.code };
}

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

export async function processIngestionJob(input: ProcessIngestionJobInput): Promise<{
  processed: boolean;
  status?: IngestionJobStatus;
  skipped?:
    | 'missing_or_terminal'
    | 'memory_pressure'
    | 'slot_unavailable'
    | 'not_due'
    | 'claim_lost'
    | 'provider_preempted'
    | 'processing_error'
    | 'persona_scope_missing'
    | 'source_identity_invalid'
    | 'opt_out';
}> {
  const startedAt = input.now ?? Date.now();
  if (!canWriteLongTermMemory()) {
    discardIngestionJob(input.jobId);
    return { processed: false, skipped: 'opt_out' };
  }
  recoverStaleIngestionJobs(startedAt);
  const candidateJob = getIngestionJobForProcessing(input.jobId);
  if (!candidateJob) {
    return { processed: false, skipped: 'missing_or_terminal' };
  }
  if (
    ['degraded', 'completed_structural', 'completed_enriched', 'failed'].includes(
      candidateJob.status,
    )
  ) {
    return { processed: false, status: candidateJob.status, skipped: 'missing_or_terminal' };
  }
  if (!hasSealedIngestionJobIdentity(candidateJob)) {
    const identityFailure = candidateJob.personaId
      ? ('source_identity_invalid' as const)
      : ('persona_scope_missing' as const);
    failIngestionJobForInvalidIdentity(candidateJob.id, identityFailure, startedAt);
    const persistedStatus = getIngestionJobForProcessing(candidateJob.id)?.status;
    return {
      processed: false,
      ...(persistedStatus ? { status: persistedStatus } : {}),
      skipped: persistedStatus === 'failed' ? identityFailure : 'missing_or_terminal',
    };
  }
  if (
    candidateJob.status === 'processing' ||
    (candidateJob.nextAttemptAt ?? Number.POSITIVE_INFINITY) > startedAt
  ) {
    return { processed: false, status: candidateJob.status, skipped: 'not_due' };
  }
  if (shouldAbortIngestionDueToMemoryPressure()) {
    return { processed: false, skipped: 'memory_pressure' };
  }
  if (!acquireIngestionSlot(candidateJob.id)) {
    return { processed: false, skipped: 'slot_unavailable' };
  }

  const claimed = claimIngestionJobWithSourceSnapshot(candidateJob.id, startedAt);
  if (!claimed) {
    releaseIngestionSlot(candidateJob.id);
    const persistedStatus = getIngestionJob(candidateJob.id)?.status;
    const terminal =
      persistedStatus === 'degraded' ||
      persistedStatus === 'completed_structural' ||
      persistedStatus === 'completed_enriched' ||
      persistedStatus === 'failed';
    return {
      processed: false,
      ...(persistedStatus ? { status: persistedStatus } : {}),
      skipped: terminal ? 'missing_or_terminal' : 'claim_lost',
    };
  }
  const { job, claimToken, sourceSnapshot } = claimed;
  const structuralCheckpointOnly = claimed.mode === 'structural_checkpoint';
  const activeAttempt = beginActiveIngestionAttempt(job.id);
  let remoteProviderEnrichment = false;

  try {
    const turnResult = await runConsolidation({
      threadId: job.threadId,
      memoryConversationId: job.memoryConversationId,
      sourceEndMessageId: job.sourceEndMessageId,
      messages: sourceSnapshot.turnMessages,
      sealedPriorUserMessageId: job.priorUserMessageId ?? undefined,
      priorIdentityMessages: sourceSnapshot.priorUserMessage
        ? [sourceSnapshot.priorUserMessage, ...sourceSnapshot.turnMessages]
        : sourceSnapshot.turnMessages,
      threadTitle: job.threadTitle ?? undefined,
      personaSummary: input.personaSummary,
      activeChatProvider: resolveSealedActiveChatProvider(job, input.activeChatProvider),
      requireExplicitChatProvider: Boolean(job.chatProviderId),
      ...(job.providerEnrichment && !structuralCheckpointOnly ? {} : { extractor: null }),
      taskId: job.taskId ?? undefined,
      graphGoalEvidence: sourceSnapshot.graphGoalEvidence,
      sourceRunId: job.sourceRunId ?? undefined,
      episodeAccess: {
        personaId: job.personaId,
        shareability: 'thread_only',
      },
      now: job.sourceAt,
      skipWorkingMemorySync: true,
      deferStructuralFinalization: structuralCheckpointOnly,
      providerSignal: activeAttempt.controller.signal,
      onExecutionResourceResolved: (resource) => {
        remoteProviderEnrichment = resource === 'remote';
      },
      canPersist: () => ownsIngestionClaim(job.id, claimToken, input.now ?? Date.now()),
      commitStructuralCheckpoint: () => {
        const checkpointed = markIngestionJobStructuralComplete(
          job.id,
          input.now ?? Date.now(),
          claimToken,
        );
        if (checkpointed && remoteProviderEnrichment) {
          protectActiveRemoteIngestionAttemptFromForeground(activeAttempt);
        }
        return checkpointed;
      },
      commitPersistenceReceipt: ({ providerOutcome, ...writeSet }) => {
        const receiptAt = input.now ?? Date.now();
        commitIngestionPersistenceReceipt({
          ...writeSet,
          ...mapReceiptProviderOutcome(providerOutcome),
          jobId: job.id,
          claimToken,
          persistedAt: receiptAt,
        });
      },
    });
    if (turnResult.skipped === 'opt_out' || !canWriteLongTermMemory()) {
      discardIngestionJob(job.id);
      return { processed: false, skipped: 'opt_out' };
    }
    if (turnResult.skipped === 'claim_lost') {
      recoverStaleIngestionJobs(input.now ?? Date.now());
      return {
        processed: false,
        status: getIngestionJob(job.id)?.status,
        skipped: 'claim_lost',
      };
    }
    const transitionAt = input.now ?? Date.now();
    const receiptJob = getIngestionJob(job.id);
    let status: IngestionJobStatus;
    if (
      receiptJob?.status === 'completed_structural' ||
      receiptJob?.status === 'completed_enriched'
    ) {
      status = receiptJob.status;
    } else {
      if (
        turnResult.processed &&
        (receiptJob?.structuralCompletedAt ?? null) === null &&
        !markIngestionJobStructuralComplete(job.id, transitionAt, claimToken)
      ) {
        return {
          processed: false,
          status: getIngestionJob(job.id)?.status,
          skipped: 'claim_lost',
        };
      }
      if (structuralCheckpointOnly && turnResult.processed) {
        const transition = deferIngestionEnrichmentAfterStructuralCheckpoint({
          jobId: job.id,
          now: transitionAt,
          claimToken,
        });
        if (!transition.applied) {
          return { processed: false, status: transition.status, skipped: 'claim_lost' };
        }
        status = transition.status;
      } else {
        const decision = classifyIngestionOutcome(turnResult, job.providerEnrichment);
        if (decision.kind === 'complete') {
          const completed = completeIngestionJob(
            job.id,
            decision.status,
            decision.providerOutcome,
            transitionAt,
            claimToken,
          );
          if (!completed) {
            return {
              processed: false,
              status: getIngestionJob(job.id)?.status,
              skipped: 'claim_lost',
            };
          }
          status = decision.status;
        } else {
          const transition = retryOrCompleteIngestionJob({
            jobId: job.id,
            providerOutcome: decision.providerOutcome,
            outcomeCode: decision.outcomeCode,
            now: transitionAt,
            claimToken,
          });
          if (!transition.applied) {
            return { processed: false, status: transition.status, skipped: 'claim_lost' };
          }
          status = transition.status;
        }
      }
    }

    if (turnResult.processed) {
      try {
        preserveThreadTitleFocus({
          memoryConversationId: job.memoryConversationId,
          threadTitle: job.threadTitle ?? undefined,
          now: transitionAt,
        });
      } catch {
        logger.devWarn(`Ingestion job ${job.id} focus refresh skipped`);
      }
      try {
        refreshThreadReflection({
          threadId: job.memoryConversationId,
          taskId: job.taskId,
          periodAt: job.sourceAt,
          now: transitionAt,
        });
      } catch {
        logger.devWarn(`Ingestion job ${job.id} reflection refresh skipped`);
      }
    }
    return {
      processed: turnResult.processed,
      status,
      ...(turnResult.skipped === 'provider_preempted'
        ? { skipped: 'provider_preempted' as const }
        : {}),
    };
  } catch {
    if (!canWriteLongTermMemory()) {
      discardIngestionJob(job.id);
      return { processed: false, skipped: 'opt_out' };
    }
    const transitionAt = input.now ?? Date.now();
    const transition = retryOrCompleteIngestionJob({
      jobId: job.id,
      providerOutcome: null,
      outcomeCode: 'processing_error',
      now: transitionAt,
      claimToken,
    });
    if (!transition.applied) {
      return { processed: false, status: transition.status, skipped: 'claim_lost' };
    }
    logger.devWarn(`Ingestion job ${job.id} failed with processing_error`);
    return { processed: false, status: transition.status, skipped: 'processing_error' };
  } finally {
    releaseIngestionSlot(job.id);
    finishActiveIngestionAttempt(activeAttempt);
  }
}

export interface IngestionJobRuntimeContext {
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
}

export interface DrainIngestionQueueInput {
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
    resourceDeferred: 0,
    failed: 0,
  };

  const now = input.now ?? Date.now();
  recoverStaleIngestionJobs(now);
  const jobs = listPendingIngestionJobs(input.maxJobs ?? INGESTION_BATCH_LIMIT, now);
  for (const job of jobs) {
    result.attempted += 1;
    const runtimeContext = input.loadRuntimeContextForJob?.(job) ?? {};
    const processed = await processIngestionJob({
      jobId: job.id,
      personaSummary: runtimeContext.personaSummary,
      activeChatProvider: runtimeContext.activeChatProvider,
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
      if (processed.skipped === 'memory_pressure' || processed.skipped === 'slot_unavailable') {
        result.deferred += 1;
        result.resourceDeferred += 1;
      } else {
        result.deferred += 1;
      }
    }
  }

  return result;
}

export type ScheduledIngestionDrainInput = Omit<DrainIngestionQueueInput, 'now'>;

let scheduledRuntime: ScheduledIngestionDrainInput | null = null;
let scheduledRuntimeGeneration = 0;
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

function installScheduledRuntime(input: ScheduledIngestionDrainInput): number {
  scheduledRuntime = input;
  scheduledRuntimeGeneration += 1;
  return scheduledRuntimeGeneration;
}

function scheduleNextDrain(result: DrainIngestionQueueResult, runtimeGeneration: number): void {
  if (!canWriteLongTermMemory() || scheduledRuntime === null) return;
  if (runtimeGeneration !== scheduledRuntimeGeneration) {
    requestScheduledIngestionDrain();
    return;
  }
  const nextAttemptAt = getNextPendingIngestionAttemptAt();
  if (nextAttemptAt === null) return;
  const now = Date.now();
  if (nextAttemptAt > now) {
    scheduleRetryWake(nextAttemptAt - now);
    return;
  }

  const madeProgress = result.completed + result.retrying + result.degraded + result.failed > 0;
  if (madeProgress) {
    requestScheduledIngestionDrain();
  } else if (result.resourceDeferred > 0) {
    scheduleRetryWake(INGESTION_RETRY_BASE_DELAY_MS);
  }
}

export async function drainIngestionQueueWithWakeup(
  input: ScheduledIngestionDrainInput,
): Promise<DrainIngestionQueueResult> {
  const runtimeGeneration = installScheduledRuntime(input);
  const result = await drainIngestionQueue(input);
  scheduleNextDrain(result, runtimeGeneration);
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
  installScheduledRuntime(input);
  requestScheduledIngestionDrain();
}

export function requestScheduledIngestionDrain(): boolean {
  if (!scheduledRuntime || !canWriteLongTermMemory()) return false;
  drainRequested = true;
  clearRetryWakeTimer();
  if (drainRunning || drainMicrotaskScheduled) return true;
  drainMicrotaskScheduled = true;
  queueMicrotask(() => void runScheduledDrain());
  return true;
}

export async function cancelScheduledIngestionDrain(): Promise<void> {
  scheduledRuntime = null;
  drainRequested = false;
  drainMicrotaskScheduled = false;
  clearRetryWakeTimer();
  await preemptActiveIngestionAttemptAndWait();
}

registerIngestionPreemptionHandler((reason) => preemptActiveIngestionAttempt(reason));

registerMemoryOptOutHandler(() => {
  void cancelScheduledIngestionDrain();
  discardPendingIngestionJobs();
});

export function __resetIngestionQueueForTests(): void {
  void cancelScheduledIngestionDrain();
  scheduledRuntimeGeneration = 0;
  drainRunning = false;
}
