// ---------------------------------------------------------------------------
// Kavi — Retrieval orchestrator
// ---------------------------------------------------------------------------
// Multi-signal, language-agnostic memory retrieval for prompt assembly.
// Combines user message, graph goals, active task, and async-work state into
// a structural query — no regex or English pattern matching.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import type { EmbeddingConfig } from '../../types/memory';
import { recallScoredFactsForQuery, type RecallFactsOptions, type ScoredFact } from './factRecall';
import { recallEpisodesForQuery } from './episodeRecall';
import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact, MemoryFactKind } from './facts/types';
import { markFactsRecalled } from './facts/mutations';
import { listFacts } from './facts/queries';
import { getMemoryTask } from './tasks';
import { planRetrievalSignals } from './retrievalQueryPlan';

export interface RetrievalOrchestratorInput {
  userMessage: string;
  focusText?: string;
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string;
  asyncWork?: AgentRunControlGraphAsyncWorkState;
  conversationId?: string;
  taskId?: string;
  embeddingConfig?: EmbeddingConfig;
  limit?: number;
  now?: number;
}

export interface RetrievalOrchestratorResult {
  facts: MemoryFact[];
  episodes: MemoryEpisode[];
  querySignals: string[];
  scoredFacts: ScoredFact[];
  lanes: RetrievalLaneResult[];
}

export type RetrievalLaneId = 'semantic' | 'interface' | 'procedural';

export interface RetrievalLaneResult {
  id: RetrievalLaneId;
  memoryKinds: MemoryFactKind[];
  scoredFacts: ScoredFact[];
  facts: MemoryFact[];
}

interface RetrievalLaneConfig {
  id: RetrievalLaneId;
  memoryKinds: MemoryFactKind[];
  minLimit: number;
  share: number;
  priority: number;
}

const RETRIEVAL_LANES: RetrievalLaneConfig[] = [
  {
    id: 'semantic',
    memoryKinds: ['semantic_fact'],
    minLimit: 2,
    share: 0.45,
    priority: 0,
  },
  {
    id: 'interface',
    memoryKinds: [
      'ui_inventory',
      'ui_field',
      'ui_filter_state',
    ],
    minLimit: 2,
    share: 0.45,
    priority: 1,
  },
  {
    id: 'procedural',
    memoryKinds: ['procedure', 'outcome', 'gotcha', 'episodic_event'],
    minLimit: 1,
    share: 0.1,
    priority: 2,
  },
];

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

function buildRetrievalQuery(input: RetrievalOrchestratorInput): {
  primaryQuery: string;
  expansionQuery: string;
  fallbackQuery: string;
  signals: string[];
  primarySignals: string[];
  expansionSignals: string[];
  fallbackSignals: string[];
} {
  const primarySignals: string[] = [];
  const fallbackSignals: string[] = [];
  const userMessage = input.userMessage.trim();
  if (userMessage) primarySignals.push(userMessage);
  const focusText = input.focusText?.trim();
  if (focusText) fallbackSignals.push(focusText);

  primarySignals.push(...collectGoalSignals(input.goals));
  primarySignals.push(...collectAsyncWorkSignals(input.asyncWork));

  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  if (resolvedTaskId) {
    const task = getMemoryTask(resolvedTaskId);
    if (task?.title.trim()) primarySignals.push(task.title.trim());
    if (task?.summary?.trim()) primarySignals.push(task.summary.trim());
  }

  const queryPlan = planRetrievalSignals(primarySignals);
  const uniquePrimarySignals = Array.from(new Set(queryPlan.primarySignals));
  const uniqueExpansionSignals = Array.from(new Set(queryPlan.supportingSignals));
  const uniqueFallbackSignals = Array.from(new Set(fallbackSignals.filter((signal) => signal.length > 0)));
  const effectivePrimarySignals =
    uniquePrimarySignals.length > 0
      ? uniquePrimarySignals
      : [...uniqueExpansionSignals, ...uniqueFallbackSignals];
  const effectiveExpansionSignals =
    uniquePrimarySignals.length > 0
      ? uniqueExpansionSignals.filter((signal) => !effectivePrimarySignals.includes(signal))
      : [];
  const effectiveFallbackSignals = uniquePrimarySignals.length > 0 ? uniqueFallbackSignals : [];
  const uniqueSignals = Array.from(
    new Set([
      ...effectivePrimarySignals,
      ...effectiveExpansionSignals,
      ...effectiveFallbackSignals,
    ]),
  );
  return {
    primaryQuery: effectivePrimarySignals.join('\n'),
    expansionQuery: effectiveExpansionSignals.join('\n'),
    fallbackQuery: effectiveFallbackSignals.join('\n'),
    signals: uniqueSignals,
    primarySignals: effectivePrimarySignals,
    expansionSignals: effectiveExpansionSignals,
    fallbackSignals: effectiveFallbackSignals,
  };
}

