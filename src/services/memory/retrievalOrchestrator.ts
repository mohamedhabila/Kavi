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
import {
  recallScoredFactsForQuery,
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecall';
import { recallEpisodesForQuery } from './episodeRecall';
import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact, MemoryFactKind } from './facts/types';
import { markFactsRecalled } from './facts/mutations';
import { listFacts } from './facts/queries';
import { getMemoryTask } from './tasks';
import { planRetrievalSignals } from './retrievalQueryPlan';
import {
  INTERFACE_SOURCE_POOL_LIMIT,
  INTERFACE_SOURCE_POOL_MULTIPLIER,
  INTERFACE_SOURCE_POOL_MIN,
  mergeSourceLinkedInterfaceFacts,
  recallSourceLinkedInterfaceFacts,
  selectSourceAwareInterfaceFacts,
} from './retrievalInterfaceSources';

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
  timings?: RetrievalOrchestratorTimings;
}

export type RetrievalLaneId = 'semantic' | 'interface' | 'procedural';

export interface RetrievalLaneResult {
  id: RetrievalLaneId;
  memoryKinds: MemoryFactKind[];
  scoredFacts: ScoredFact[];
  facts: MemoryFact[];
  timings?: RetrievalLaneTimings;
}

export interface RetrievalLaneTimings {
  primaryRecallMs: number;
  expansionRecallMs: number;
  fallbackRecallMs: number;
  mergeMs: number;
  selectMs: number;
  totalMs: number;
  probeCount: number;
  poolSize: number;
  recalls: RecallFactsTiming[];
}

