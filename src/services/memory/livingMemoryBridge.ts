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

import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { listBlocks, type MemoryBlock } from './blocks';
import { getEntityById } from './entities';
import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { MemoryFact } from './facts/types';
import {
  orchestrateMemoryRetrieval,
  type RetrievalOrchestratorTimings,
} from './retrievalOrchestrator';
import type { NextTurnMemoryConsistencyResult } from './nextTurnConsistency';
import { renderFocusBlock, type FocusGap } from './focus';
import { assemblePrompt, type PromptMemoryFact, type SystemPromptSection } from './promptAssembly';
import { getWorkingBlock, type WorkingMemoryBlock } from './workingBlocks';
import { getActiveTaskId, readTaskStack } from './taskStack';
import { getLatestReflection } from './reflections';
import { createLlmMemoryFactSelector } from './llmFactSelector';
import {
  recordPromptAssemblyRetrievalEvent,
  type PromptAssemblyRetrievalEventResult,
  type PromptAssemblyRetrievalState,
} from './promptAssemblyRetrievalEvent';
import {
  buildLocalEvidencePrompt,
  type LocalEvidencePromptDiagnostics,
} from './localEvidencePromptBuilder';

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
  /** Concrete chat thread that initiated this retrieval. */
  sourceThreadId?: string;
  taskId?: string;
  /** Now (ms). Defaults to `Date.now()`. Test seam. */
  now?: number;
  /** Recall fanout. Default 12. */
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
  /** App-configured model used for optional semantic memory evidence selection. */
  retrievalLlm?: {
    provider: LlmProviderConfig;
    model?: string;
  };
  /** Exact bounded consistency result observed before this retrieval. */
  consistencyBarrier?: NextTurnMemoryConsistencyResult;
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
  /** Number of facts recalled. */
  recalledFactCount: number;
  /** Number of recent episodes included. */
  recalledEpisodeCount: number;
  /** Internal timing breakdown for product telemetry and benchmark diagnostics. */
  timings?: LivingMemoryBridgeTimings;
  /** Structured next-turn consistency state for graph observability. */
  consistencyBarrier?: NextTurnMemoryConsistencyResult;
  /** Content-free status of the structured retrieval evidence write. */
  retrievalEvent?: PromptAssemblyRetrievalEventResult;
  /** Content-free outcome and counts for exact-scope local provenance expansion. */
  localEvidenceExpansion?: LocalEvidencePromptDiagnostics;
}

export interface LivingMemoryBridgeTimings {
  taskStackMs: number;
  blockReadMs: number;
  workingBlockMs: number;
  focusRenderMs: number;
  retrievalMs: number;
  evidenceExpansionMs: number;
  reflectionMs: number;
  subjectLabelsMs: number;
  assembleMs: number;
  recordRetrievalEventMs: number;
  totalMs: number;
  retrieval?: RetrievalOrchestratorTimings;
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
  const totalStarted = Date.now();
  const timings: LivingMemoryBridgeTimings = {
    taskStackMs: 0,
    blockReadMs: 0,
    workingBlockMs: 0,
    focusRenderMs: 0,
    retrievalMs: 0,
    evidenceExpansionMs: 0,
    reflectionMs: 0,
    subjectLabelsMs: 0,
    assembleMs: 0,
    recordRetrievalEventMs: 0,
    totalMs: 0,
  };
  const {
    messages,
    now = Date.now(),
    recallLimit = 12,
    disableRecall = false,
    disableLongTermMemory = false,
    threadCreatedAt,
    conversationId,
    sourceThreadId,
    taskId,
    readBlocks,
    readWorkingBlock,
    readLatestReflection: readLatestReflectionOverride,
    goals,
    activeTaskId,
    asyncWork,
    retrievalLlm,
    consistencyBarrier,
  } = options;

  if (!Array.isArray(messages) || messages.length === 0) {
    return EMPTY_OUTPUT;
  }

  // When the user has opted out of long-term memory, we bail BEFORE any block read or recall query
  // so the SQLite path is not touched and the prompt stays stateless.
  if (disableLongTermMemory || consistencyBarrier?.outcome === 'opt_out') {
    return EMPTY_OUTPUT;
  }

  // Resolve active task: explicit taskId wins, otherwise read from task stack.
  let resolvedTaskId = taskId ?? null;
  let activeTaskTitle: string | null = null;
  if (!resolvedTaskId && conversationId) {
    const started = Date.now();
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
    timings.taskStackMs += Date.now() - started;
  }

  const blockStarted = Date.now();
  const blocks = safeListBlocks(readBlocks);
  timings.blockReadMs += Date.now() - blockStarted;
  const promptBlocks = blocks.filter((block) => SAFE_BLOCK_LABELS_FOR_PROMPT.has(block.label));

