import type { E2ERubric, E2EScenarioResult, E2EScenarioTurnTrace } from './types';
import {
  hashString,
  tailItems,
  type E2ERedactedHash,
  type E2ERedactedValueFingerprint,
} from './e2eTraceRedaction';
import {
  buildAgentRunEvidence,
  buildCompletionEvidence,
  buildFinalAssistantEvidence,
  buildLifecycleBoundaryEvidence,
  buildRouteEvidence,
  buildUserEvidence,
  type E2ERedactedAgentRunEvidence,
  type E2ERedactedCompletionEvidence,
  type E2ERedactedFinalAssistantEvidence,
  type E2ERedactedLifecycleBoundaryEvidence,
  type E2ERedactedRouteEvidence,
  type E2ERedactedUserEvidence,
} from './e2eTraceExecutionEvidence';
import {
  buildGraphSnapshotTrace,
  type E2ERedactedGraphSnapshotTrace,
} from './e2eTraceGraphSnapshots';
import {
  buildMemoryDeltaEvidence,
  buildMemoryFinalEvidence,
  type E2ERedactedMemoryDeltaEvidence,
  type E2ERedactedMemoryFinalEvidence,
} from './e2eTraceMemoryEvidence';
import {
  buildFinalNativeStateTrace,
  buildNativeTurnEvidence,
  type E2ERedactedNativeTurnEvidence,
} from './e2eTraceNativeEvidence';
import {
  buildToolCallTrace,
  buildToolResultTrace,
  type E2ERedactedToolCallTrace,
  type E2ERedactedToolResultTrace,
} from './e2eTraceToolResults';
import { buildUsageTrace, type E2ERedactedUsageTrace } from './e2eTraceUsage';

export type E2ERedactedTurnTrace = {
  turnIndex: number;
  completed: boolean;
  lifecycleBefore: E2ERedactedLifecycleBoundaryEvidence | null;
  user: E2ERedactedUserEvidence;
  route: E2ERedactedRouteEvidence;
  finalAssistant: E2ERedactedFinalAssistantEvidence | null;
  finalAssistantCandidateCount: number;
  completion: E2ERedactedCompletionEvidence;
  agentRun: E2ERedactedAgentRunEvidence | null;
  memoryDelta: E2ERedactedMemoryDeltaEvidence;
  native: E2ERedactedNativeTurnEvidence;
  usage: E2ERedactedUsageTrace;
  toolCalls: E2ERedactedToolCallTrace[];
  toolResults: E2ERedactedToolResultTrace[];
  graphSnapshots: E2ERedactedGraphSnapshotTrace[];
};

export type E2EScenarioTraceSummary = {
  schemaVersion: 'e2e-redacted-trace-v2';
  fixtureId: string;
  conversationIdHash: E2ERedactedHash;
  completed: boolean;
  durationMs: number;
  userTurnCount: number;
  turnCount: number;
  toolCallCount: number;
  graphStatus: string | null;
  errors: E2ERedactedHash[];
  usage: E2ERedactedUsageTrace;
  toolCalls: E2ERedactedToolCallTrace[];
  toolResults: E2ERedactedToolResultTrace[];
  graphSnapshots: E2ERedactedGraphSnapshotTrace[];
  memoryFinal: E2ERedactedMemoryFinalEvidence;
  nativeFixtureStateFingerprints: E2ERedactedValueFingerprint[];
  turns: E2ERedactedTurnTrace[];
};

const MAX_SCENARIO_GRAPH_SNAPSHOTS = 12;
const MAX_TURN_GRAPH_SNAPSHOTS = 6;

function buildTurnTrace(turn: E2EScenarioTurnTrace): E2ERedactedTurnTrace {
  return {
    turnIndex: turn.turnIndex,
    completed: turn.completed,
    lifecycleBefore: buildLifecycleBoundaryEvidence(turn.lifecycleBefore),
    user: buildUserEvidence(turn),
    route: buildRouteEvidence(turn),
    finalAssistant: buildFinalAssistantEvidence(turn),
    finalAssistantCandidateCount: turn.finalAssistantCandidateCount,
    completion: buildCompletionEvidence(turn.completion),
    agentRun: buildAgentRunEvidence(turn.agentRun),
    memoryDelta: buildMemoryDeltaEvidence(turn),
    native: buildNativeTurnEvidence(turn.native),
    usage: buildUsageTrace(turn.usage),
    toolCalls: turn.toolCalls.map(buildToolCallTrace),
    toolResults: turn.toolResults.map(buildToolResultTrace),
    graphSnapshots: tailItems(turn.graphSnapshots, MAX_TURN_GRAPH_SNAPSHOTS).map(
      buildGraphSnapshotTrace,
    ),
  };
}

export function buildE2EScenarioTraceSummary(params: {
  result: E2EScenarioResult;
  rubrics?: ReadonlyArray<E2ERubric>;
}): E2EScenarioTraceSummary {
  const { result } = params;
  const lastGraph = result.graphSnapshots[result.graphSnapshots.length - 1];
  return {
    schemaVersion: 'e2e-redacted-trace-v2',
    fixtureId: result.fixtureId,
    conversationIdHash: hashString(result.conversationId),
    completed: result.completed,
    durationMs: result.durationMs,
    userTurnCount: result.userTurnCount,
    turnCount: result.turnTraces.length,
    toolCallCount: result.toolCalls.length,
    graphStatus: lastGraph?.status ?? null,
    errors: result.errors.map(hashString),
    usage: buildUsageTrace(result.usage),
    toolCalls: result.toolCalls.map(buildToolCallTrace),
    toolResults: result.toolResults.map(buildToolResultTrace),
    graphSnapshots: tailItems(result.graphSnapshots, MAX_SCENARIO_GRAPH_SNAPSHOTS).map(
      buildGraphSnapshotTrace,
    ),
    memoryFinal: buildMemoryFinalEvidence(result.memoryFinalState),
    nativeFixtureStateFingerprints: buildFinalNativeStateTrace(result),
    turns: result.turnTraces.map(buildTurnTrace),
  };
}
