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
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from './memoryAuthority';
import type {
  RecallCandidateStrategy,
  RecallLocalSimilarityInput,
} from './factRecallCandidateContract';
import type { RetrievalOrchestratorTimings } from './retrievalOrchestrator';
import type { NextTurnMemoryConsistencyResult } from './nextTurnConsistency';
import { renderFocusBlock, type FocusGap } from './focus';
import { assemblePrompt, type PromptMemoryFact, type SystemPromptSection } from './promptAssembly';
import { getWorkingBlock, type WorkingMemoryBlock } from './workingBlocks';
import { readTaskStack } from './taskStack';
import { getApplicableLatestReflectionContent } from './reflections';
import {
  recordPromptAssemblyRetrievalEvent,
  type PromptAssemblyRetrievalEventResult,
} from './promptAssemblyRetrievalEvent';
import {
  buildLocalEvidencePrompt,
  type LocalEvidencePromptDiagnostics,
} from './localEvidencePromptBuilder';
import { emptyMemoryApplicabilitySummary } from './memoryApplicabilityPolicy';
import type {
  MemoryApplicabilitySummary,
  MemoryApplicabilityUseIntent,
  MemoryExternalEvidenceSignal,
} from './memoryApplicabilityTypes';
import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';
import { resolveLocalMemoryAccessScope } from './memoryScopeStore';
import { markFactsRecalled } from './facts/factAccessMutations';
import { buildRecentUserRetrievalQuery } from './retrievalQueryText';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from './policy';
import type { EpisodeRecallSelection } from './episodes/accessPolicyTypes';
import {
  earliestFutureMemoryValidityDeadline,
  isMemoryValidityDeadlineCurrent,
} from './memoryValidityDeadline';
import {
  isReceiptBackedProcedureLearningFact,
  type ReceiptBackedProcedureRuntime,
} from './receiptBackedProcedureRecall';
import { resolveLivingMemoryEligibility } from './livingMemoryEligibility';

const logger = createLogger('memory.livingMemoryBridge');

const FOCUS_BLOCK_LABEL = 'active_focus';
const OPEN_THREADS_LABEL = 'open_threads';
export const CURRENT_MEMORY_PRESENTATION_CONTRACT =
  'Memory presentation contract: Retrieved Memory holds facts already checked for scope, validity, authority, conflicts, sensitivity, and direct usability. A fact marked policy=use is ready to use as context for the requested answer or action; read its subject, predicate, and value together, since the predicate may be a canonical identifier. Use the id shown after a fact only with a memory tool that accepts it as factId; the source shown is provenance, not that id. Do not ask the user to repeat them or call a memory read tool merely to verify a fact already shown here. Re-read memory only when the needed fact is missing, broader history is requested, or current evidence conflicts with it. Only disclose a superseded or historical value when the user actually asks for history or comparison, not merely to explain today\'s answer.';

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
  /** Evaluation seam for a same-path learning-off ablation. Production leaves this false. */
  disableExperienceLearningRecall?: boolean;
  /** Exact runtime override for procedure drift validation in integration tests. */
  receiptBackedProcedureRuntime?: ReceiptBackedProcedureRuntime;
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
  /** Exact projection generation spanning every read, selector, and telemetry write. */
  memoryAuthoritySnapshot?: MemoryAuthoritySnapshot;
}