  const workingBlockStarted = Date.now();
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
  timings.workingBlockMs += Date.now() - workingBlockStarted;

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
  const focusStarted = Date.now();
  const focusRendered = renderFocusBlock(focusInput);
  timings.focusRenderMs += Date.now() - focusStarted;

  const query = recentUserTextWindow(messages);
  let recalledFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['facts'] = [];
  let recalledEpisodes: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['episodes'] = [];
  let retrievalTimings: RetrievalOrchestratorTimings | undefined;
  let retrievalState: PromptAssemblyRetrievalState = disableRecall ? 'disabled' : 'completed';
  const factSelector = createLlmMemoryFactSelector(retrievalLlm);
  if (!disableRecall) {
    const retrievalStarted = Date.now();
    try {
      const retrieval = await orchestrateMemoryRetrieval({
        userMessage: query,
        focusText: focusBlockText,
        goals,
        activeTaskId: activeTaskId ?? resolvedTaskId ?? undefined,
        asyncWork,
        ...(factSelector ? { factSelector } : {}),
        conversationId,
        taskId: resolvedTaskId ?? undefined,
        limit: recallLimit,
        now,
      });
      recalledFacts = retrieval.facts;
      recalledEpisodes = retrieval.episodes;
      retrievalTimings = retrieval.timings;
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.orchestrateMemoryRetrieval failed:',
        error instanceof Error ? error.message : String(error),
      );
      recalledFacts = [];
      recalledEpisodes = [];
      retrievalState = 'degraded';
    }
    timings.retrievalMs += Date.now() - retrievalStarted;
  }

  const localEvidencePrompt = buildLocalEvidencePrompt({
    facts: recalledFacts,
    episodes: recalledEpisodes,
    ...(conversationId ? { memoryConversationId: conversationId } : {}),
    ...(sourceThreadId ? { sourceThreadId } : {}),
    asOf: now,
  });
  timings.evidenceExpansionMs = localEvidencePrompt.diagnostics.durationMs;
  if (localEvidencePrompt.diagnostics.outcome === 'failed' && retrievalState === 'completed') {
    retrievalState = 'degraded';
  }

  const dynamicAddenda: string[] = [];
  if (activeTaskTitle) {
    dynamicAddenda.push(`Active task: ${activeTaskTitle}`);
  }
  let reflectionBlock = '';
  if (conversationId) {
    const reflectionStarted = Date.now();
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
    timings.reflectionMs += Date.now() - reflectionStarted;
  }

  const subjectLabelsStarted = Date.now();
  const factsForPrompt = withFactSubjectLabels(recalledFacts);
  timings.subjectLabelsMs += Date.now() - subjectLabelsStarted;
  const assembleStarted = Date.now();
  const assembled = assemblePrompt({
    basePrompt: '',
    blocks: promptBlocks,
    focusBlock: focusRendered.text,
    reflectionBlock: reflectionBlock.trim() || undefined,
    retrievedFacts: factsForPrompt,
    recentEpisodes: recalledEpisodes,
    retrievalQuery: query,
    ...(dynamicAddenda.length > 0 ? { dynamicAddenda } : {}),
  });
  timings.assembleMs += Date.now() - assembleStarted;
  const sections = localEvidencePrompt.section
    ? [...assembled.sections, { text: localEvidencePrompt.section }]
    : assembled.sections;

  const idleAnchor = lastAssistantAt ?? lastUserAt;
  const idleSinceLastTurnMs =
    typeof idleAnchor === 'number' ? Math.max(now - idleAnchor, 0) : undefined;

  const eventStarted = Date.now();
  const retrievalEvent = await recordPromptAssemblyRetrievalEvent({
    query,
    ...(conversationId ? { memoryConversationId: conversationId } : {}),
    ...(sourceThreadId ? { sourceThreadId } : {}),
    taskScopePresent: Boolean(resolvedTaskId ?? activeTaskId),
    state: retrievalState,
    selectedFactIds: recalledFacts.map((fact) => fact.id),
    selectedEpisodeIds: recalledEpisodes.map((episode) => episode.id),
    expansion: localEvidencePrompt.diagnostics,
    ...(retrievalTimings ? { retrievalTimings } : {}),
    ...(consistencyBarrier ? { consistencyBarrier } : {}),
    createdAt: now,
  });
  timings.recordRetrievalEventMs += Date.now() - eventStarted;
  timings.totalMs = Date.now() - totalStarted;
  if (retrievalTimings) timings.retrieval = retrievalTimings;

  return {
    sections,
    cacheableSignature: assembled.cacheableSignature,
    focusBlockText,
    openThreadLabels,
    ...(typeof idleSinceLastTurnMs === 'number' ? { idleSinceLastTurnMs } : {}),
    focusGap: focusRendered.gap,
    recalledFactCount: recalledFacts.length,
    recalledEpisodeCount: recalledEpisodes.length,
    timings,
    retrievalEvent,
    localEvidenceExpansion: localEvidencePrompt.diagnostics,
  };
}
