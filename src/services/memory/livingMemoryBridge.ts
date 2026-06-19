// ---------------------------------------------------------------------------
// Living Memory bridge
// ---------------------------------------------------------------------------
// Threads the memory blocks, focus block and per-turn fact recall through
// `assemblePrompt()` and surfaces the result in a shape that the orchestrator
// can splice into its existing system-prompt sections + compaction calls
// without touching the legacy file-backed memory pipe.
//
// The bridge is intentionally defensive:
//
//   - Block reads tolerate a missing schema (returns empty list).
//   - Recall failures degrade to "no facts" — never throws.
//   - Empty inputs produce zero sections so callers can blindly append.
// ---------------------------------------------------------------------------

import type { EmbeddingConfig } from '../../types/memory';
import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';
import { listBlocks, type MemoryBlock } from './blocks';
import { getEntityById } from './entities';
import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { MemoryFact } from './facts/types';
import { orchestrateMemoryRetrieval } from './retrievalOrchestrator';
import { renderFocusBlock, type FocusGap } from './focus';
import { assemblePrompt, type PromptMemoryFact, type SystemPromptSection } from './promptAssembly';
import { getWorkingBlock, type WorkingMemoryBlock } from './workingBlocks';
import { getActiveTaskId, readTaskStack } from './taskStack';
import { logRetrieval } from './retrievalLog';
import { getLatestReflection } from './reflections';

const logger = createLogger('memory.livingMemoryBridge');

const FOCUS_BLOCK_LABEL = 'active_focus';
const OPEN_THREADS_LABEL = 'open_threads';
const RECENT_USER_QUERY_WINDOW_TURNS = 4;
const RECENT_USER_QUERY_WINDOW_CHARS = 2_000;

const SAFE_BLOCK_LABELS_FOR_PROMPT = new Set<string>([
  'profile',
  'persona',
  'preferences',
  // active_focus content is funnelled through the focus block instead.
  // open_threads is used for compaction summary, not the L2 prompt blob.
]);

export interface BuildLivingMemorySectionsOptions {
  /** Working messages (after enrichment). Used for last-assistant timestamp + recall query. */
  messages: Message[];
  /** Thread/conversation creation timestamp (ms). Falls back to first message timestamp or now. */
  threadCreatedAt?: number;
  /** Conversation/task hints used to boost scoped recall. */
  conversationId?: string;
  taskId?: string;
  /** Now (ms). Defaults to `Date.now()`. Test seam. */
  now?: number;
  /** Optional embedding config — when omitted, recall uses lexical scoring only. */
  embeddingConfig?: EmbeddingConfig;
  /** Recall fanout. Default 6. */
  recallLimit?: number;
  /** When true, skip recall entirely (e.g. for tool-only iterations). */
  disableRecall?: boolean;
  /**
   * When the user has opted out of long-term memory,
   * the bridge returns the empty output so no blocks, focus header or
   * retrieved facts ever enter the prompt. The orchestrator forwards the
   * `disableLongTermMemory` setting from `useSettingsStore`.
   */
  disableLongTermMemory?: boolean;
  /** Override block reader (test seam). */
  readBlocks?: () => MemoryBlock[];
  /** Override scoped working block reader (test seam). */
  readWorkingBlock?: (label: 'active_focus' | 'open_threads') => WorkingMemoryBlock | null;
  /** Override reflection reader (test seam). */
  readLatestReflection?: (threadId: string) => string | null;
  /** Graph-owned goals for multi-signal retrieval. */
  goals?: ReadonlyArray<AgentGoal>;
  /** Graph active task id (typically active goal id). */
  activeTaskId?: string;
  /** Graph async work state for retrieval signals. */
  asyncWork?: AgentRunControlGraphAsyncWorkState;
}

export interface LivingMemoryBridgeOutput {
  /** Sections to append to the existing system-prompt sections array. */
  sections: SystemPromptSection[];
  /** Stable hash of the provider-cacheable prefix. Memory sections are dynamic until epoch admission. */
  cacheableSignature: string;
  /** Trimmed `active_focus` block content (for compaction `focusBlock` param). */
  focusBlockText: string;
  /** Open-thread labels split on newlines (for compaction `openThreads` param). */
  openThreadLabels: string[];
  /** Milliseconds since the last assistant turn (or user turn). */
  idleSinceLastTurnMs?: number;
  /** Categorised gap bucket for telemetry. */
  focusGap?: FocusGap;
  /** Number of facts recalled (post text-only fallback). */
  recalledFactCount: number;
  /** Number of recent episodes included. */
  recalledEpisodeCount: number;
}

