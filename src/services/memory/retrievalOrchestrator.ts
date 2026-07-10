// ---------------------------------------------------------------------------
// Kavi - Retrieval orchestrator
// ---------------------------------------------------------------------------
// The orchestrator intentionally stays small: it builds one structural query,
// asks the fact store for one bounded ranked pool, and returns selected facts
// plus recent episodes. Candidate strategy and an already-available local query
// vector can cross this seam; vector creation and provider calls cannot.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import {
  recallFactSelectionForQuery,
  type RecallFactsOptions,
  type RecallFactsTiming,
  type MemoryFactSelector,
  type ScoredFact,
} from './factRecall';
import { recallScopedEpisodesForQuery, type RecallEpisodesTiming } from './episodeRecall';
import type {
  CrossThreadEpisodeRecallDiagnostics,
  EpisodeRecallSelection,
} from './episodes/accessPolicyTypes';
import type { MemoryEpisode } from './episodes/types';
import type {
  RecallCandidateStrategy,
  RecallLocalSemanticInput,
} from './factRecallCandidateContract';
import type { MemoryFact } from './facts/types';
import { getMemoryTask } from './tasks';
import { planRetrievalSignals } from './retrievalQueryPlan';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';
import type { MemoryApplicabilityUseIntent } from './memoryApplicabilityTypes';

export interface RetrievalOrchestratorInput {
  userMessage: string;
  focusText?: string;
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string;
  asyncWork?: AgentRunControlGraphAsyncWorkState;
  memoryScope: MemoryAccessScopeIdentity;
  memoryUseIntent?: MemoryApplicabilityUseIntent;
  limit?: number;
  now?: number;
  factSelector?: MemoryFactSelector;
  candidateStrategy?: RecallCandidateStrategy;
  localSemantic?: RecallLocalSemanticInput;
}

export interface RetrievalOrchestratorResult {
  facts: MemoryFact[];
  resolutionFacts: MemoryFact[];
  episodes: MemoryEpisode[];
  episodeSelections: EpisodeRecallSelection[];
  querySignals: string[];
  scoredFacts: ScoredFact[];
  timings?: RetrievalOrchestratorTimings;
}

export interface RetrievalOrchestratorTimings {
  planMs: number;
  recallMs: number;
  episodesMs: number;
  totalMs: number;
  recall?: RecallFactsTiming;
  episodes?: RecallEpisodesTiming;
  crossThreadEpisodes?: CrossThreadEpisodeRecallDiagnostics;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
const DEFAULT_CANDIDATE_POOL_LIMIT = 128;
const DEFAULT_THRESHOLD = 0.01;

function collectGoalSignals(goals: ReadonlyArray<AgentGoal> | undefined): string[] {
  if (!goals?.length) return [];
  const signals: string[] = [];
  for (const goal of goals) {
    if (goal.status !== 'active' && goal.status !== 'pending') continue;
    if (goal.title.trim()) signals.push(goal.title.trim());
    if (goal.description?.trim()) signals.push(goal.description.trim());
    for (const capability of goal.requiredCapabilities ?? []) {
      if (capability.trim()) signals.push(capability.trim());
    }
    for (const resourceKind of goal.requiredResourceKinds ?? []) {
      if (resourceKind.trim()) signals.push(resourceKind.trim());
    }
  }
  return signals;
}

function collectAsyncWorkSignals(
  asyncWork: AgentRunControlGraphAsyncWorkState | undefined,
): string[] {
  if (!asyncWork) return [];
  const signals: string[] = [];
  for (const operation of asyncWork.pendingOperations ?? []) {
    if (operation.lastUpdatedByTool?.trim()) signals.push(operation.lastUpdatedByTool.trim());
    if (operation.displayName?.trim()) signals.push(operation.displayName.trim());
  }
  return signals;
}

function buildQuerySignals(
  input: RetrievalOrchestratorInput,
  resolvedTaskId: string | undefined,
): string[] {
  const primarySignals: string[] = [];
  const userMessage = input.userMessage.trim();
  if (userMessage) primarySignals.push(userMessage);

  primarySignals.push(...collectGoalSignals(input.goals));
  primarySignals.push(...collectAsyncWorkSignals(input.asyncWork));
  if (input.focusText?.trim()) primarySignals.push(input.focusText.trim());

  if (resolvedTaskId) {
    const task = getMemoryTask(resolvedTaskId);
    if (task?.title.trim()) primarySignals.push(task.title.trim());
    if (task?.summary?.trim()) primarySignals.push(task.summary.trim());
  }

  const planned = planRetrievalSignals(primarySignals);
  const signals =
    planned.primarySignals.length > 0
      ? [...planned.supportingSignals, ...planned.primarySignals]
      : [...planned.supportingSignals];
  return Array.from(new Set(signals.map((signal) => signal.trim()).filter(Boolean)));
}

function recallOptions(
  input: RetrievalOrchestratorInput,
  memoryScope: RequiredMemoryAccessScopeIdentity,
  limit: number,
  now: number,
  onTiming: (timing: RecallFactsTiming) => void,
): RecallFactsOptions {
  return {
    limit,
    threshold: DEFAULT_THRESHOLD,
    candidatePoolLimit: DEFAULT_CANDIDATE_POOL_LIMIT,
    onTiming,
    ...(input.factSelector ? { selector: input.factSelector } : {}),
    ...(input.candidateStrategy ? { candidateStrategy: input.candidateStrategy } : {}),
    ...(input.localSemantic ? { localSemantic: input.localSemantic } : {}),
    memoryScope,
    useIntent: input.memoryUseIntent ?? 'automatic_prompt',
    now,
  };
}

function normalizeRetrievalLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(value) || value < 1) throw new Error('memory_retrieval_limit_invalid');
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeRetrievalNow(value: number | undefined): number {
  const now = value ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('memory_retrieval_timestamp_invalid');
  }
  return now;
}

