import { Platform } from 'react-native';

import { buildToolEffectReceiptEvidence } from '../../engine/goals/effectCompletionEvidence';
import type { AgentRun } from '../../types/agentRun';
import type { Message } from '../../types/message';
import { fitAgentRunText } from './agentRunEvidenceCompaction';
import { isInternalAgentControlToolName } from './agentRunExperienceEvidencePolicy';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export const AGENT_RUN_TERMINAL_EVIDENCE_PREFIX = 'agent_run_terminal_v1:' as const;

const TERMINAL_EVIDENCE_KEYS = [
  'goal',
  'graphStatus',
  'observedToolCallIds',
  'platform',
  'runStatus',
  'sourceRunId',
  'version',
] as const;
/** Version 1 also counted the run's completed blocking goals, which runs no longer keep. */
const LEGACY_V1_TERMINAL_EVIDENCE_KEYS = [
  'completedBlockingGoalCount',
  ...TERMINAL_EVIDENCE_KEYS,
].sort();
const MAX_GOAL_CHARS = 2_000;
const MAX_TOOL_CALL_COUNT = 64;

export interface AgentRunTerminalEvidence {
  version: 2;
  sourceRunId: string;
  goal: string;
  runStatus: 'completed';
  graphStatus: 'finalized';
  platform: 'android' | 'ios';
  observedToolCallIds: ReadonlyArray<string>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function hasVersionedKeys(value: Record<string, unknown>): boolean {
  if (value.version === 2) return hasExactKeys(value, TERMINAL_EVIDENCE_KEYS);
  return (
    value.version === 1 &&
    hasExactKeys(value, LEGACY_V1_TERMINAL_EVIDENCE_KEYS) &&
    Number.isSafeInteger(value.completedBlockingGoalCount) &&
    (value.completedBlockingGoalCount as number) >= 0
  );
}

function currentMobilePlatform(): 'android' | 'ios' | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

/**
 * Encodes a code-owned terminal proof only after the run and its persisted graph agree
 * that the run completed. The proof is deliberately separate from model-authored final
 * text.
 */
export function buildAgentRunTerminalEvidence(run: AgentRun): string | null {
  const platform = currentMobilePlatform();
  const graph = run.controlGraph;
  if (!graph || !Array.isArray(graph.observedToolResults)) {
    return null;
  }
  const observedToolCallIds = graph.observedToolResults.map((result) => result.id);
  const goal = fitAgentRunText(run.goal, MAX_GOAL_CHARS).trim();
  if (
    !platform ||
    !isExactMemoryProvenanceId(run.id) ||
    !goal ||
    run.status !== 'completed' ||
    graph.status !== 'finalized' ||
    observedToolCallIds.length > MAX_TOOL_CALL_COUNT ||
    !observedToolCallIds.every(isExactMemoryProvenanceId) ||
    new Set(observedToolCallIds).size !== observedToolCallIds.length
  ) {
    return null;
  }
  const evidence: AgentRunTerminalEvidence = {
    version: 2,
    sourceRunId: run.id,
    goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform,
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
  if (!isPlainRecord(value) || !hasVersionedKeys(value)) return null;
  if (
    !isExactMemoryProvenanceId(value.sourceRunId) ||
    typeof value.goal !== 'string' ||
    !value.goal.trim() ||
    value.goal !== value.goal.trim() ||
    value.goal.length > MAX_GOAL_CHARS ||
    value.runStatus !== 'completed' ||
    value.graphStatus !== 'finalized' ||
    (value.platform !== 'android' && value.platform !== 'ios') ||
    !Array.isArray(value.observedToolCallIds) ||
    value.observedToolCallIds.length > MAX_TOOL_CALL_COUNT ||
    !value.observedToolCallIds.every(isExactMemoryProvenanceId) ||
    new Set(value.observedToolCallIds).size !== value.observedToolCallIds.length
  ) {
    return null;
  }
  return {
    version: 2,
    sourceRunId: value.sourceRunId,
    goal: value.goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: value.platform,
    observedToolCallIds: value.observedToolCallIds,
  };
}

/**
 * The settled receipt of each tool call the turn made, in call order. A tool call keeps
 * its receipts append-only on the message, so its last receipt is the one its execution
 * settled with. Internal control-plane tools are how the assistant managed its own work,
 * not steps of it.
 */
function collectTurnEffectReceiptEvidence(turnMessages: ReadonlyArray<Message>): string[] {
  const evidence: string[] = [];
  for (const message of turnMessages) {
    for (const toolCall of message.toolCalls ?? []) {
      const settled = toolCall.effectReceipts?.at(-1);
      if (settled && !isInternalAgentControlToolName(settled.toolName)) {
        evidence.push(buildToolEffectReceiptEvidence(settled));
      }
    }
  }
  return evidence;
}

/**
 * The exact run evidence both source fingerprinting and ingestion use: the receipts the
 * turn's tool calls recorded, followed by the run's terminal proof.
 */
export function collectAgentRunMemoryEvidence(
  run: AgentRun | undefined,
  turnMessages: ReadonlyArray<Message>,
): string[] {
  if (!run) return [];
  const evidence = collectTurnEffectReceiptEvidence(turnMessages);
  const terminal = buildAgentRunTerminalEvidence(run);
  return terminal ? [...evidence, terminal] : evidence;
}
