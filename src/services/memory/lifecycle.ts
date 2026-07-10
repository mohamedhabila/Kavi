// ---------------------------------------------------------------------------
// Kavi — Memory lifecycle wiring
// ---------------------------------------------------------------------------
// Bridges the app shell to memory services.
//
// recordCompletedTurnForMemory — sync Layer-1 update + enqueue async ingestion.
// runMemoryMigrationTick — periodic archived-thread backfill.
// runMemoryBackgroundFlush — drains the ingestion queue on background.
//
// All entry points honor the privacy opt-out (`disableLongTermMemory`).
// None of these calls ever throw out of the lifecycle hook.
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
import { syncWorkingMemoryFromTurn } from './turnProcessor';
import { editWorkingBlock, getWorkingBlock } from './workingBlocks';
import { ACTIVE_FOCUS_MEMORY_CHAR_LIMIT, composeActiveFocusContent } from './focus';
import { resolveConversationModel } from '../llm/support/providerSupport';

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

function loadMessagesForThread(threadId: string): Message[] {
  const conversation = useChatStore
    .getState()
    .conversations.find((entry: Conversation) => entry.id === threadId);
  return conversation?.messages ?? [];
}

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
  const conversation = findConversation(job.threadId);
  const sourceRun = job.sourceRunId
    ? conversation?.agentRuns?.find((run) => run.id === job.sourceRunId)
    : undefined;
  const goals = sourceRun?.controlGraph?.goals ?? [];
  const provider = job.chatProviderId
    ? useSettingsStore
        .getState()
        .providers.find((candidate) => candidate.id === job.chatProviderId && candidate.enabled)
    : undefined;

  return {
    ...(job.threadTitle ? { threadTitle: job.threadTitle } : {}),
    ...(provider
      ? { activeChatProvider: job.chatModel ? { ...provider, model: job.chatModel } : provider }
      : {}),
    ...(job.sourceRunId ? { sourceRunId: job.sourceRunId } : {}),
    ...(sourceRun
      ? {
          graphGoalEvidence: Array.from(new Set(goals.flatMap((goal) => goal.evidence))),
        }
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
    loadMessagesForThread,
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });
}

// ── Main entry: record completed turn ─────────────────────────────────────

export interface RecordCompletedTurnForMemoryInput {
  threadId: string;
  memoryConversationId?: string | null;
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
  skipped?: 'opt_out' | 'no_closed_turn';
}

function composeConversationFocusFromThreadTitle(
  threadTitle: string,
  existingContent: string | undefined,
): string {
  return composeActiveFocusContent({
    threadTitle,
    activeFocus: existingContent,
    maxChars: ACTIVE_FOCUS_MEMORY_CHAR_LIMIT,
  });
}

function syncConversationFocusFromThreadTitle(input: {
  memoryConversationId: string;
  threadTitle?: string;
  now?: number;
}): boolean {
  const threadId = input.memoryConversationId.trim();
  const threadTitle = input.threadTitle?.trim();
  if (!threadId || !threadTitle) return false;

  const scope = { conversationId: threadId, threadId };
  try {
    const existing = getWorkingBlock('active_focus', scope)?.content;
    if (existing?.includes(threadTitle)) {
      return false;
    }
    const content = composeConversationFocusFromThreadTitle(threadTitle, existing);
    if (!content) return false;
    editWorkingBlock('active_focus', content, scope, { now: input.now });
    return true;
  } catch (error) {
    logger.devWarn(
      'Conversation focus metadata sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Record a completed turn for memory. Sync Layer-1 update is immediate;
 * durable consolidation is enqueued and drained asynchronously.
 */
export async function recordCompletedTurnForMemory(
  input: RecordCompletedTurnForMemoryInput,
): Promise<RecordCompletedTurnForMemoryResult> {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) {
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

  const threadId = input.threadId.trim();
  const memoryConversationId = input.memoryConversationId?.trim() || threadId;
  const conversation = findConversation(threadId);
  const sourceRunId =
    input.sourceRunId?.trim() || conversation?.activeAgentRunId?.trim() || undefined;
  const chatProvider = input.activeChatProvider ?? resolveActiveMemoryChatProvider(conversation);

  const conversationFocusUpdated = syncConversationFocusFromThreadTitle({
    memoryConversationId,
    threadTitle: input.threadTitle,
    now: input.now,
  });
  const syncResult = syncWorkingMemoryFromTurn({
    threadId: input.threadId,
    memoryConversationId,
    messages: input.messages,
    threadTitle: input.threadTitle,
    personaSummary: input.personaSummary,
    taskId: input.taskId,
    now: input.now,
  });

  if (!syncResult.processed || !syncResult.sourceEndMessageId) {
    return {
      processed: false,
      enqueued: false,
      skipped: syncResult.skipped,
      jobId: null,
      episodeId: null,
      factIds: [],
      activeFocusUpdated: conversationFocusUpdated,
      openThreadsUpdated: false,
      enriched: false,
    };
  }

  const job = enqueueIngestionJob({
    threadId: input.threadId,
    threadTitle: input.threadTitle ?? conversation?.title ?? null,
    memoryConversationId,
    sourceEndMessageId: syncResult.sourceEndMessageId,
    sourceAt:
      input.messages.find((message) => message.id === syncResult.sourceEndMessageId)?.timestamp ??
      input.now,
    sourceStartMessageId: syncResult.sourceStartMessageId,
    taskId: input.taskId ?? null,
    sourceRunId: sourceRunId ?? null,
    chatProviderId: chatProvider?.id ?? null,
    chatModel: chatProvider?.model ?? null,
    providerEnrichment: input.providerEnrichment,
    now: input.now,
  });

  scheduleIngestionDrain({
    loadMessagesForThread: (candidateThreadId) =>
      candidateThreadId === threadId ? input.messages : loadMessagesForThread(candidateThreadId),
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });

  return {
    processed: true,
    enqueued: job !== null,
    jobId: job?.id ?? null,
    episodeId: null,
    factIds: [],
    activeFocusUpdated: syncResult.activeFocusUpdated || conversationFocusUpdated,
    openThreadsUpdated: syncResult.openThreadsUpdated,
    enriched: false,
  };
}

/** Test seam — reset throttle so unit tests don't depend on real-time. */
export function __resetMemoryLifecycleForTests(): void {
  lastSeedAt = 0;
}
