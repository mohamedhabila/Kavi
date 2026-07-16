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
  'platform',
  'runStatus',
  'sourceRunId',
  'version',
] as const;
const MAX_GOAL_CHARS = 2_000;

export interface AgentRunTerminalEvidence {
  version: 1;
  sourceRunId: string;
  goal: string;
  runStatus: 'completed';
  graphStatus: 'finalized';
  platform: 'android' | 'ios';
  completedBlockingGoalCount: number;
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
  const blockingGoals = graph?.goals?.filter(isBlockingGoal) ?? [];
  const goal = fitAgentRunText(run.goal, MAX_GOAL_CHARS).trim();
  if (
    !platform ||
    !isExactMemoryProvenanceId(run.id) ||
    !goal ||
    run.status !== 'completed' ||
    graph?.status !== 'finalized' ||
    blockingGoals.some((candidate) => candidate.status !== 'completed')
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
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed)) return null;
  if (
    parsed.version !== 1 ||
    !isExactMemoryProvenanceId(parsed.sourceRunId) ||
    typeof parsed.goal !== 'string' ||
    !parsed.goal.trim() ||
    parsed.goal !== parsed.goal.trim() ||
    parsed.goal.length > MAX_GOAL_CHARS ||
    parsed.runStatus !== 'completed' ||
    parsed.graphStatus !== 'finalized' ||
    (parsed.platform !== 'android' && parsed.platform !== 'ios') ||
    !Number.isSafeInteger(parsed.completedBlockingGoalCount) ||
    (parsed.completedBlockingGoalCount as number) < 0
  ) {
    return null;
  }
  return {
    version: 1,
    sourceRunId: parsed.sourceRunId,
    goal: parsed.goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: parsed.platform,
    completedBlockingGoalCount: parsed.completedBlockingGoalCount as number,
  };
}

/** Builds the exact graph evidence payload used by both source fingerprinting and ingestion. */
export function collectAgentRunMemoryEvidence(run: AgentRun | undefined): string[] {
  if (!run) return [];
  const evidence = run.controlGraph?.goals?.flatMap((goal) => goal.evidence) ?? [];
  const terminal = buildAgentRunTerminalEvidence(run);
  return terminal ? [...evidence, terminal] : evidence;
}
