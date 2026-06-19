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
import { recallFactsForQuery, recallScoredFactsForQuery, type ScoredFact } from './factRecall';
import { recallRecentEpisodes } from './episodeRecall';
import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact } from './facts/types';
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
  query: string;
  signals: string[];
} {
  const signals: string[] = [];
  const userMessage = input.userMessage.trim();
  if (userMessage) signals.push(userMessage);
  const focusText = input.focusText?.trim();
  if (focusText) signals.push(focusText);

  signals.push(...collectGoalSignals(input.goals));
  signals.push(...collectAsyncWorkSignals(input.asyncWork));

  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  if (resolvedTaskId) {
    const task = getMemoryTask(resolvedTaskId);
    if (task?.title.trim()) signals.push(task.title.trim());
    if (task?.summary?.trim()) signals.push(task.summary.trim());
  }

  const uniqueSignals = Array.from(new Set(signals.filter((signal) => signal.length > 0)));
  return {
    query: uniqueSignals.join('\n'),
    signals: uniqueSignals,
  };
}

export async function orchestrateMemoryRetrieval(
  input: RetrievalOrchestratorInput,
): Promise<RetrievalOrchestratorResult> {
  const { query, signals } = buildRetrievalQuery(input);
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));

  const facts = await recallFactsForQuery(query, {
    limit,
    ...(input.embeddingConfig ? { embeddingConfig: input.embeddingConfig } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  });

  const episodes = recallRecentEpisodes({
    threadId: input.conversationId,
    taskId: resolvedTaskId,
    limit: 4,
  });

  const scoredFacts =
    facts.length > 0
      ? await recallScoredFactsForQuery(query, {
          limit,
          ...(input.embeddingConfig ? { embeddingConfig: input.embeddingConfig } : {}),
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
          ...(typeof input.now === 'number' ? { now: input.now } : {}),
        })
      : [];

  return {
    facts,
    episodes,
    querySignals: signals,
    scoredFacts,
  };
}
