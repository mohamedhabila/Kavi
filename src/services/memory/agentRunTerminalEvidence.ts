import { Platform } from 'react-native';

import type { AgentGoal } from '../../engine/goals/types';
import type { AgentRun } from '../../types/agentRun';
import { fitAgentRunText } from './agentRunEvidenceCompaction';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const AGENT_RUN_TERMINAL_EVIDENCE_PREFIX = 'agent_run_terminal_v1:' as const;

const TERMINAL_EVIDENCE_KEYS = [
  'completedBlockingGoalCount',
  'goal',
  'graphStatus',
  'observedToolCallIds',
  'platform',
  'runStatus',
  'sourceRunId',
  'version',
] as const;
const MAX_GOAL_CHARS = 2_000;
const MAX_TOOL_CALL_COUNT = 64;

export interface AgentRunTerminalEvidence {
  version: 1;
  sourceRunId: string;
  goal: string;
  runStatus: 'completed';
  graphStatus: 'finalized';
  platform: 'android' | 'ios';
  completedBlockingGoalCount: number;
  observedToolCallIds: ReadonlyArray<string>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === TERMINAL_EVIDENCE_KEYS.length &&
    keys.every((key, index) => key === TERMINAL_EVIDENCE_KEYS[index])
  );
}

function isBlockingGoal(goal: AgentGoal): boolean {
  return goal.completionPolicy !== 'persistent';
}

function currentMobilePlatform(): 'android' | 'ios' | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

/**
 * Encodes a code-owned terminal proof only after the persisted graph and every
 * blocking goal agree that the run completed. The proof is deliberately
 * separate from model-authored final text.
 */
export function buildAgentRunTerminalEvidence(run: AgentRun): string | null {
  const platform = currentMobilePlatform();
  const graph = run.controlGraph;
  if (!graph || !Array.isArray(graph.goals) || !Array.isArray(graph.observedToolResults)) {
    return null;
  }
  const blockingGoals = graph.goals.filter(isBlockingGoal);
  const observedToolCallIds = graph.observedToolResults.map((result) => result.id);
  const goal = fitAgentRunText(run.goal, MAX_GOAL_CHARS).trim();
  if (
    !platform ||
    !isExactMemoryProvenanceId(run.id) ||
    !goal ||
    run.status !== 'completed' ||
    graph.status !== 'finalized' ||
    blockingGoals.some((candidate) => candidate.status !== 'completed') ||
    observedToolCallIds.length > MAX_TOOL_CALL_COUNT ||
    !observedToolCallIds.every(isExactMemoryProvenanceId) ||
    new Set(observedToolCallIds).size !== observedToolCallIds.length
  ) {
    return null;
  }
  const evidence: AgentRunTerminalEvidence = {
    version: 1,
    sourceRunId: run.id,
    goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform,
    completedBlockingGoalCount: blockingGoals.length,
    observedToolCallIds,
  };
  return `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify(evidence)}`;
}

export function parseAgentRunTerminalEvidence(value: string): AgentRunTerminalEvidence | null {
  if (!value.startsWith(AGENT_RUN_TERMINAL_EVIDENCE_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(AGENT_RUN_TERMINAL_EVIDENCE_PREFIX.length));
  } catch {
    return null;
  }
  return decodeAgentRunTerminalEvidence(parsed);
}

export function decodeAgentRunTerminalEvidence(value: unknown): AgentRunTerminalEvidence | null {
  if (!isPlainRecord(value) || !hasExactKeys(value)) return null;
  if (
    value.version !== 1 ||
    !isExactMemoryProvenanceId(value.sourceRunId) ||
    typeof value.goal !== 'string' ||
    !value.goal.trim() ||
    value.goal !== value.goal.trim() ||
    value.goal.length > MAX_GOAL_CHARS ||
    value.runStatus !== 'completed' ||
    value.graphStatus !== 'finalized' ||
    (value.platform !== 'android' && value.platform !== 'ios') ||
    !Number.isSafeInteger(value.completedBlockingGoalCount) ||
    (value.completedBlockingGoalCount as number) < 0 ||
    !Array.isArray(value.observedToolCallIds) ||
    value.observedToolCallIds.length > MAX_TOOL_CALL_COUNT ||
    !value.observedToolCallIds.every(isExactMemoryProvenanceId) ||
    new Set(value.observedToolCallIds).size !== value.observedToolCallIds.length
  ) {
    return null;
  }
  return {
    version: 1,
    sourceRunId: value.sourceRunId,
    goal: value.goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: value.platform,
    completedBlockingGoalCount: value.completedBlockingGoalCount as number,
    observedToolCallIds: value.observedToolCallIds,
  };
}

/** Builds the exact graph evidence payload used by both source fingerprinting and ingestion. */
export function collectAgentRunMemoryEvidence(run: AgentRun | undefined): string[] {
  if (!run) return [];
  const evidence = run.controlGraph?.goals?.flatMap((goal) => goal.evidence) ?? [];
  const terminal = buildAgentRunTerminalEvidence(run);
  return terminal ? [...evidence, terminal] : evidence;
}
