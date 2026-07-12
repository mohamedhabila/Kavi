// ---------------------------------------------------------------------------
// Living Memory bridge
// ---------------------------------------------------------------------------
// Threads scoped working state and per-turn fact recall through
// `assemblePrompt()` and surfaces the result in a shape that the orchestrator
// can splice into its existing system-prompt sections + compaction calls
// without touching the legacy file-backed memory pipe.
//
// The bridge is intentionally defensive:
//
//   - Recall failures degrade to "no facts" — never throws.
//   - Empty inputs produce zero sections so callers can blindly append.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { createLogger } from '../../utils/logger';
import { getEntityById } from './entities';
import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type {
  RecallCandidateStrategy,
  RecallLocalSimilarityInput,
} from './factRecallCandidateContract';
import {
  orchestrateMemoryRetrieval,
  type RetrievalOrchestratorTimings,
} from './retrievalOrchestrator';
import type { NextTurnMemoryConsistencyResult } from './nextTurnConsistency';
import { renderFocusBlock, type FocusGap } from './focus';
import { assemblePrompt, type PromptMemoryFact, type SystemPromptSection } from './promptAssembly';
import { getWorkingBlock, type WorkingMemoryBlock } from './workingBlocks';
import { readTaskStack } from './taskStack';
import { getApplicableLatestReflectionContent } from './reflections';
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
import {
  applyMemoryApplicabilityPolicy,
  emptyMemoryApplicabilitySummary,
} from './memoryApplicabilityPolicy';
import type {
  MemoryApplicabilitySummary,
  MemoryApplicabilityUseIntent,
  MemoryExternalEvidenceSignal,
} from './memoryApplicabilityTypes';
import { selectMemoryApplicabilityResolutionFactIds } from './memoryApplicabilityPrompt';
import { loadActiveMemoryFactConflictSignals } from './facts/observations';
import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';
import { resolveLocalMemoryAccessScope } from './memoryScopeStore';
import { markFactsRecalled } from './facts/mutations';
import { buildRecentUserRetrievalQuery } from './retrievalQueryText';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from './policy';

const logger = createLogger('memory.livingMemoryBridge');

const FOCUS_BLOCK_LABEL = 'active_focus';
const OPEN_THREADS_LABEL = 'open_threads';

export interface BuildLivingMemorySectionsOptions {
  /** Working messages (after enrichment). Used for last-assistant timestamp + recall query. */
  messages: Message[];
  /** Thread/conversation creation timestamp (ms). Falls back to first message timestamp or now. */
  threadCreatedAt?: number;
  /** Conversation/task hints used to boost scoped recall. */
  conversationId: string;
  /** Concrete chat thread that initiated this retrieval. */
  sourceThreadId: string;
  taskId: string | null;
  /** Active persona identity for exact binding of persona-scoped facts. */
  personaId: string;
  /** Now (ms). Defaults to `Date.now()`. Test seam. */
  now?: number;
  /** Recall fanout. Default 12. */
  recallLimit?: number;
  /** When true, skip recall entirely (e.g. for tool-only iterations). */
  disableRecall?: boolean;
  /**
   * When the user has opted out of long-term memory,
   * the bridge returns the empty output so no working state, focus header or
   * retrieved facts ever enter the prompt. The orchestrator forwards the
   * `disableLongTermMemory` setting from `useSettingsStore`.
   */
  disableLongTermMemory?: boolean;
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
  /** Structural use intent supplied by trusted caller code; never inferred from request text. */
  memoryUseIntent?: MemoryApplicabilityUseIntent;
  /** Optional current structured evidence from trusted caller code. */
  externalMemoryEvidence?: ReadonlyArray<MemoryExternalEvidenceSignal>;
  /** Candidate strategy selected by the product memory-access policy. */
  candidateStrategy?: RecallCandidateStrategy;
  /** One deterministic query vector created by the memory-access gateway. */
  localSimilarity?: RecallLocalSimilarityInput;
  /** One enabled read generation spanning barrier, selector, prompt, and telemetry. */
  memoryReadEpoch?: number;
}

export interface LivingMemoryBridgeOutput {
  /** Enabled policy generation that authorizes these prompt sections. */
  memoryReadEpoch?: number;
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
  /** Content-free post-retrieval applicability decisions and reason counts. */
  applicabilityPolicy: MemoryApplicabilitySummary;
}

export interface LivingMemoryBridgeTimings {
  taskStackMs: number;
  workingBlockMs: number;
  focusRenderMs: number;
  retrievalMs: number;
  applicabilityPolicyMs: number;
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
  applicabilityPolicy: emptyMemoryApplicabilitySummary('disabled'),
};