export interface RetrievalOrchestratorTimings {
  planMs: number;
  lanesMs: number;
  sourceLinkedInterfaceMs: number;
  scopedCurrentMs: number;
  mergeMs: number;
  markFactsRecalledMs: number;
  episodesMs: number;
  totalMs: number;
  probeCount: number;
  laneTimings: Record<RetrievalLaneId, RetrievalLaneTimings>;
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
    share: 0.3,
    priority: 0,
  },
  {
    id: 'interface',
    memoryKinds: [
      'ui_affordance',
      'ui_inventory',
      'ui_field',
      'ui_filter_state',
    ],
    minLimit: 2,
    share: 0.6,
    priority: 1,
  },
  {
    id: 'procedural',
    memoryKinds: ['procedure', 'outcome', 'gotcha', 'episodic_event'],
    minLimit: 3,
    share: 0.15,
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

function contextualizeSignals(
  signals: ReadonlyArray<string>,
  context: string,
): string[] {
  const trimmedContext = context.trim();
  if (!trimmedContext) return signals.map((signal) => signal.trim()).filter(Boolean);
  const contextualized: string[] = [];
  for (const signal of signals) {
    const trimmedSignal = signal.trim();
    if (!trimmedSignal) continue;
    if (trimmedSignal === trimmedContext || trimmedContext.includes(trimmedSignal)) {
      contextualized.push(trimmedContext);
    } else {
      contextualized.push(`${trimmedContext}\n${trimmedSignal}`);
      contextualized.push(trimmedSignal);
    }
  }
  return Array.from(new Set(contextualized));
}

async function recallScoredFactsForSignals(
  query: string,
  options: RecallFactsOptions,
): Promise<ScoredFact[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return recallScoredFactsForQuery(trimmed, options);
}

async function recallScoredFactsForSignalSet(
  signals: ReadonlyArray<string>,
  fallbackQuery: string,
  options: RecallFactsOptions,
): Promise<ScoredFact[]> {
  const uniqueSignals = Array.from(
    new Set(signals.map((signal) => signal.trim()).filter((signal) => signal.length > 0)),
  );
  const probes = uniqueSignals.length > 0 ? uniqueSignals : [fallbackQuery.trim()].filter(Boolean);
  const recalledByProbe: ScoredFact[][] = [];
  for (const probe of probes) {
    recalledByProbe.push(await recallScoredFactsForSignals(probe, options));
  }
  return mergeUniqueScoredFactsInterleaved(recalledByProbe, options.limit ?? probes.length);
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
    primarySignals: string[];
    expansionSignals: string[];
    fallbackSignals: string[];
    useFallback: boolean;
    options: RecallFactsOptions;
    totalLimit: number;
  },
): Promise<RetrievalLaneResult> {
  const totalStarted = Date.now();
  const limit = laneLimit(config, input.totalLimit);
  const sourceAwareInterface = config.id === 'interface';
  const interfacePoolLimit = sourceAwareInterface
    ? Math.min(
        INTERFACE_SOURCE_POOL_LIMIT,
        Math.max(limit, INTERFACE_SOURCE_POOL_MIN, limit * INTERFACE_SOURCE_POOL_MULTIPLIER),
      )
    : limit;
  const laneOptionsBase: RecallFactsOptions = {
    ...input.options,
    memoryKind: config.memoryKinds,
    ...(sourceAwareInterface
      ? {
          vectorWeight: 0,
          textWeight: 1,
          threshold: 0.01,
          candidatePoolLimit: interfacePoolLimit,
        }
      : {}),
  };
  const hasExpansion =
    input.expansionQuery.trim().length > 0 &&
    input.expansionQuery.trim() !== input.primaryQuery.trim();
  const expansionLimit = hasExpansion
    ? sourceAwareInterface
      ? interfacePoolLimit
      : Math.max(1, Math.floor(limit * 0.35))
    : 0;
  const primaryLimit = sourceAwareInterface
    ? interfacePoolLimit
    : Math.max(1, limit - expansionLimit);
  const recallTimings: RecallFactsTiming[] = [];
  const laneOptionsBaseWithTiming: RecallFactsOptions = {
    ...laneOptionsBase,
    onTiming: (timing) => recallTimings.push(timing),
  };
  const primaryStarted = Date.now();
  const primary = sourceAwareInterface
    ? await recallScoredFactsForSignalSet(input.primarySignals, input.primaryQuery, {
        ...laneOptionsBaseWithTiming,
        limit: primaryLimit,
      })
    : await recallScoredFactsForSignals(input.primaryQuery, {
        ...laneOptionsBaseWithTiming,
        limit: primaryLimit,
      });
  const primaryRecallMs = Date.now() - primaryStarted;
  const expansionStarted = Date.now();
  const expansion =
    expansionLimit > 0
      ? sourceAwareInterface
        ? await recallScoredFactsForSignalSet(
            contextualizeSignals(input.expansionSignals, input.primaryQuery),
            [input.primaryQuery, input.expansionQuery].join('\n'),
            {
            ...laneOptionsBaseWithTiming,
            limit: expansionLimit,
            },
          )
        : await recallScoredFactsForSignals(input.expansionQuery, {
            ...laneOptionsBaseWithTiming,
            limit: expansionLimit,
          })
      : [];
  const expansionRecallMs = Date.now() - expansionStarted;
  const mergeStarted = Date.now();
  const mergedInitial = sourceAwareInterface
    ? mergeUniqueScoredFactsByScore(
        [...primary, ...expansion],
        INTERFACE_SOURCE_POOL_LIMIT,
      )
    : mergeUniqueScoredFacts([...primary, ...expansion], limit);
  const currentCount = sourceAwareInterface
    ? Math.min(mergedInitial.length, limit)
    : mergedInitial.length;
  const fallbackStarted = Date.now();
  const fallback =
    input.useFallback && currentCount < limit
      ? sourceAwareInterface
        ? await recallScoredFactsForSignalSet(input.fallbackSignals, input.fallbackQuery, {
            ...laneOptionsBaseWithTiming,
            limit: interfacePoolLimit,
          })
        : await recallScoredFactsForSignals(input.fallbackQuery, {
            ...laneOptionsBaseWithTiming,
            limit: limit - currentCount,
          })
      : [];
  const fallbackRecallMs = Date.now() - fallbackStarted;
  const mergedPool = sourceAwareInterface
    ? mergeUniqueScoredFactsByScore(
        [...primary, ...expansion, ...fallback],
        INTERFACE_SOURCE_POOL_LIMIT,
      )
    : mergeUniqueScoredFacts([...primary, ...expansion, ...fallback], limit);
  const mergeMs = Date.now() - mergeStarted - fallbackRecallMs;
  const selectStarted = Date.now();
  const scoredFacts = sourceAwareInterface
    ? selectSourceAwareInterfaceFacts(
        mergedPool,
        [input.primaryQuery, input.expansionQuery, input.fallbackQuery].join('\n'),
        limit,
      )
    : mergedPool;
  const selectMs = Date.now() - selectStarted;
  const probeCount =
    sourceAwareInterface
      ? Number(input.primarySignals.some((signal) => signal.trim().length > 0) || input.primaryQuery.trim().length > 0) +
        Number(
          expansionLimit > 0 &&
            (input.expansionSignals.some((signal) => signal.trim().length > 0) ||
              input.expansionQuery.trim().length > 0),
        ) +
        Number(
          fallback.length > 0 &&
            (input.fallbackSignals.some((signal) => signal.trim().length > 0) ||
              input.fallbackQuery.trim().length > 0),
        )
      : Number(input.primaryQuery.trim().length > 0) +
        Number(expansionLimit > 0 && input.expansionQuery.trim().length > 0) +
        Number(fallback.length > 0 && input.fallbackQuery.trim().length > 0);
  return {
    id: config.id,
    memoryKinds: config.memoryKinds,
    scoredFacts,
    facts: scoredFacts.map((entry) => entry.fact),
    timings: {
      primaryRecallMs,
      expansionRecallMs,
      fallbackRecallMs,
      mergeMs,
      selectMs,
      totalMs: Date.now() - totalStarted,
      probeCount,
      poolSize: mergedPool.length,
      recalls: recallTimings,
    },
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

function mergeUniqueScoredFactsInterleaved(groups: ScoredFact[][], limit: number): ScoredFact[] {
  const merged: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const maxGroupLength = Math.max(0, ...groups.map((group) => group.length));
  for (let rank = 0; rank < maxGroupLength; rank += 1) {
    for (const group of groups) {
      const entry = group[rank];
      if (!entry || seenIds.has(entry.fact.id)) continue;
      merged.push(entry);
      seenIds.add(entry.fact.id);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

function mergeUniqueScoredFactsByScore(entries: ScoredFact[], limit: number): ScoredFact[] {
  return mergeUniqueScoredFacts(
    [...entries].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.fact.updatedAt - left.fact.updatedAt;
    }),
    limit,
  );
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
  const totalStarted = Date.now();
  const planStarted = Date.now();
  const queryPlan = buildRetrievalQuery(input);
  const planMs = Date.now() - planStarted;
  const {
    primaryQuery,
    expansionQuery,
    fallbackQuery,
    signals,
    primarySignals,
    expansionSignals,
    fallbackSignals,
  } = queryPlan;
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
  const options = recallOptions(input, limit);

  const shouldUseFallback =
    fallbackQuery.trim().length > 0 &&
    primarySignals.length > 0 &&
    fallbackQuery.trim() !== primaryQuery.trim();
  const lanesStarted = Date.now();
  const rawLanes = await Promise.all(
    RETRIEVAL_LANES.map((lane) =>
      recallLane(lane, {
        primaryQuery,
        expansionQuery,
        fallbackQuery,
        primarySignals,
        expansionSignals,
        fallbackSignals,
        useFallback: shouldUseFallback,
        options,
        totalLimit: limit,
      }),
    ),
  );
  const sourceLinkedStarted = Date.now();
  const sourceLinkedInterfaceFacts = recallSourceLinkedInterfaceFacts(rawLanes, options);
  const sourceLinkedInterfaceMs = Date.now() - sourceLinkedStarted;
  const lanes = rawLanes.map((lane) =>
    mergeSourceLinkedInterfaceFacts(
      lane,
      sourceLinkedInterfaceFacts,
      [primaryQuery, expansionQuery, fallbackQuery].join('\n'),
      laneLimit(
        RETRIEVAL_LANES.find((config) => config.id === lane.id) ?? RETRIEVAL_LANES[0],
        limit,
      ),
    ),
  );
  const lanesMs = Date.now() - lanesStarted;
  const laneFactCount = lanes.reduce((sum, lane) => sum + lane.scoredFacts.length, 0);
  const scopedCurrentStarted = Date.now();
  const scopedCurrentFacts = recallScopedCurrentFacts(
    input,
    limit - laneFactCount,
  );
  const scopedCurrentMs = Date.now() - scopedCurrentStarted;
  const mergeStarted = Date.now();
  const scoredFacts = mergeLaneResults(lanes, scopedCurrentFacts, limit);
  const facts = scoredFacts.map((entry) => entry.fact);
  const mergeMs = Date.now() - mergeStarted;
  const markFactsStarted = Date.now();
  markFactsRecalled(
    facts.map((fact) => fact.id),
    input.now ?? Date.now(),
  );
  const markFactsRecalledMs = Date.now() - markFactsStarted;

  const episodesStarted = Date.now();
  const episodes = recallEpisodesForQuery(primaryQuery || fallbackQuery, {
    threadId: input.conversationId,
    taskId: resolvedTaskId,
    limit: 4,
  });
  const episodesMs = Date.now() - episodesStarted;
  const laneTimings = Object.fromEntries(
    lanes.map((lane) => [lane.id, lane.timings]),
  ) as Record<RetrievalLaneId, RetrievalLaneTimings>;

  return {
    facts,
    episodes,
    querySignals: signals,
    scoredFacts,
    lanes,
    timings: {
      planMs,
      lanesMs,
      sourceLinkedInterfaceMs,
      scopedCurrentMs,
      mergeMs,
      markFactsRecalledMs,
      episodesMs,
      totalMs: Date.now() - totalStarted,
      probeCount: lanes.reduce((sum, lane) => sum + (lane.timings?.probeCount ?? 0), 0),
      laneTimings,
    },
  };
}
