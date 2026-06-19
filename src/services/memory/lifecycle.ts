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

import { resolveGraphTaskId } from '../../engine/goals/graphTaskScope';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import {
  drainIngestionQueue,
  enqueueIngestionJob,
  scheduleIngestionDrain,
  type GraphGoalEvidenceContext,
} from './ingestionQueue';
import { runMigrationSeedPass, type RunSeedPassResult } from './migrationSeedPass';
import { resolveConsolidationExtractor } from './consolidation/turnPipeline';
import { syncWorkingMemoryFromTurn } from './turnProcessor';
import { editWorkingBlock, getWorkingBlock } from './workingBlocks';
import { ACTIVE_FOCUS_MEMORY_CHAR_LIMIT, composeActiveFocusContent } from './focus';

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

export function loadGraphGoalEvidenceContext(threadId: string): GraphGoalEvidenceContext {
  const conversation = useChatStore
    .getState()
    .conversations.find((entry: Conversation) => entry.id === threadId);
  if (!conversation) {
    return { evidence: [] };
  }

  const latestRun = [...(conversation.agentRuns ?? [])].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  const goals = latestRun?.controlGraph?.goals ?? [];
  const taskId = resolveGraphTaskId({
    goals,
    activeTaskId: latestRun?.controlGraph?.activeTaskId,
  });

  return {
    evidence: Array.from(new Set(goals.flatMap((goal) => goal.evidence))),
    ...(latestRun?.id ? { sourceRunId: latestRun.id } : {}),
    ...(taskId ? { taskId } : {}),
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

  await drainIngestionQueue({
    loadMessagesForThread,
    loadGraphGoalEvidenceForThread: loadGraphGoalEvidenceContext,
  });
}

// ── Main entry: record completed turn ─────────────────────────────────────

export interface RecordCompletedTurnForMemoryInput {
  threadId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  activeChatProvider?: LlmProviderConfig;
  taskId?: string;
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
  threadId: string;
  threadTitle?: string;
  now?: number;
}): boolean {
  const threadId = input.threadId.trim();
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

  const conversationFocusUpdated = syncConversationFocusFromThreadTitle({
    threadId: input.threadId,
    threadTitle: input.threadTitle,
    now: input.now,
  });
  const syncResult = syncWorkingMemoryFromTurn({
    threadId: input.threadId,
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
    sourceEndMessageId: syncResult.sourceEndMessageId,
    sourceStartMessageId: syncResult.sourceStartMessageId,
    taskId: input.taskId ?? null,
    now: input.now,
  });

  scheduleIngestionDrain(
    loadMessagesForThread,
    loadGraphGoalEvidenceContext,
    input.activeChatProvider,
    input.threadTitle,
  );

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
