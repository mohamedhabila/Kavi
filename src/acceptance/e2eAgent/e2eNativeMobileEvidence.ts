import type { E2ENativeMobileFixtureStateSnapshot } from './e2eNativeMobileFixtures';

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

function classifyResult(result: string | null): {
  resultStatus: string | null;
  errorClass: string | null;
} {
  if (result === null) return { resultStatus: null, errorClass: null };
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        resultStatus: Array.isArray(parsed) ? 'result_array' : 'result_value',
        errorClass: null,
      };
    }
    const record = parsed as Record<string, unknown>;
    const resultStatus = typeof record.status === 'string' ? record.status : 'result_object';
    const isErrorStatus = /error|denied|not_found/.test(resultStatus);
    const errorClass =
      typeof record.code === 'string' && (typeof record.error === 'string' || isErrorStatus)
        ? record.code
        : typeof record.error === 'string'
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
  result: string | null;
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
