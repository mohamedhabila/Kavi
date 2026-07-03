// ---------------------------------------------------------------------------
// Kavi - Retrieval orchestrator
// ---------------------------------------------------------------------------
// The orchestrator intentionally stays small: it builds one structural query,
// asks the fact store for one ranked pool, and returns the selected facts plus
// recent episodes. Agent-run evidence is stored as compact procedure, outcome,
// source, artifact, decision, risk, summary, and durable fact records, so recall
// does not need domain-specific candidate lanes.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRunControlGraphAsyncWorkState } from '../../types/agentRun';
import {
  recallScoredFactsForQuery,
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecall';
import { recallEpisodesForQuery } from './episodeRecall';
import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact } from './facts/types';
import { markFactsRecalled } from './facts/mutations';
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
  limit?: number;
  now?: number;
}

export interface RetrievalOrchestratorResult {
  facts: MemoryFact[];
  episodes: MemoryEpisode[];
  querySignals: string[];
  scoredFacts: ScoredFact[];
  timings?: RetrievalOrchestratorTimings;
}

export interface RetrievalOrchestratorTimings {
  planMs: number;
  recallMs: number;
  markFactsRecalledMs: number;
  episodesMs: number;
  totalMs: number;
  recall?: RecallFactsTiming;
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

function buildQuerySignals(input: RetrievalOrchestratorInput): string[] {
  const primarySignals: string[] = [];
  const userMessage = input.userMessage.trim();
  if (userMessage) primarySignals.push(userMessage);

  primarySignals.push(...collectGoalSignals(input.goals));
  primarySignals.push(...collectAsyncWorkSignals(input.asyncWork));
  if (input.focusText?.trim()) primarySignals.push(input.focusText.trim());

  const resolvedTaskId = input.taskId ?? input.activeTaskId;
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
  limit: number,
  onTiming: (timing: RecallFactsTiming) => void,
): RecallFactsOptions {
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  return {
    limit,
    threshold: DEFAULT_THRESHOLD,
    candidatePoolLimit: DEFAULT_CANDIDATE_POOL_LIMIT,
    onTiming,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    ...(typeof input.now === 'number' ? { now: input.now } : {}),
  };
}

export async function orchestrateMemoryRetrieval(
  input: RetrievalOrchestratorInput,
): Promise<RetrievalOrchestratorResult> {
  const totalStarted = Date.now();
  const planStarted = Date.now();
  const querySignals = buildQuerySignals(input);
  const query = querySignals.join('\n');
  const planMs = Date.now() - planStarted;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const recallTimings: RecallFactsTiming[] = [];

  const recallStarted = Date.now();
  const scoredFacts = query
    ? await recallScoredFactsForQuery(
        query,
        recallOptions(input, limit, (timing) => recallTimings.push(timing)),
      )
    : [];
  const recallMs = Date.now() - recallStarted;
  const facts = scoredFacts.map((entry) => entry.fact);

  const markFactsStarted = Date.now();
  markFactsRecalled(
    facts.map((fact) => fact.id),
    input.now ?? Date.now(),
  );
  const markFactsRecalledMs = Date.now() - markFactsStarted;

  const episodesStarted = Date.now();
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const episodes = recallEpisodesForQuery(query, {
    threadId: input.conversationId,
    taskId: resolvedTaskId,
    limit: 4,
  });
  const episodesMs = Date.now() - episodesStarted;

  return {
    facts,
    episodes,
    querySignals,
    scoredFacts,
    timings: {
      planMs,
      recallMs,
      markFactsRecalledMs,
      episodesMs,
      totalMs: Date.now() - totalStarted,
      recall: recallTimings[0],
    },
  };
}
