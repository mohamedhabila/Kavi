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
import { listFactsForSourceRuns } from './facts/queries';
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

interface SignalRecallEntry {
  entry: ScoredFact;
  entries: ScoredFact[];
  fusionScore: number;
  firstSignalIndex: number;
  bestRank: number;
}

interface PerSignalGroupRecall {
  entry: ScoredFact;
  rank: number;
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
  const byGroupKey = new Map<string, SignalRecallEntry>();
  const groupEntryIds = new Map<string, Set<string>>();

  signalRecalls.forEach((recall, signalIndex) => {
    const perSignalGroups = new Map<string, PerSignalGroupRecall>();
    recall.forEach((entry, rankIndex) => {
      const rank = rankIndex + 1;
      const groupKey = signalRecallGroupKey(entry);
      const existingGroup = perSignalGroups.get(groupKey);
      if (
        !existingGroup ||
        rank < existingGroup.rank ||
        (rank === existingGroup.rank && entry.score > existingGroup.entry.score)
      ) {
        perSignalGroups.set(groupKey, { entry, rank });
      }
    });

    for (const [groupKey, groupRecall] of perSignalGroups) {
      const { entry, rank } = groupRecall;
      const contribution = 1 / (SIGNAL_RANK_FUSION_K + rank);
      const existing = byGroupKey.get(groupKey);
      if (!existing) {
        byGroupKey.set(groupKey, {
          entry,
          entries: entriesForGroup(recall, groupKey, groupEntryIds),
          fusionScore: contribution,
          firstSignalIndex: signalIndex,
          bestRank: rank,
        });
        continue;
      }
      existing.fusionScore += contribution;
      existing.bestRank = Math.min(existing.bestRank, rank);
      existing.firstSignalIndex = Math.min(existing.firstSignalIndex, signalIndex);
      existing.entries.push(...entriesForGroup(recall, groupKey, groupEntryIds));
      if (
        entry.score > existing.entry.score ||
        (entry.score === existing.entry.score &&
          entry.fact.updatedAt > existing.entry.fact.updatedAt)
      ) {
        existing.entry = entry;
      }
    }
  });

  const rankedGroups = Array.from(byGroupKey.values()).sort((left, right) => {
    if (right.fusionScore !== left.fusionScore) return right.fusionScore - left.fusionScore;
    if (left.firstSignalIndex !== right.firstSignalIndex) {
      return left.firstSignalIndex - right.firstSignalIndex;
    }
    if (left.bestRank !== right.bestRank) return left.bestRank - right.bestRank;
    if (right.entry.score !== left.entry.score) return right.entry.score - left.entry.score;
    return right.entry.fact.updatedAt - left.entry.fact.updatedAt;
  });
  const selected: ScoredFact[] = [];
  const selectedIds = new Set<string>();
  const add = (entry: ScoredFact): void => {
    if (selected.length >= limit || selectedIds.has(entry.fact.id)) return;
    selected.push(entry);
    selectedIds.add(entry.fact.id);
  };
  for (const group of rankedGroups) add(group.entry);
  for (const group of rankedGroups) {
    for (const entry of group.entries) add(entry);
  }
  return selected;
}

function signalRecallGroupKey(entry: ScoredFact): string {
  return entry.fact.sourceRunId ? `source:${entry.fact.sourceRunId}` : `fact:${entry.fact.id}`;
}

function entriesForGroup(
  recall: ReadonlyArray<ScoredFact>,
  groupKey: string,
  groupEntryIds: Map<string, Set<string>>,
): ScoredFact[] {
  const ids = groupEntryIds.get(groupKey) ?? new Set<string>();
  const entries: ScoredFact[] = [];
  for (const entry of recall) {
    if (signalRecallGroupKey(entry) !== groupKey || ids.has(entry.fact.id)) continue;
    ids.add(entry.fact.id);
    entries.push(entry);
  }
  groupEntryIds.set(groupKey, ids);
  return entries;
}

function scoredProcedureSupport(fact: MemoryFact, anchor: ScoredFact): ScoredFact {
  return {
    ...anchor,
    fact,
    score: anchor.score,
    textScore: 0,
    lexicalScore: 0,
    relevanceScore: anchor.relevanceScore,
  };
}

function withSelectedSourceProcedures(
  scoredFacts: ReadonlyArray<ScoredFact>,
  input: RetrievalOrchestratorInput,
  limit: number,
): ScoredFact[] {
  if (scoredFacts.length === 0 || limit <= 1) return [...scoredFacts];
  const selectedSourceRuns: string[] = [];
  const seenSourceRuns = new Set<string>();
  const sourceRunsWithProcedure = new Set<string>();
  for (const entry of scoredFacts) {
    const sourceRunId = entry.fact.sourceRunId;
    if (!sourceRunId) continue;
    if (!seenSourceRuns.has(sourceRunId)) {
      seenSourceRuns.add(sourceRunId);
      selectedSourceRuns.push(sourceRunId);
    }
    if (entry.fact.memoryKind === 'procedure') sourceRunsWithProcedure.add(sourceRunId);
  }
  const missingProcedureSourceRuns = selectedSourceRuns.filter(
    (sourceRunId) => !sourceRunsWithProcedure.has(sourceRunId),
  );
  if (missingProcedureSourceRuns.length === 0) return [...scoredFacts];
  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  const procedures = listFactsForSourceRuns(missingProcedureSourceRuns, {
    memoryKind: 'procedure',
    limit: missingProcedureSourceRuns.length,
    ...(input.conversationId ? { originConversationId: input.conversationId } : {}),
    ...(resolvedTaskId ? { originTaskId: resolvedTaskId } : {}),
    ...(typeof input.now === 'number' ? { asOf: input.now } : {}),
  });
  const procedureBySourceRun = new Map<string, MemoryFact>();
  for (const procedure of procedures) {
    if (!procedure.sourceRunId || procedureBySourceRun.has(procedure.sourceRunId)) continue;
    procedureBySourceRun.set(procedure.sourceRunId, procedure);
  }
  if (procedureBySourceRun.size === 0) return [...scoredFacts];

  const selected: ScoredFact[] = [];
  const selectedIds = new Set<string>();
  for (const entry of scoredFacts) {
    if (selected.length >= limit) break;
    if (!selectedIds.has(entry.fact.id)) {
      selected.push(entry);
      selectedIds.add(entry.fact.id);
    }
    const sourceRunId = entry.fact.sourceRunId;
    const procedure = sourceRunId ? procedureBySourceRun.get(sourceRunId) : null;
    if (!procedure || selectedIds.has(procedure.id) || selected.length >= limit) continue;
    selected.push(scoredProcedureSupport(procedure, entry));
    selectedIds.add(procedure.id);
  }
  return selected;
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
  const scoredFacts = withSelectedSourceProcedures(
    mergeSignalRecalls(signalRecalls, limit),
    input,
    limit,
  );
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
