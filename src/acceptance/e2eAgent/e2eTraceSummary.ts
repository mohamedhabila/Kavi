import { getE2ENativeMobileFixtureStateSnapshot } from './e2eNativeMobileFixtures';
import type { E2ERubric, E2EScenarioResult, E2EScenarioTurnTrace } from './types';
import {
  buildValueFingerprint,
  hashString,
  tailItems,
  type E2ERedactedHash,
  type E2ERedactedValueFingerprint,
} from './e2eTraceRedaction';
import {
  buildGraphSnapshotTrace,
  type E2ERedactedGraphSnapshotTrace,
} from './e2eTraceGraphSnapshots';
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
  nativeFixtureStateFingerprints: E2ERedactedValueFingerprint[];
  turns: E2ERedactedTurnTrace[];
};

const MAX_SCENARIO_GRAPH_SNAPSHOTS = 12;
const MAX_TURN_GRAPH_SNAPSHOTS = 6;
const MAX_NATIVE_FIXTURE_STATE_FIELDS = 96;

function collectPrimitiveValueFingerprints(
  value: unknown,
  path: string[],
  fingerprints: E2ERedactedValueFingerprint[],
): void {
  if (fingerprints.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) {
    return;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      const fingerprint = buildValueFingerprint(path.join('.'), value, {
        count: value.length,
      });
      if (fingerprint) {
        fingerprints.push(fingerprint);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      collectPrimitiveValueFingerprints(record[key], [...path, key], fingerprints);
      if (fingerprints.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) {
        return;
      }
    }
    return;
  }

  const fieldPath = path.join('.');
  if (!fieldPath) {
    return;
  }
  const isCount =
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && /Count$/.test(fieldPath);
  const fingerprint = buildValueFingerprint(fieldPath, value, {
    ...(isCount ? { count: value } : {}),
  });
  if (fingerprint) {
    fingerprints.push(fingerprint);
  }
}

function buildNativeFixtureStateTrace(): E2ERedactedValueFingerprint[] {
  const fingerprints: E2ERedactedValueFingerprint[] = [];
  collectPrimitiveValueFingerprints(getE2ENativeMobileFixtureStateSnapshot(), [], fingerprints);
  return fingerprints;
}

function buildTurnTrace(turn: E2EScenarioTurnTrace): E2ERedactedTurnTrace {
  return {
    turnIndex: turn.turnIndex,
    completed: turn.completed,
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
    nativeFixtureStateFingerprints: buildNativeFixtureStateTrace(),
    turns: result.turnTraces.map(buildTurnTrace),
  };
}
