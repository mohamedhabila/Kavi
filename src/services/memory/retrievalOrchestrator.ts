// ---------------------------------------------------------------------------
// Kavi - Retrieval orchestrator
// ---------------------------------------------------------------------------
// The orchestrator intentionally stays small: it builds one structural query,
// asks the fact store for one ranked pool, and returns the selected facts plus
// recent episodes. UI transitions, fields, controls, and outcomes are stored as
// ordinary fact text, so recall does not need separate lanes or source-link
// reconstruction.
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
const SIGNAL_RANK_FUSION_K = 60;
const SIGNAL_ORDER_DECAY = 0.85;

interface SignalRecallEntry {
  entry: ScoredFact;
  fusionScore: number;
  firstSignalIndex: number;
  bestRank: number;
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
  const signals = planned.primarySignals.length > 0 ? planned.primarySignals : [];
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

function mergeSignalRecalls(
  signalRecalls: ReadonlyArray<ReadonlyArray<ScoredFact>>,
  limit: number,
): ScoredFact[] {
  const byFactId = new Map<string, SignalRecallEntry>();

  signalRecalls.forEach((recall, signalIndex) => {
    const signalWeight = SIGNAL_ORDER_DECAY ** signalIndex;
    recall.forEach((entry, rankIndex) => {
      const rank = rankIndex + 1;
      const contribution = signalWeight / (SIGNAL_RANK_FUSION_K + rank);
      const existing = byFactId.get(entry.fact.id);
      if (!existing) {
        byFactId.set(entry.fact.id, {
          entry,
          fusionScore: contribution,
          firstSignalIndex: signalIndex,
          bestRank: rank,
        });
        return;
      }
      existing.fusionScore += contribution;
      existing.bestRank = Math.min(existing.bestRank, rank);
      existing.firstSignalIndex = Math.min(existing.firstSignalIndex, signalIndex);
      if (
        entry.score > existing.entry.score ||
        (entry.score === existing.entry.score && entry.fact.updatedAt > existing.entry.fact.updatedAt)
      ) {
        existing.entry = entry;
      }
    });
  });

  return Array.from(byFactId.values())
    .sort((left, right) => {
      if (right.fusionScore !== left.fusionScore) return right.fusionScore - left.fusionScore;
      if (left.firstSignalIndex !== right.firstSignalIndex) {
        return left.firstSignalIndex - right.firstSignalIndex;
      }
      if (left.bestRank !== right.bestRank) return left.bestRank - right.bestRank;
      if (right.entry.score !== left.entry.score) return right.entry.score - left.entry.score;
      return right.entry.fact.updatedAt - left.entry.fact.updatedAt;
    })
    .slice(0, limit)
    .map((merged) => merged.entry);
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
  const signalRecalls = query
    ? await Promise.all(
        querySignals.map((signal) =>
          recallScoredFactsForQuery(
            signal,
            recallOptions(input, limit, (timing) => recallTimings.push(timing)),
          ),
        ),
      )
    : [];
  const scoredFacts = mergeSignalRecalls(signalRecalls, limit);
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