function safeGetWorkingBlock(
  label: 'active_focus' | 'open_threads',
  options: Pick<
    BuildLivingMemorySectionsOptions,
    'conversationId' | 'sourceThreadId' | 'taskId' | 'readWorkingBlock'
  >,
): WorkingMemoryBlock | null {
  try {
    const block = options.readWorkingBlock
      ? options.readWorkingBlock(label)
      : getWorkingBlock(label, {
          conversationId: options.conversationId,
          threadId: options.sourceThreadId,
          taskId: options.taskId,
        });
    return block?.promptEligibility === 'trusted_structural' ? block : null;
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

function withFactSubjectLabels(facts: ReadonlyArray<PromptMemoryFact>): PromptMemoryFact[] {
  return facts.map((fact) => ({
    ...fact,
    subjectLabel: getFactSubjectLabel(fact.subjectId),
  }));
}

function resolveApplicabilityScope(
  input: Pick<
    BuildLivingMemorySectionsOptions,
    'conversationId' | 'sourceThreadId' | 'personaId' | 'taskId'
  >,
): RequiredMemoryAccessScopeIdentity {
  return resolveLocalMemoryAccessScope({
    memoryConversationId: input.conversationId,
    sourceThreadId: input.sourceThreadId,
    personaId: input.personaId,
    taskId: input.taskId,
  });
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
    workingBlockMs: 0,
    focusRenderMs: 0,
    retrievalMs: 0,
    applicabilityPolicyMs: 0,
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
    personaId,
    readWorkingBlock,
    readLatestReflection: readLatestReflectionOverride,
    goals,
    activeTaskId,
    asyncWork,
    retrievalLlm,
    consistencyBarrier,
    memoryUseIntent = 'automatic_prompt',
    externalMemoryEvidence,
    candidateStrategy,
    localSimilarity,
    memoryReadEpoch: requestedMemoryReadEpoch,
  } = options;

  const memoryReadEpoch = requestedMemoryReadEpoch ?? captureMemoryReadEpoch();

  if (!Array.isArray(messages) || messages.length === 0) {
    return EMPTY_OUTPUT;
  }

  // When the user has opted out of long-term memory, bail before any working-state or recall query
  // so the SQLite path is not touched and the prompt stays stateless.
  if (
    disableLongTermMemory ||
    consistencyBarrier?.outcome === 'opt_out' ||
    memoryReadEpoch === null ||
    !isMemoryReadEpochCurrent(memoryReadEpoch)
  ) {
    return EMPTY_OUTPUT;
  }

  const resolvedTaskId = taskId;
  let activeTaskTitle: string | null = null;
  if (resolvedTaskId) {
    const started = Date.now();
    try {
      activeTaskTitle =
        readTaskStack(conversationId).find((item) => item.id === resolvedTaskId)?.title ?? null;
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.taskStack read failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    timings.taskStackMs += Date.now() - started;
  }
  const applicabilityScope = resolveApplicabilityScope({
    conversationId,
    sourceThreadId,
    personaId,
    taskId,
  });

  const workingBlockStarted = Date.now();
  const scopedFocusBlock = safeGetWorkingBlock(FOCUS_BLOCK_LABEL, {
    conversationId,
    sourceThreadId,
    taskId: resolvedTaskId,
    readWorkingBlock,
  });
  const focusBlockText = (scopedFocusBlock?.content ?? '').trim();

  const scopedOpenThreads = safeGetWorkingBlock(OPEN_THREADS_LABEL, {
    conversationId,
    sourceThreadId,
    taskId: resolvedTaskId,
    readWorkingBlock,
  });
  const openThreadLabels = splitThreadLabels(scopedOpenThreads?.content ?? '');
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

  const query = buildRecentUserRetrievalQuery(messages);
  let recalledFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['facts'] = [];
  let resolutionFacts: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['resolutionFacts'] =
    [];
  let recalledEpisodes: Awaited<ReturnType<typeof orchestrateMemoryRetrieval>>['episodes'] = [];
  let recalledEpisodeSelections: Awaited<
    ReturnType<typeof orchestrateMemoryRetrieval>
  >['episodeSelections'] = [];
  let retrievalTimings: RetrievalOrchestratorTimings | undefined;
  let retrievalState: PromptAssemblyRetrievalState = disableRecall ? 'disabled' : 'completed';
  const factSelector = !disableRecall
    ? createLlmMemoryFactSelector(retrievalLlm ? { ...retrievalLlm, memoryReadEpoch } : undefined)
    : null;
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
        memoryScope: applicabilityScope,
        memoryUseIntent,
        limit: recallLimit,
        now,
        ...(candidateStrategy ? { candidateStrategy } : {}),
        ...(localSimilarity ? { localSimilarity } : {}),
        memoryReadEpoch,
      });
      if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
      recalledFacts = retrieval.facts;
      resolutionFacts = retrieval.resolutionFacts;
      recalledEpisodes = retrieval.episodes;
      recalledEpisodeSelections = retrieval.episodeSelections;
      retrievalTimings = retrieval.timings;
    } catch (error) {
      if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
      logger.devWarn(
        'livingMemoryBridge.orchestrateMemoryRetrieval failed:',
        error instanceof Error ? error.message : String(error),
      );
      recalledFacts = [];
      resolutionFacts = [];
      recalledEpisodes = [];
      recalledEpisodeSelections = [];
      retrievalState = 'degraded';
    }
    timings.retrievalMs += Date.now() - retrievalStarted;
  }

  const policyStarted = Date.now();
  let persistedConflictEvidence: MemoryExternalEvidenceSignal[] = [];
  let conflictObservationReadState: 'available' | 'failed' = 'available';
  const policyCandidateFacts = [...recalledFacts, ...resolutionFacts];
  if (policyCandidateFacts.length > 0) {
    try {
      persistedConflictEvidence = loadActiveMemoryFactConflictSignals({
        factIds: policyCandidateFacts.map((fact) => fact.id),
        currentScope: applicabilityScope,
        asOf: now,
      });
    } catch (error) {
      conflictObservationReadState = 'failed';
      retrievalState = 'degraded';
      logger.devWarn(
        'livingMemoryBridge.conflict observation read failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const applicability = applyMemoryApplicabilityPolicy({
    facts: policyCandidateFacts,
    context: {
      enabled: !disableRecall,
      now,
      useIntent: memoryUseIntent,
      scope: applicabilityScope,
      conflictObservationReadState,
      ...(persistedConflictEvidence.length > 0 || externalMemoryEvidence
        ? {
            externalEvidence: [...persistedConflictEvidence, ...(externalMemoryEvidence ?? [])],
          }
        : {}),
    },
  });
  const factDecisions = new Map(
    applicability.factDecisions.map((decision) => [decision.factId, decision] as const),
  );
  const applicableFacts: PromptMemoryFact[] = policyCandidateFacts.flatMap((fact) => {
    const decision = factDecisions.get(fact.id);
    if (!decision || decision.action === 'silent') return [];
    return [
      {
        ...fact,
        applicability: { action: decision.action, reason: decision.reason },
      },
    ];
  });
  const resolutionFactIds = selectMemoryApplicabilityResolutionFactIds(applicableFacts);
  const assemblyVisibleFacts = applicableFacts.filter(
    (fact) => fact.applicability?.action === 'use' || resolutionFactIds.has(fact.id),
  );
  const applicabilitySummary: MemoryApplicabilitySummary = {
    ...applicability.summary,
    promptVisibleFactCount: assemblyVisibleFacts.length,
    promptBudgetDroppedFactCount: applicableFacts.length - assemblyVisibleFacts.length,
  };
  timings.applicabilityPolicyMs += Date.now() - policyStarted;

  const directlyUsableFacts = assemblyVisibleFacts.filter(
    (fact) => fact.applicability?.action === 'use',
  );
  const localEvidencePrompt = buildLocalEvidencePrompt({
    facts: directlyUsableFacts,
    episodeSelections: recalledEpisodeSelections,
    currentScope: applicabilityScope,
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
        getApplicableLatestReflectionContent({
          currentScope: applicabilityScope,
          asOf: now,
        }) ??
        '';
    } catch (error) {
      logger.devWarn(
        'livingMemoryBridge.getApplicableLatestReflectionContent failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    timings.reflectionMs += Date.now() - reflectionStarted;
  }

  const subjectLabelsStarted = Date.now();
  const factsForPrompt = withFactSubjectLabels(assemblyVisibleFacts);
  timings.subjectLabelsMs += Date.now() - subjectLabelsStarted;
  const assembleStarted = Date.now();
  const assembled = assemblePrompt({
    basePrompt: '',
    focusBlock: focusRendered.text,
    reflectionBlock: reflectionBlock.trim() || undefined,
    retrievedFacts: factsForPrompt,
    recentEpisodeSelections: recalledEpisodeSelections,
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

  if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
  markFactsRecalled(
    assemblyVisibleFacts.map((fact) => fact.id),
    now,
  );

  const eventStarted = Date.now();
  if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
  const retrievalEvent = await recordPromptAssemblyRetrievalEvent({
    query,
    ...(conversationId ? { memoryConversationId: conversationId } : {}),
    ...(sourceThreadId ? { sourceThreadId } : {}),
    taskScopePresent: Boolean(resolvedTaskId ?? activeTaskId),
    state: retrievalState,
    selectedFactIds: assemblyVisibleFacts.map((fact) => fact.id),
    selectedEpisodeIds: recalledEpisodes.map((episode) => episode.id),
    expansion: localEvidencePrompt.diagnostics,
    ...(retrievalTimings ? { retrievalTimings } : {}),
    ...(consistencyBarrier ? { consistencyBarrier } : {}),
    createdAt: now,
    memoryReadEpoch,
  });
  if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
  timings.recordRetrievalEventMs += Date.now() - eventStarted;
  timings.totalMs = Date.now() - totalStarted;
  if (retrievalTimings) timings.retrieval = retrievalTimings;

  if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
  return {
    memoryReadEpoch,
    sections,
    cacheableSignature: assembled.cacheableSignature,
    focusBlockText,
    openThreadLabels,
    ...(typeof idleSinceLastTurnMs === 'number' ? { idleSinceLastTurnMs } : {}),
    focusGap: focusRendered.gap,
    recalledFactCount: assemblyVisibleFacts.length,
    recalledEpisodeCount: recalledEpisodes.length,
    timings,
    retrievalEvent,
    localEvidenceExpansion: localEvidencePrompt.diagnostics,
    applicabilityPolicy: applicabilitySummary,
  };
}