function resolveRetrievalScope(input: RetrievalOrchestratorInput): {
  memoryScope: RequiredMemoryAccessScopeIdentity;
  taskId: string | undefined;
} {
  const memoryScope = requireMemoryAccessScopeIdentity(input.memoryScope);
  const requestedTaskId = input.activeTaskId ?? null;
  if (
    input.activeTaskId !== undefined &&
    memoryScope.taskId !== requestedTaskId &&
    (memoryScope.taskId !== null || requestedTaskId !== null)
  ) {
    throw new Error('memory_retrieval_scope_task_mismatch');
  }
  return { memoryScope, taskId: memoryScope.taskId ?? undefined };
}

export async function orchestrateMemoryRetrieval(
  input: RetrievalOrchestratorInput,
): Promise<RetrievalOrchestratorResult> {
  const scope = resolveRetrievalScope(input);
  const now = normalizeRetrievalNow(input.now);
  const limit = normalizeRetrievalLimit(input.limit);
  const totalStarted = Date.now();
  const planStarted = Date.now();
  const querySignals = buildQuerySignals(input, scope.taskId);
  const query = querySignals.join('\n');
  const planMs = Date.now() - planStarted;
  const recallTimings: RecallFactsTiming[] = [];

  const recallStarted = Date.now();
  const selection = query
    ? await recallFactSelectionForQuery(
        query,
        recallOptions(input, scope.memoryScope, limit, now, (timing) => recallTimings.push(timing)),
      )
    : { facts: [], resolutionFacts: [], scoredFacts: [] };
  const recallMs = Date.now() - recallStarted;
  const { facts, resolutionFacts, scoredFacts } = selection;

  const episodesStarted = Date.now();
  let episodeTiming: RecallEpisodesTiming | undefined;
  const recalledEpisodes = recallScopedEpisodesForQuery(query, {
    currentScope: scope.memoryScope,
    limit: 4,
    now,
    onTiming: (timing) => {
      episodeTiming = timing;
    },
  });
  const episodeSelections = recalledEpisodes.selections;
  const episodes = episodeSelections.map((episodeSelection) => episodeSelection.episode);
  const episodesMs = Date.now() - episodesStarted;

  return {
    facts,
    resolutionFacts,
    episodes,
    episodeSelections,
    querySignals,
    scoredFacts,
    timings: {
      planMs,
      recallMs,
      episodesMs,
      totalMs: Date.now() - totalStarted,
      recall: recallTimings[0],
      episodes: episodeTiming,
      crossThreadEpisodes: recalledEpisodes.diagnostics,
    },
  };
}