export interface LivingMemoryBridgeOutput {
  /** Enabled policy generation that authorizes these prompt sections. */
  memoryReadEpoch?: number;
  /** Exact restrictive and projection generation captured before retrieval assembly. */
  memoryAuthoritySnapshot?: MemoryAuthoritySnapshot;
  /** Earliest expiry of any fact or episode authorization projected into this prompt. */
  validUntil?: number;
  /** Sections to append to the existing system-prompt sections array. */
  sections: SystemPromptSection[];
  /** Stable hash of the provider-cacheable prefix. Memory sections are dynamic until epoch admission. */
  cacheableSignature: string;
  /** Trimmed `active_focus` block content used by memory-aware app surfaces. */
  focusBlockText: string;
  /** Open-thread labels split on newlines for memory-aware app surfaces. */
  openThreadLabels: string[];
  /** Milliseconds since the last assistant turn (or user turn). */
  idleSinceLastTurnMs?: number;
  /** Categorised gap bucket for telemetry. */
  focusGap?: FocusGap;
  /** Number of facts recalled. */
  recalledFactCount: number;
  /** Number of recent episodes included. */
  recalledEpisodeCount: number;
  /** Internal timing breakdown for product telemetry and performance diagnostics. */
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

export function resolveLivingMemoryValidUntil(input: {
  facts: ReadonlyArray<Pick<PromptMemoryFact, 'expiresAt'>>;
  episodeSelections: ReadonlyArray<Pick<EpisodeRecallSelection, 'policyExpiresAt'>>;
  now: number;
}): number | undefined {
  return earliestFutureMemoryValidityDeadline(
    [
      ...input.facts.map((fact) => fact.expiresAt),
      ...input.episodeSelections.map((selection) => selection.policyExpiresAt),
    ],
    input.now,
  );
}

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
 * Build one authority-bound memory projection plus the inputs the compaction
 * engine needs (focus / open threads / idle gap). A session may reuse this
 * result only while its attached projection snapshot remains current.
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
    memoryAuthoritySnapshot: requestedMemoryAuthoritySnapshot,
  } = options;

  if (!Array.isArray(messages) || messages.length === 0) {
    return EMPTY_OUTPUT;
  }

  // When the user has opted out of long-term memory, bail before any working-state or recall query
  // so the SQLite path is not touched and the prompt stays stateless.
  if (disableLongTermMemory || consistencyBarrier?.outcome === 'opt_out') {
    return EMPTY_OUTPUT;
  }

  const memoryReadEpoch = requestedMemoryReadEpoch ?? captureMemoryReadEpoch();
  if (memoryReadEpoch === null || !isMemoryReadEpochCurrent(memoryReadEpoch)) return EMPTY_OUTPUT;
  const initialMemoryAuthoritySnapshot =
    requestedMemoryAuthoritySnapshot ?? captureMemoryAuthoritySnapshot();
  if (!initialMemoryAuthoritySnapshot) return EMPTY_OUTPUT;
  let memoryAuthoritySnapshot: MemoryAuthoritySnapshot = initialMemoryAuthoritySnapshot;
  const isProjectionCurrent = (): boolean =>
    isMemoryProjectionSnapshotCurrent(memoryAuthoritySnapshot) &&
    isMemoryProjectionSnapshotDurablyCurrent(memoryAuthoritySnapshot);
  if (!isProjectionCurrent()) return EMPTY_OUTPUT;

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
  const eligibility = await resolveLivingMemoryEligibility({
    query,
    focusBlockText,
    goals,
    activeTaskId,
    resolvedTaskId,
    asyncWork,
    retrievalLlm,
    memoryReadEpoch,
    memoryAuthoritySnapshot,
    applicabilityScope,
    memoryUseIntent,
    recallLimit,
    now,
    candidateStrategy,
    localSimilarity,
    disableRecall,
    externalMemoryEvidence,
    disableExperienceLearningRecall: options.disableExperienceLearningRecall,
    receiptBackedProcedureRuntime: options.receiptBackedProcedureRuntime,
  });
  if (eligibility.aborted) return EMPTY_OUTPUT;
  const {
    assemblyVisibleFacts,
    recalledEpisodeSelections,
    recalledEpisodes,
    applicableProcedureSections,
    applicabilitySummary,
    retrievalTimings,
  } = eligibility;
  let retrievalState = eligibility.retrievalState;
  timings.retrievalMs += eligibility.retrievalMs;
  timings.applicabilityPolicyMs += eligibility.applicabilityPolicyMs;

  const directlyUsableFacts = assemblyVisibleFacts.filter(
    (fact) => fact.applicability?.action === 'use',
  );
  const directlyUsableEvidenceFacts = directlyUsableFacts.filter(
    (fact) => !isReceiptBackedProcedureLearningFact(fact),
  );
  const localEvidencePrompt = buildLocalEvidencePrompt({
    facts: directlyUsableEvidenceFacts,
    episodeSelections: recalledEpisodeSelections,
    currentScope: applicabilityScope,
    asOf: now,
  });
  timings.evidenceExpansionMs = localEvidencePrompt.diagnostics.durationMs;
  if (localEvidencePrompt.diagnostics.outcome === 'failed' && retrievalState === 'completed') {
    retrievalState = 'degraded';
  }
  const validUntil = resolveLivingMemoryValidUntil({
    facts: assemblyVisibleFacts,
    episodeSelections: recalledEpisodeSelections,
    now,
  });

  const dynamicAddenda: string[] = [];
  if (directlyUsableFacts.length > 0) {
    dynamicAddenda.push(CURRENT_MEMORY_PRESENTATION_CONTRACT);
  }
  if (activeTaskTitle) {
    dynamicAddenda.push(`Active task: ${activeTaskTitle}`);
  }
  dynamicAddenda.push(...applicableProcedureSections);
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
  const factsForPrompt = withFactSubjectLabels(
    assemblyVisibleFacts.filter((fact) => !isReceiptBackedProcedureLearningFact(fact)),
  );
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

  if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) return EMPTY_OUTPUT;
  const recallMutation = markFactsRecalled(
    assemblyVisibleFacts.map((fact) => fact.id),
    now,
    { expectedAuthoritySnapshot: memoryAuthoritySnapshot },
  );
  if (recallMutation.status === 'authority_stale') return EMPTY_OUTPUT;
  if (recallMutation.status === 'updated') {
    if (!recallMutation.authorityContinuation) return EMPTY_OUTPUT;
    memoryAuthoritySnapshot = recallMutation.authorityContinuation;
  }

  const eventStarted = Date.now();
  if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) return EMPTY_OUTPUT;
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
  if (!isMemoryReadEpochCurrent(memoryReadEpoch) || !isProjectionCurrent()) return EMPTY_OUTPUT;
  timings.recordRetrievalEventMs += Date.now() - eventStarted;
  timings.totalMs = Date.now() - totalStarted;
  if (retrievalTimings) timings.retrieval = retrievalTimings;

  const finalObservedAt = options.now === undefined ? Date.now() : now;
  if (
    !isMemoryReadEpochCurrent(memoryReadEpoch) ||
    !isProjectionCurrent() ||
    !isMemoryValidityDeadlineCurrent(validUntil, finalObservedAt)
  ) {
    return EMPTY_OUTPUT;
  }
  return {
    memoryReadEpoch,
    memoryAuthoritySnapshot,
    ...(validUntil === undefined ? {} : { validUntil }),
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