const EMPTY_OUTPUT: LivingMemoryBridgeOutput = {
  sections: [],
  cacheableSignature: '00000000',
  focusBlockText: '',
  openThreadLabels: [],
  recalledFactCount: 0,
  recalledEpisodeCount: 0,
};

function safeListBlocks(reader?: () => MemoryBlock[]): MemoryBlock[] {
  try {
    return reader ? reader() : listBlocks();
  } catch (error) {
    logger.devWarn(
      'livingMemoryBridge.listBlocks failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function findBlock(blocks: MemoryBlock[], label: string): MemoryBlock | undefined {
  return blocks.find((b) => b.label === label);
}

function safeGetWorkingBlock(
  label: 'active_focus' | 'open_threads',
  options: Pick<BuildLivingMemorySectionsOptions, 'conversationId' | 'taskId' | 'readWorkingBlock'>,
): WorkingMemoryBlock | null {
  try {
    if (options.readWorkingBlock) return options.readWorkingBlock(label);
    if (!options.conversationId && !options.taskId) return null;
    return getWorkingBlock(label, {
      conversationId: options.conversationId,
      threadId: options.conversationId,
      taskId: options.taskId,
    });
  } catch (error) {
    logger.devWarn(
      `livingMemoryBridge.getWorkingBlock(${label}) failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function lastTimestamp(messages: Message[], role: Message['role']): number | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== role) continue;
    const ts = typeof message.timestamp === 'number' ? message.timestamp : undefined;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  }
  return undefined;
}

function inferThreadCreatedAt(messages: Message[], fallback: number): number {
  for (const message of messages) {
    if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
      return message.timestamp;
    }
  }
  return fallback;
}

function recentUserTextWindow(
  messages: Message[],
  maxTurns = RECENT_USER_QUERY_WINDOW_TURNS,
  maxChars = RECENT_USER_QUERY_WINDOW_CHARS,
): string {
  const turns: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    const candidate = (message.enrichedContent ?? message.content ?? '').trim();
    if (candidate.length > 0) turns.push(candidate);
    if (turns.length >= maxTurns) break;
  }
  const joined = turns.reverse().join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(joined.length - maxChars).trimStart();
}

function splitThreadLabels(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*+\d.\s)]+/, '').trim())
    .filter((line) => line.length > 0);
}

function getFactSubjectLabel(subjectId: string): string {
  try {
    return getEntityById(subjectId)?.canonicalName ?? subjectId;
  } catch {
    return subjectId;
  }
}

function withFactSubjectLabels(facts: ReadonlyArray<MemoryFact>): PromptMemoryFact[] {
  return facts.map((fact) => ({
    ...fact,
    subjectLabel: getFactSubjectLabel(fact.subjectId),
  }));
}

/**
 * Build the per-request memory-aware sections + the inputs the compaction
 * engine needs (focus / open threads / idle gap). Safe to call once per
 * request; reuse the result across iterations of the same user turn.
 */
export async function buildLivingMemorySections(
  options: BuildLivingMemorySectionsOptions,
): Promise<LivingMemoryBridgeOutput> {
  const {
    messages,
    now = Date.now(),
    embeddingConfig,
    recallLimit = 6,
    disableRecall = false,
    disableLongTermMemory = false,
    threadCreatedAt,
    conversationId,
    taskId,
    readBlocks,
    readWorkingBlock,
    readLatestReflection: readLatestReflectionOverride,
    goals,
    activeTaskId,
    asyncWork,
  } = options;

  if (!Array.isArray(messages) || messages.length === 0) {
    return EMPTY_OUTPUT;
  }

  // When the user has opted out of long-term memory, we bail BEFORE any block read or recall query
  // so the SQLite path is not touched and the prompt stays stateless.
  if (disableLongTermMemory) {
    return EMPTY_OUTPUT;
  }

  // Resolve active task: explicit taskId wins, otherwise read from task stack.
  let resolvedTaskId = taskId ?? null;
  let activeTaskTitle: string | null = null;
  if (!resolvedTaskId && conversationId) {
    try {
      resolvedTaskId = getActiveTaskId(conversationId);
      if (resolvedTaskId) {
        activeTaskTitle =
          readTaskStack(conversationId).find((t) => t.id === resolvedTaskId)?.title ?? null;
      }
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.taskStack read failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const blocks = safeListBlocks(readBlocks);
  const promptBlocks = blocks.filter((block) => SAFE_BLOCK_LABELS_FOR_PROMPT.has(block.label));

  const scopedFocusBlock = safeGetWorkingBlock(FOCUS_BLOCK_LABEL, {
    conversationId,
    taskId: resolvedTaskId ?? undefined,
    readWorkingBlock,
  });
  const focusBlockSource =
    scopedFocusBlock ?? (!conversationId ? findBlock(blocks, FOCUS_BLOCK_LABEL) : null);
  const focusBlockText = (focusBlockSource?.content ?? '').trim();

  const scopedOpenThreads = safeGetWorkingBlock(OPEN_THREADS_LABEL, {
    conversationId,
    taskId: resolvedTaskId ?? undefined,
    readWorkingBlock,
  });
  const openThreadsSource =
    scopedOpenThreads ?? (!conversationId ? findBlock(blocks, OPEN_THREADS_LABEL) : null);
  const openThreadLabels = splitThreadLabels(openThreadsSource?.content ?? '');

  const lastAssistantAt = lastTimestamp(messages, 'assistant');
  const lastUserAt = lastTimestamp(messages, 'user');
  const inferredCreatedAt = threadCreatedAt ?? inferThreadCreatedAt(messages, now);

  const focusInput: Parameters<typeof renderFocusBlock>[0] = {
    now,
    threadCreatedAt: inferredCreatedAt,
    ...(typeof lastAssistantAt === 'number' ? { lastAssistantAt } : {}),
    ...(typeof lastUserAt === 'number' ? { lastUserAt } : {}),
    ...(focusBlockText ? { activeFocus: focusBlockText } : {}),
    ...(openThreadLabels.length > 0 ? { openThreads: openThreadLabels } : {}),
  };
  const focusRendered = renderFocusBlock(focusInput);

  const query = recentUserTextWindow(messages);
  let recalledFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['facts'] = [];
  let recalledEpisodes: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['episodes'] = [];
  if (!disableRecall) {
    try {
      const retrieval = await orchestrateMemoryRetrieval({
        userMessage: query,
        focusText: focusBlockText,
        goals,
        activeTaskId: activeTaskId ?? resolvedTaskId ?? undefined,
        asyncWork,
        conversationId,
        taskId: resolvedTaskId ?? undefined,
        embeddingConfig,
        limit: recallLimit,
        now,
      });
      recalledFacts = retrieval.facts;
      recalledEpisodes = retrieval.episodes;
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.orchestrateMemoryRetrieval failed:',
        error instanceof Error ? error.message : String(error),
      );
      recalledFacts = [];
      recalledEpisodes = [];
    }
  }

  const dynamicAddenda: string[] = [];
  if (activeTaskTitle) {
    dynamicAddenda.push(`Active task: ${activeTaskTitle}`);
  }

  let reflectionBlock = '';
  if (conversationId) {
    try {
      reflectionBlock =
        readLatestReflectionOverride?.(conversationId) ??
        getLatestReflection({ threadId: conversationId, kind: 'daily_focus' })?.content ??
        '';
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.getLatestReflection failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const assembled = assemblePrompt({
    basePrompt: '',
    blocks: promptBlocks,
    focusBlock: focusRendered.text,
    reflectionBlock: reflectionBlock.trim() || undefined,
    retrievedFacts: withFactSubjectLabels(recalledFacts),
    recentEpisodes: recalledEpisodes,
    ...(dynamicAddenda.length > 0 ? { dynamicAddenda } : {}),
  });

  const idleAnchor = lastAssistantAt ?? lastUserAt;
  const idleSinceLastTurnMs =
    typeof idleAnchor === 'number' ? Math.max(now - idleAnchor, 0) : undefined;

  // Rough telemetry estimate; provider token accounting records exact usage.
  const assembledText = assembled.sections.map((s) => s.text).join('\n\n');
  const tokenEstimate = Math.ceil(assembledText.length / 4);

  logRetrieval({
    threadId: conversationId ?? null,
    taskId: resolvedTaskId ?? null,
    query: query.slice(0, 500),
    factIds: recalledFacts.map((f) => f.id),
    episodeIds: recalledEpisodes.map((e) => e.id),
    tokenEstimate,
  });

  return {
    sections: assembled.sections,
    cacheableSignature: assembled.cacheableSignature,
    focusBlockText,
    openThreadLabels,
    ...(typeof idleSinceLastTurnMs === 'number' ? { idleSinceLastTurnMs } : {}),
    focusGap: focusRendered.gap,
    recalledFactCount: recalledFacts.length,
    recalledEpisodeCount: recalledEpisodes.length,
  };
}
