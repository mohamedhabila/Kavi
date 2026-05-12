// ---------------------------------------------------------------------------
// Kavi — Memory lifecycle wiring
// ---------------------------------------------------------------------------
// Bridges the always-on app shell to:
//   • `runMigrationSeedPass`  — periodically advance the v6→v7 archived-thread
//                               consolidation backlog.
//   • `flushAllDirtyThreads`  — flush dirty consolidator state when the app
//                               moves to background.
//
// All entry points honor the privacy opt-out (`disableLongTermMemory`) and
// gracefully no-op when no `consolidationProvider` is configured. None of
// these calls ever throw out of the lifecycle hook.
// ---------------------------------------------------------------------------

import type { ConsolidatorExtractor } from './consolidator';
import { applyHeuristicTurnMemory } from './consolidator';
import {
  flushAllDirtyThreads,
  markThreadDirtyForMemory,
  maybeRunConsolidation,
  type MarkThreadDirtyResult,
  type RunConsolidationResult,
} from './consolidatorScheduler';
import { runMigrationSeedPass, type RunSeedPassResult } from './migrationSeedPass';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { resolveProviderApiKey } from '../llm/providerSupport';
import { createLogger } from '../../utils/logger';
import type { LlmProviderConfig, Conversation, Message } from '../../types';

const logger = createLogger('memory.lifecycle');

// ── Default extractor backed by an OpenAI-compatible chat completion ──────
//
// When the user picks a `consolidationProvider`, we call its OpenAI-style
// `/v1/chat/completions` endpoint with the consolidator prompt and return
// the raw assistant text. The consolidator parser is tolerant — non-JSON
// or empty strings degrade to `{ newFacts: [], ... }` so a misconfigured
// endpoint never poisons memory.
function buildOpenAICompatibleExtractor(
  provider: LlmProviderConfig,
  apiKey: string | null,
): ConsolidatorExtractor {
  return async (prompt: string) => {
    const baseUrl = (provider.baseUrl ?? '').replace(/\/+$/, '');
    if (!baseUrl) return '';
    const url = `${baseUrl}/chat/completions`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 800,
        }),
      });
      if (!resp.ok) return '';
      const data: any = await resp.json();
      return String(data?.choices?.[0]?.message?.content ?? '');
    } catch (error) {
      logger.devWarn(
        'Default extractor failed:',
        error instanceof Error ? error.message : String(error),
      );
      return '';
    }
  };
}

interface ResolvedConsolidator {
  provider: LlmProviderConfig;
  extractor: ConsolidatorExtractor;
}

async function resolveConsolidator(): Promise<ResolvedConsolidator | null> {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return null;
  const providerId = (settings.consolidationProvider ?? '').trim();
  if (!providerId) return null;
  const provider = settings.providers.find((p) => p.id === providerId && p.enabled);
  if (!provider) return null;
  const apiKey = await resolveProviderApiKey(provider);
  return {
    provider,
    extractor: buildOpenAICompatibleExtractor(provider, apiKey ?? null),
  };
}

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

/**
 * Run one migration tick. Safe to call on launch and on every foreground.
 * Throttled so two foreground events in quick succession don't spam the
 * extractor. Returns the per-call counters for telemetry.
 */
