// ---------------------------------------------------------------------------
// Kavi — Memory lifecycle wiring
// ---------------------------------------------------------------------------
// Bridges the app shell to memory services.
//
// recordCompletedTurnForMemory — validate publication + enqueue async ingestion.
// runMemoryMigrationTick — periodic archived-thread backfill.
// runMemoryBackgroundFlush — drains the ingestion queue on background.
//
// All entry points honor the privacy opt-out (`disableLongTermMemory`).
// Turn publication rejects persistence failures so durable callers can hold
// their completion boundary closed until the exact source has been recorded.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import {
  drainIngestionQueueWithWakeup,
  enqueueIngestionJob,
  scheduleIngestionDrain,
  type IngestionJob,
  type IngestionJobRuntimeContext,
} from './ingestionQueue';
import { runMigrationSeedPass, type RunSeedPassResult } from './migrationSeedPass';
import { resolveConsolidationExtractor } from './consolidation/turnPipeline';
import { validateMemoryTurnPublication } from './turnProcessor';
import { resolveConversationModel } from '../llm/support/providerSupport';
import {
  requireExactMemoryScopeId,
  resolveCodeOwnedMemoryConversationId,
  resolveCodeOwnedMemoryPersonaId,
} from './memoryScopeIdentity';
import { encodeIngestionSourceSnapshot } from './ingestionSourceSnapshot';
import {
  resolveClosedTurnEndingAt,
  type ExactClosedTurnFailureReason,
} from './closedTurn';
import { runMemoryTransaction } from './access/transaction';
import { getMemoryPolicyEpoch, isMemoryPolicyEpochCurrent } from './policy';

const logger = createLogger('memory.lifecycle');

// ── Migration seed pass ───────────────────────────────────────────────────

const EMPTY_SEED_RESULT: RunSeedPassResult = {
  attempted: 0,
  completed: 0,
  inProgress: 0,
  errors: 0,
  skipped: 0,
  remainingConversations: 0,
  pending: [],
};

let lastSeedAt = 0;
const SEED_TICK_COOLDOWN_MS = 30_000;

function findConversation(threadId: string): Conversation | undefined {
  return useChatStore.getState().conversations.find((entry: Conversation) => entry.id === threadId);
}

function resolveActiveMemoryChatProvider(
  conversation?: Conversation,
): LlmProviderConfig | undefined {
  const settings = useSettingsStore.getState();
  const providerId = conversation?.providerId?.trim() || settings.activeProviderId?.trim();
  if (!providerId) return undefined;
  const provider = settings.providers.find(
    (candidate) => candidate.id === providerId && candidate.enabled,
  );
  if (!provider) return undefined;
  const model = resolveConversationModel(provider, {
    conversationModel: conversation?.modelOverride,
    activeProviderId: settings.activeProviderId,
    activeModel: settings.activeModel,
  });
  return model ? { ...provider, model } : provider;
}

export function loadIngestionJobRuntimeContext(job: IngestionJob): IngestionJobRuntimeContext {
  const provider = job.chatProviderId
    ? useSettingsStore
        .getState()
        .providers.find((candidate) => candidate.id === job.chatProviderId && candidate.enabled)
    : undefined;

  return {
    ...(provider
      ? { activeChatProvider: job.chatModel ? { ...provider, model: job.chatModel } : provider }
      : {}),
  };
}

/**
 * Run one migration tick. Safe to call on launch and on every foreground.
 * Throttled so two foreground events in quick succession don't spam the
 * extractor. Returns the per-call counters for telemetry.
 */
export async function runMemoryMigrationTick(
  options: {
    now?: number;
    force?: boolean;
  } = {},
): Promise<RunSeedPassResult> {
  const now = options.now ?? Date.now();
  if (!options.force && now - lastSeedAt < SEED_TICK_COOLDOWN_MS) {
    return EMPTY_SEED_RESULT;
  }
  lastSeedAt = now;

  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) {
    return runMigrationSeedPass({
      conversations: useChatStore.getState().conversations,
      extractor: null,
      disableLongTermMemory: true,
    });
  }

  const extractor = await resolveConsolidationExtractor();
  try {
    return await runMigrationSeedPass({
      conversations: useChatStore.getState().conversations,
      extractor: extractor ?? null,
    });
  } catch (error) {
    logger.devWarn(
      'runMemoryMigrationTick failed:',
      error instanceof Error ? error.message : String(error),
    );
    return EMPTY_SEED_RESULT;
  }
}

// ── Background flush ──────────────────────────────────────────────────────

/**
 * Drain pending ingestion jobs. Safe to call on background and startup.
 */
export async function runMemoryBackgroundFlush(): Promise<void> {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return;

  await drainIngestionQueueWithWakeup({
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });
}

/** Install the app-state runtime and request a non-blocking foreground drain. */
export function scheduleMemoryIngestionDrainFromAppState(): void {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return;
  scheduleIngestionDrain({
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });
}

// ── Main entry: record completed turn ─────────────────────────────────────

export interface RecordCompletedTurnForMemoryInput {
  threadId: string;
  memoryConversationId?: string | null;
  sourceEndMessageId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  providerEnrichment?: boolean;
  taskId?: string;
  sourceRunId?: string;
  now?: number;
}

export interface RecordCompletedTurnForMemoryResult {
  processed: boolean;
  enqueued: boolean;
  jobId: string | null;
  episodeId: string | null;
  factIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  enriched: boolean;
  skipped?:
    | 'opt_out'
    | 'ephemeral_thread'
    | 'withdrawn'
    | 'no_closed_turn'
    | 'source_identity_invalid';
}

