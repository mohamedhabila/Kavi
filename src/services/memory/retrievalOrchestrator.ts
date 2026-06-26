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
import { recallRecentEpisodes } from './episodeRecall';
import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact } from './facts/types';
import { markFactsRecalled } from './facts/mutations';
import { listFacts } from './facts/queries';
import { getMemoryTask } from './tasks';

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
}

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
  fallbackQuery: string;
  signals: string[];
  primarySignals: string[];
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

  const uniquePrimarySignals = Array.from(
    new Set(primarySignals.filter((signal) => signal.length > 0)),
  );
  const uniqueFallbackSignals = Array.from(
    new Set(fallbackSignals.filter((signal) => signal.length > 0)),
  );
  const effectivePrimarySignals =
    uniquePrimarySignals.length > 0 ? uniquePrimarySignals : uniqueFallbackSignals;
  const uniqueSignals = Array.from(new Set([...effectivePrimarySignals, ...uniqueFallbackSignals]));
  return {
    primaryQuery: effectivePrimarySignals.join('\n'),
    fallbackQuery: uniqueFallbackSignals.join('\n'),
    signals: uniqueSignals,
    primarySignals: effectivePrimarySignals,
    fallbackSignals: uniqueFallbackSignals,
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

function mergeScoredFacts(
  primary: ScoredFact[],
  fallback: ScoredFact[],
  scopedCurrent: ScoredFact[],
  limit: number,
): ScoredFact[] {
  const merged: ScoredFact[] = [];
  const seenIds = new Set<string>();
  for (const entry of [...primary, ...fallback, ...scopedCurrent]) {
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
        limit: remainingLimit,
      }),
    );
  }
  if (selected.length < remainingLimit && input.conversationId) {
    addFacts(
      listFacts({
        scope: 'conversation',
        originConversationId: input.conversationId,
        limit: remainingLimit - selected.length,
      }),
    );
  }
  return selected.map(scoredScopedCurrentFact);
}

export async function orchestrateMemoryRetrieval(
  input: RetrievalOrchestratorInput,
): Promise<RetrievalOrchestratorResult> {
  const { primaryQuery, fallbackQuery, signals, primarySignals } = buildRetrievalQuery(input);
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
  const options = recallOptions(input, limit);

  const primaryScoredFacts = await recallScoredFactsForSignals(primaryQuery, options);
  const shouldUseFallback =
    fallbackQuery.trim().length > 0 &&
    primarySignals.length > 0 &&
    fallbackQuery.trim() !== primaryQuery.trim() &&
    primaryScoredFacts.length < limit;
  const fallbackScoredFacts = shouldUseFallback
    ? await recallScoredFactsForSignals(fallbackQuery, {
        ...options,
        limit: limit - primaryScoredFacts.length,
      })
    : [];
  const scopedCurrentFacts = recallScopedCurrentFacts(
    input,
    limit - primaryScoredFacts.length - fallbackScoredFacts.length,
  );
  const scoredFacts = mergeScoredFacts(
    primaryScoredFacts,
    fallbackScoredFacts,
    scopedCurrentFacts,
    limit,
  );
  const facts = scoredFacts.map((entry) => entry.fact);
  markFactsRecalled(
    facts.map((fact) => fact.id),
    input.now ?? Date.now(),
  );

  const episodes = recallRecentEpisodes({
    threadId: input.conversationId,
    taskId: resolvedTaskId,
    limit: 4,
  });

  return {
    facts,
    episodes,
    querySignals: signals,
    scoredFacts,
  };
}