function recallOptions(input: RetrievalOrchestratorInput, limit: number): RecallFactsOptions {
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  return {
    limit,
    ...(input.embeddingConfig ? { embeddingConfig: input.embeddingConfig } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  };
}

async function recallScoredFactsForSignals(
  query: string,
  options: RecallFactsOptions,
): Promise<ScoredFact[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return recallScoredFactsForQuery(trimmed, options);
}

function laneLimit(config: RetrievalLaneConfig, totalLimit: number): number {
  return Math.max(1, Math.min(totalLimit, Math.max(config.minLimit, Math.ceil(totalLimit * config.share))));
}

async function recallLane(
  config: RetrievalLaneConfig,
  input: {
    primaryQuery: string;
    expansionQuery: string;
    fallbackQuery: string;
    useFallback: boolean;
    options: RecallFactsOptions;
    totalLimit: number;
  },
): Promise<RetrievalLaneResult> {
  const limit = laneLimit(config, input.totalLimit);
  const laneOptionsBase: RecallFactsOptions = {
    ...input.options,
    memoryKind: config.memoryKinds,
  };
  const hasExpansion =
    input.expansionQuery.trim().length > 0 &&
    input.expansionQuery.trim() !== input.primaryQuery.trim();
  const expansionLimit = hasExpansion ? Math.max(1, Math.floor(limit * 0.35)) : 0;
  const primaryLimit = Math.max(1, limit - expansionLimit);
  const primary = await recallScoredFactsForSignals(input.primaryQuery, {
    ...laneOptionsBase,
    limit: primaryLimit,
  });
  const expansion =
    expansionLimit > 0
      ? await recallScoredFactsForSignals(input.expansionQuery, {
          ...laneOptionsBase,
          limit: expansionLimit,
        })
      : [];
  const currentCount = mergeUniqueScoredFacts([...primary, ...expansion], limit).length;
  const fallback =
    input.useFallback && currentCount < limit
      ? await recallScoredFactsForSignals(input.fallbackQuery, {
          ...laneOptionsBase,
          limit: limit - currentCount,
        })
      : [];
  const scoredFacts = mergeUniqueScoredFacts([...primary, ...expansion, ...fallback], limit);
  return {
    id: config.id,
    memoryKinds: config.memoryKinds,
    scoredFacts,
    facts: scoredFacts.map((entry) => entry.fact),
  };
}

function mergeUniqueScoredFacts(entries: ScoredFact[], limit: number): ScoredFact[] {
  const merged: ScoredFact[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.fact.id)) continue;
    merged.push(entry);
    seenIds.add(entry.fact.id);
    if (merged.length >= limit) break;
  }
  return merged;
}

function mergeLaneResults(
  lanes: RetrievalLaneResult[],
  scopedCurrent: ScoredFact[],
  limit: number,
): ScoredFact[] {
  const merged: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const orderedLaneEntries = [...lanes]
    .map((lane) => ({
      lane,
      bestScore: lane.scoredFacts[0]?.score ?? 0,
      priority: RETRIEVAL_LANES.find((config) => config.id === lane.id)?.priority ?? 99,
    }))
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      return a.priority - b.priority;
    })
    .flatMap((entry) => entry.lane.scoredFacts);
  for (const entry of [...orderedLaneEntries, ...scopedCurrent]) {
    if (seenIds.has(entry.fact.id)) continue;
    merged.push(entry);
    seenIds.add(entry.fact.id);
    if (merged.length >= limit) break;
  }
  return merged;
}

function scoredScopedCurrentFact(fact: MemoryFact): ScoredFact {
  return {
    fact,
    score: 0,
    vectorScore: 0,
    textScore: 0,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: fact.importance * 0.04,
    retrievabilityScore: fact.retrievability,
    relevanceScore: 0,
  };
}

function recallScopedCurrentFacts(
  input: RetrievalOrchestratorInput,
  remainingLimit: number,
): ScoredFact[] {
  if (remainingLimit <= 0) return [];
  const selected: MemoryFact[] = [];
  const seenIds = new Set<string>();
  const addFacts = (facts: MemoryFact[]) => {
    for (const fact of facts) {
      if (seenIds.has(fact.id)) continue;
      selected.push(fact);
      seenIds.add(fact.id);
      if (selected.length >= remainingLimit) return;
    }
  };

  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  if (resolvedTaskId) {
    addFacts(
      listFacts({
        scope: 'session',
        originTaskId: resolvedTaskId,
        memoryKind: 'semantic_fact',
        limit: remainingLimit,
      }),
    );
  }
  if (selected.length < remainingLimit && input.conversationId) {
    addFacts(
      listFacts({
        scope: 'conversation',
        originConversationId: input.conversationId,
        memoryKind: 'semantic_fact',
        limit: remainingLimit - selected.length,
      }),
    );
  }
  return selected.map(scoredScopedCurrentFact);
}

export async function orchestrateMemoryRetrieval(
  input: RetrievalOrchestratorInput,
): Promise<RetrievalOrchestratorResult> {
  const { primaryQuery, expansionQuery, fallbackQuery, signals, primarySignals } =
    buildRetrievalQuery(input);
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
  const options = recallOptions(input, limit);

  const shouldUseFallback =
    fallbackQuery.trim().length > 0 &&
    primarySignals.length > 0 &&
    fallbackQuery.trim() !== primaryQuery.trim();
  const lanes = await Promise.all(
    RETRIEVAL_LANES.map((lane) =>
      recallLane(lane, {
        primaryQuery,
        expansionQuery,
        fallbackQuery,
        useFallback: shouldUseFallback,
        options,
        totalLimit: limit,
      }),
    ),
  );
  const laneFactCount = lanes.reduce((sum, lane) => sum + lane.scoredFacts.length, 0);
  const scopedCurrentFacts = recallScopedCurrentFacts(
    input,
    limit - laneFactCount,
  );
  const scoredFacts = mergeLaneResults(lanes, scopedCurrentFacts, limit);
  const facts = scoredFacts.map((entry) => entry.fact);
  markFactsRecalled(
    facts.map((fact) => fact.id),
    input.now ?? Date.now(),
  );

  const episodes = recallEpisodesForQuery(primaryQuery || fallbackQuery, {
    threadId: input.conversationId,
    taskId: resolvedTaskId,
    limit: 4,
  });

  return {
    facts,
    episodes,
    querySignals: signals,
    scoredFacts,
    lanes,
  };
}