export async function runMemoryMigrationTick(options: {
  now?: number;
  /** When true, skip the cooldown (used by manual "retry" buttons). */
  force?: boolean;
} = {}): Promise<RunSeedPassResult> {
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

  const resolved = await resolveConsolidator();
  if (!resolved) {
    return runMigrationSeedPass({
      conversations: useChatStore.getState().conversations,
      extractor: null,
    });
  }

  try {
    return await runMigrationSeedPass({
      conversations: useChatStore.getState().conversations,
      extractor: resolved.extractor,
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

function loadMessagesForThread(threadId: string): Message[] {
  const conv = useChatStore
    .getState()
    .conversations.find((c: Conversation) => c.id === threadId);
  return conv?.messages ?? [];
}

/**
 * Flush all dirty consolidator threads when the app backgrounds. No-ops when
 * memory is disabled or no consolidationProvider is configured.
 */
export async function runMemoryBackgroundFlush(): Promise<void> {
  const settings = useSettingsStore.getState();
  if (settings.disableLongTermMemory) return;
  const resolved = await resolveConsolidator();
  if (!resolved) return;
  try {
    await flushAllDirtyThreads({
      loadMessages: loadMessagesForThread,
      consolidationProvider: resolved.provider.id,
      extractor: resolved.extractor,
    });
  } catch (error) {
    logger.devWarn(
      'runMemoryBackgroundFlush failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function findLastAssistant(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return undefined;
}

function findLastUserBefore(messages: Message[], messageId: string | undefined): Message | undefined {
  const anchorIndex = messageId
    ? messages.findIndex((message) => message.id === messageId)
    : messages.length - 1;
  for (let index = Math.max(anchorIndex, 0); index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index];
  }
  return undefined;
}

export interface RecordCompletedTurnForMemoryInput {
  threadId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
}

export interface RecordCompletedTurnForMemoryResult {
  dirty: MarkThreadDirtyResult;
  consolidation?: RunConsolidationResult;
  heuristicFocusUpdated?: boolean;
  heuristicOpenThreadsUpdated?: boolean;
  skipped?: 'opt_out' | 'no_closed_turn' | 'no_new_turns' | 'no_provider';
}

export async function recordCompletedTurnForMemory(
  input: RecordCompletedTurnForMemoryInput,
): Promise<RecordCompletedTurnForMemoryResult> {
  const settings = useSettingsStore.getState();
  const dirty = markThreadDirtyForMemory({
    threadId: input.threadId,
    messages: input.messages,
    disableLongTermMemory: settings.disableLongTermMemory === true,
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });

  if (!dirty.marked) {
    return { dirty, skipped: dirty.skipped };
  }

  const resolved = await resolveConsolidator();
  if (!resolved) {
    const assistant = findLastAssistant(input.messages);
    const user = findLastUserBefore(input.messages, assistant?.id);
    const heuristic = user && assistant
      ? applyHeuristicTurnMemory(
          {
            userMessage: user.content ?? '',
            assistantMessage: assistant.content ?? '',
            conversationId: input.threadId,
            threadId: input.threadId,
            sourceUserMessageId: user.id,
            sourceAssistantMessageId: assistant.id,
            messages: input.messages,
            ...(input.threadTitle ? { threadTitle: input.threadTitle } : {}),
            ...(typeof input.now === 'number' ? { now: input.now } : {}),
          },
          { ...(typeof input.now === 'number' ? { now: input.now } : {}) },
        )
      : { activeFocusUpdated: false, openThreadsUpdated: false };
    logger.devWarn('recordCompletedTurnForMemory skipped consolidation: no provider configured');
    return {
      dirty,
      heuristicFocusUpdated: heuristic.activeFocusUpdated,
      heuristicOpenThreadsUpdated: heuristic.openThreadsUpdated,
      skipped: 'no_provider',
    };
  }

  const consolidation = await maybeRunConsolidation({
    threadId: input.threadId,
    messages: input.messages,
    consolidationProvider: resolved.provider.id,
    extractor: resolved.extractor,
    ...(input.threadTitle ? { threadTitle: input.threadTitle } : {}),
    ...(input.personaSummary ? { personaSummary: input.personaSummary } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
    ...(typeof input.turnThreshold === 'number' ? { turnThreshold: input.turnThreshold } : {}),
    ...(typeof input.idleThresholdMs === 'number'
      ? { idleThresholdMs: input.idleThresholdMs }
      : {}),
  });

  return { dirty, consolidation };
}

/** Test seam — reset throttle so unit tests don't depend on real-time. */
export function __resetMemoryLifecycleForTests(): void {
  lastSeedAt = 0;
}
