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
import { listLatestFactsForSourceRuns } from './facts/queries';
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
const DEFAULT_CANDIDATE_POOL_LIMIT = 256;
const DEFAULT_THRESHOLD = 0.01;
const SOURCE_RUN_TERMINAL_MEMORY_KIND = 'ui_inventory';

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

  const resolvedTaskId = input.taskId ?? input.activeTaskId;
  if (resolvedTaskId) {
    const task = getMemoryTask(resolvedTaskId);
    if (task?.title.trim()) primarySignals.push(task.title.trim());
    if (task?.summary?.trim()) primarySignals.push(task.summary.trim());
  }

  const planned = planRetrievalSignals(primarySignals);
  const signals = planned.primarySignals.length > 0 ? planned.primarySignals : [];
  if (signals.length === 0 && input.focusText?.trim()) {
    signals.push(input.focusText.trim());
  }
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

function hasSourceRunUiEvidence(fact: MemoryFact): boolean {
  return (
    typeof fact.sourceRunId === 'string' &&
    fact.sourceRunId.trim().length > 0 &&
    (fact.memoryKind === 'ui_inventory' ||
      fact.memoryKind === 'ui_field' ||
      fact.memoryKind === 'ui_filter_state' ||
      fact.memoryKind === 'ui_affordance' ||
      fact.memoryKind === 'surface_schema')
  );
}

function addFact(
  selected: MemoryFact[],
  seenIds: Set<string>,
  fact: MemoryFact,
  limit: number,
): void {
  if (selected.length >= limit || seenIds.has(fact.id)) return;
  selected.push(fact);
  seenIds.add(fact.id);
}

function includeSourceRunTerminalUiFacts(
  facts: ReadonlyArray<MemoryFact>,
  limit: number,
): MemoryFact[] {
  const sourceRunIds = Array.from(
    new Set(
      facts
        .filter(hasSourceRunUiEvidence)
        .map((fact) => fact.sourceRunId?.trim())
        .filter((sourceRunId): sourceRunId is string => Boolean(sourceRunId)),
    ),
  );
  if (sourceRunIds.length === 0) return [...facts];

  const latestBySourceRun = new Map<string, MemoryFact>();
  for (const fact of listLatestFactsForSourceRuns(sourceRunIds, {
    memoryKind: SOURCE_RUN_TERMINAL_MEMORY_KIND,
    limit: sourceRunIds.length,
  })) {
    if (fact.sourceRunId && !latestBySourceRun.has(fact.sourceRunId)) {
      latestBySourceRun.set(fact.sourceRunId, fact);
    }
  }

  const selected: MemoryFact[] = [];
  const seenIds = new Set<string>();
  for (const fact of facts) {
    addFact(selected, seenIds, fact, limit);
    if (selected.length >= limit) break;
    const latest = fact.sourceRunId ? latestBySourceRun.get(fact.sourceRunId) : undefined;
    if (latest) addFact(selected, seenIds, latest, limit);
    if (selected.length >= limit) break;
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
  const scoredFacts = query
    ? await recallScoredFactsForQuery(
        query,
        recallOptions(input, limit, (timing) => recallTimings.push(timing)),
      )
    : [];
  const recallMs = Date.now() - recallStarted;
  const facts = includeSourceRunTerminalUiFacts(
    scoredFacts.map((entry) => entry.fact),
    limit,
  );

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