function closedTurnSkipReason(
  reason: ExactClosedTurnFailureReason,
): 'no_closed_turn' | 'source_identity_invalid' {
  return reason === 'source_end_not_closed' ? 'no_closed_turn' : 'source_identity_invalid';
}

/**
 * Record a completed turn for memory. Exact source validation is immediate;
 * semantic working memory and durable consolidation run through provider-backed ingestion.
 */
export async function recordCompletedTurnForMemory(
  input: RecordCompletedTurnForMemoryInput,
): Promise<RecordCompletedTurnForMemoryResult> {
  const settings = useSettingsStore.getState();
  const policyEpoch = getMemoryPolicyEpoch();
  if (settings.disableLongTermMemory || !isMemoryPolicyEpochCurrent(policyEpoch)) {
    return {
      processed: false,
      enqueued: false,
      skipped: 'opt_out',
      jobId: null,
      episodeId: null,
      factIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      enriched: false,
    };
  }

  const threadId = requireExactMemoryScopeId(input.threadId, 'memory_scope_thread_id_invalid');
  const memoryConversationId = resolveCodeOwnedMemoryConversationId(
    input.memoryConversationId,
    threadId,
  );
  const conversation = findConversation(threadId);
  if (conversation?.isSideThread) {
    return {
      processed: false,
      enqueued: false,
      skipped: 'ephemeral_thread',
      jobId: null,
      episodeId: null,
      factIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      enriched: false,
    };
  }
  const personaId = resolveCodeOwnedMemoryPersonaId(conversation?.personaId);
  const sourceRunId = input.sourceRunId;
  const chatProvider = input.activeChatProvider ?? resolveActiveMemoryChatProvider(conversation);
  const closedTurn = resolveClosedTurnEndingAt(input.messages, input.sourceEndMessageId);
  if (closedTurn.status === 'invalid') {
    return {
      processed: false,
      enqueued: false,
      skipped: closedTurnSkipReason(closedTurn.reason),
      jobId: null,
      episodeId: null,
      factIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      enriched: false,
    };
  }
  const sourceAt = closedTurn.assistant.timestamp ?? input.now ?? Date.now();
  const sourceRun = sourceRunId
    ? conversation?.agentRuns?.find((run) => run.id === sourceRunId)
    : undefined;
  const sourceSnapshot = encodeIngestionSourceSnapshot({
    messages: input.messages,
    sourceStartMessageId: closedTurn.sourceStartMessageId,
    sourceEndMessageId: closedTurn.sourceEndMessageId,
    priorUserMessageId: closedTurn.priorUserMessageId,
    graphGoalEvidence: sourceRun?.controlGraph?.goals?.flatMap((goal) => goal.evidence) ?? [],
  });

  const policyChangedError = 'memory_turn_publication_policy_changed';
  let publication:
    | { disposition: 'opt_out' | 'withdrawn' }
    | {
        disposition: 'enqueued';
        job: NonNullable<ReturnType<typeof enqueueIngestionJob>>;
        validation: ReturnType<typeof validateMemoryTurnPublication>;
      };
  try {
    publication = runMemoryTransaction(() => {
      if (!isMemoryPolicyEpochCurrent(policyEpoch)) {
        return { disposition: 'opt_out' as const };
      }
      const job = enqueueIngestionJob({
        threadId: input.threadId,
        threadTitle: input.threadTitle ?? conversation?.title ?? null,
        memoryConversationId,
        personaId,
        sourceEndMessageId: closedTurn.sourceEndMessageId,
        sourceSnapshot,
        sourceAt,
        priorUserMessageId: closedTurn.priorUserMessageId,
        sourceStartMessageId: closedTurn.sourceStartMessageId,
        taskId: input.taskId ?? null,
        sourceRunId: sourceRunId ?? null,
        chatProviderId: chatProvider?.id ?? null,
        chatModel: chatProvider?.model ?? null,
        reason: 'turn_completed',
        providerEnrichment: input.providerEnrichment ?? true,
        now: input.now,
      });
      if (!job) return { disposition: 'withdrawn' as const };

      const validation = validateMemoryTurnPublication({
        threadId: input.threadId,
        memoryConversationId,
        sourceEndMessageId: closedTurn.sourceEndMessageId,
        messages: input.messages,
        threadTitle: input.threadTitle,
        personaSummary: input.personaSummary,
        taskId: input.taskId,
        now: input.now,
      });
      if (
        !validation.processed ||
        validation.sourceStartMessageId !== closedTurn.sourceStartMessageId ||
        validation.sourceEndMessageId !== closedTurn.sourceEndMessageId ||
        validation.priorUserMessageId !== closedTurn.priorUserMessageId
      ) {
        throw new Error('memory_turn_working_projection_source_mismatch');
      }
      if (!isMemoryPolicyEpochCurrent(policyEpoch)) throw new Error(policyChangedError);
      return { disposition: 'enqueued' as const, job, validation };
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== policyChangedError) throw error;
    publication = { disposition: 'opt_out' };
  }

  if (publication.disposition !== 'enqueued') {
    return {
      processed: false,
      enqueued: false,
      skipped: publication.disposition,
      jobId: null,
      episodeId: null,
      factIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      enriched: false,
    };
  }

  scheduleIngestionDrain({
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });

  return {
    processed: true,
    enqueued: true,
    jobId: publication.job.id,
    episodeId: null,
    factIds: [],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    enriched: false,
  };
}

/** Test seam — reset throttle so unit tests don't depend on real-time. */
export function __resetMemoryLifecycleForTests(): void {
  lastSeedAt = 0;
}
