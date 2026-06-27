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
import { lexicalOverlap, tokenizeLexicalUnits } from './ranking/lexical';

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
  vectorWeight?: number;
  textWeight?: number;
  expansionShare?: number;
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
    vectorWeight: 0,
    textWeight: 1,
    expansionShare: 0.5,
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
    ...(typeof config.vectorWeight === 'number' ? { vectorWeight: config.vectorWeight } : {}),
    ...(typeof config.textWeight === 'number' ? { textWeight: config.textWeight } : {}),
  };
  const hasExpansion =
    input.expansionQuery.trim().length > 0 &&
    input.expansionQuery.trim() !== input.primaryQuery.trim();
  const expansionLimit = hasExpansion
    ? Math.max(1, Math.ceil(limit * (config.expansionShare ?? 0.35)))
    : 0;
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

function numericStateIndex(fact: MemoryFact): number | null {
  const value = fact.attributes.stateIndex;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isUiMemoryKind(kind: MemoryFactKind): boolean {
  return kind === 'ui_inventory' || kind === 'ui_field' || kind === 'ui_filter_state';
}

function sourceCompanionScore(anchor: ScoredFact, fact: MemoryFact, index: number): ScoredFact {
  const anchorState = numericStateIndex(anchor.fact);
  const factState = numericStateIndex(fact);
  const distance =
    anchorState !== null && factState !== null ? Math.abs(anchorState - factState) : index + 4;
  const memoryKindBoost = fact.memoryKind === 'ui_filter_state' || fact.memoryKind === 'ui_field' ? 0.02 : 0;
  const score = Math.max(0, anchor.score - distance * 0.002 + memoryKindBoost);
  return {
    fact,
    score,
    vectorScore: 0,
    textScore: 0,
    pinnedBoost: 0,
    decayMultiplier: anchor.decayMultiplier,
    scopeBoost: anchor.scopeBoost,
    reinforcementBoost: 0,
    importanceScore: fact.importance * 0.04,
    retrievabilityScore: fact.retrievability,
    relevanceScore: Math.max(0, anchor.relevanceScore - distance * 0.002),
  };
}

function sourceCompanionsForFact(
  anchor: ScoredFact,
  input: RetrievalOrchestratorInput,
  queryUnits: Set<string>,
  seenIds: Set<string>,
): ScoredFact[] {
  const sourceRunId = anchor.fact.sourceRunId;
  if (!sourceRunId || !isUiMemoryKind(anchor.fact.memoryKind)) return [];
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const companions = listFacts({
    sourceRunId,
    memoryKind: ['ui_field', 'ui_filter_state'],
    ...(input.conversationId ? { originConversationId: input.conversationId } : {}),
    ...(resolvedTaskId ? { originTaskId: resolvedTaskId } : {}),
    limit: 48,
  })
    .filter((fact) => !seenIds.has(fact.id))
    .map((fact) => ({
      fact,
      overlap: lexicalOverlap(queryUnits, `${fact.predicate} ${fact.objectText} ${fact.sourceSummary ?? ''}`),
    }))
    .filter((entry) => queryUnits.size === 0 || entry.overlap > 0)
    .sort((left, right) => {
      const anchorState = numericStateIndex(anchor.fact);
      if (right.overlap !== left.overlap) return right.overlap - left.overlap;
      const leftState = numericStateIndex(left.fact);
      const rightState = numericStateIndex(right.fact);
      const leftDistance =
        anchorState !== null && leftState !== null ? Math.abs(leftState - anchorState) : 999;
      const rightDistance =
        anchorState !== null && rightState !== null ? Math.abs(rightState - anchorState) : 999;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      if (left.fact.memoryKind !== right.fact.memoryKind) {
        if (left.fact.memoryKind === 'ui_filter_state') return -1;
        if (right.fact.memoryKind === 'ui_filter_state') return 1;
      }
      return right.fact.updatedAt - left.fact.updatedAt;
    })
    .slice(0, 2);
  return companions.map(({ fact }, index) => sourceCompanionScore(anchor, fact, index));
}

function expandWithSourceCompanions(
  scoredFacts: ScoredFact[],
  input: RetrievalOrchestratorInput,
  queryText: string,
  limit: number,
): ScoredFact[] {
  const base: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const uiInventorySeenBySource = new Set<string>();
  const addBase = (entry: ScoredFact): boolean => {
    if (base.length >= limit) return false;
    if (seenIds.has(entry.fact.id)) return false;
    if (entry.fact.memoryKind === 'ui_inventory' && entry.fact.sourceRunId) {
      const key = entry.fact.sourceRunId;
      if (uiInventorySeenBySource.has(key)) return false;
      uiInventorySeenBySource.add(key);
    }
    base.push(entry);
    seenIds.add(entry.fact.id);
    return true;
  };

  for (const entry of scoredFacts) {
    addBase(entry);
    if (base.length >= limit) break;
  }

  const expanded: ScoredFact[] = [];
  const expandedIds = new Set<string>();
  const queryUnits = tokenizeLexicalUnits(queryText);
  let companionCount = 0;
  const companionBudget = Math.max(1, Math.floor(limit * 0.4));
  const addExpanded = (entry: ScoredFact): boolean => {
    if (expanded.length >= limit) return false;
    if (expandedIds.has(entry.fact.id)) return false;
    expanded.push(entry);
    expandedIds.add(entry.fact.id);
    return true;
  };

  for (const entry of base) {
    addExpanded(entry);
    if (companionCount < companionBudget) {
      for (const companion of sourceCompanionsForFact(entry, input, queryUnits, expandedIds)) {
        if (!addExpanded(companion)) continue;
        companionCount += 1;
        if (companionCount >= companionBudget || expanded.length >= limit) break;
      }
    }
    if (expanded.length >= limit) break;
  }
  return expanded;
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
  const scoredFacts = expandWithSourceCompanions(
    mergeLaneResults(lanes, scopedCurrentFacts, limit),
    input,
    signals.join('\n'),
    limit,
  );
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
