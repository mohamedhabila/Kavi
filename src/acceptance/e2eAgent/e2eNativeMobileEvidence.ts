import type { E2ENativeMobileFixtureStateSnapshot } from './e2eNativeMobileFixtures';
import type { E2ENativeMobileOutcome } from './e2eNativeMobileOutcome';

export type E2ENativeMobileInvocationSnapshot = {
  sequence: number;
  toolName: string;
  handled: boolean;
  resultStatus: string | null;
  errorClass: string | null;
  stateBefore: E2ENativeMobileFixtureStateSnapshot;
  stateAfter: E2ENativeMobileFixtureStateSnapshot;
};

let invocationSnapshots: E2ENativeMobileInvocationSnapshot[] = [];

function classifyResult(result: E2ENativeMobileOutcome | null): {
  resultStatus: string | null;
  errorClass: string | null;
} {
  if (result === null) return { resultStatus: null, errorClass: null };
  try {
    const parsed = JSON.parse(result.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        resultStatus: Array.isArray(parsed) ? 'result_array' : 'result_value',
        errorClass: null,
      };
    }
    const record = parsed as Record<string, unknown>;
    const resultStatus = typeof record.status === 'string' ? record.status : 'result_object';
    const errorClass =
      result.status === 'failed' && typeof record.code === 'string'
        ? record.code
        : result.status === 'failed'
          ? 'tool_error'
          : null;
    return { resultStatus, errorClass };
  } catch {
    return { resultStatus: 'result_text', errorClass: null };
  }
}

export function resetE2ENativeMobileInvocationEvidence(): void {
  invocationSnapshots = [];
}

export function getE2ENativeMobileInvocationSnapshots(): E2ENativeMobileInvocationSnapshot[] {
  return JSON.parse(JSON.stringify(invocationSnapshots)) as E2ENativeMobileInvocationSnapshot[];
}

export function recordE2ENativeMobileInvocation(params: {
  toolName: string;
  result: E2ENativeMobileOutcome | null;
  stateBefore: E2ENativeMobileFixtureStateSnapshot;
  stateAfter: E2ENativeMobileFixtureStateSnapshot;
}): void {
  invocationSnapshots.push({
    sequence: invocationSnapshots.length + 1,
    toolName: params.toolName,
    handled: params.result !== null,
    ...classifyResult(params.result),
    stateBefore: params.stateBefore,
    stateAfter: params.stateAfter,
  });
}
