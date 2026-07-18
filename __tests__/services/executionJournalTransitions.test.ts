import {
  canTransitionExecutionEffect,
  canTransitionExecutionExternalHandle,
  canTransitionExecutionRun,
} from '../../src/services/executionJournal/transitions';
import {
  EXECUTION_EFFECT_STATUSES,
  EXECUTION_EXTERNAL_HANDLE_STATUSES,
  EXECUTION_RUN_STATUSES,
} from '../../src/services/executionJournal/types';

describe('closed execution journal transition contracts', () => {
  it('matches the exhaustive run transition matrix', () => {
    const expected = {
      queued: ['running', 'blocked', 'failed', 'cancelled', 'interrupted'],
      running: [
        'waiting',
        'blocked',
        'succeeded',
        'failed',
        'cancelled',
        'interrupted',
        'ambiguous',
      ],
      waiting: [
        'running',
        'blocked',
        'succeeded',
        'failed',
        'cancelled',
        'interrupted',
        'ambiguous',
      ],
      blocked: ['queued', 'running', 'failed', 'cancelled', 'interrupted'],
      succeeded: [],
      failed: [],
      cancelled: [],
      interrupted: [
        'queued',
        'running',
        'waiting',
        'blocked',
        'succeeded',
        'failed',
        'cancelled',
        'ambiguous',
      ],
      ambiguous: [
        'running',
        'waiting',
        'blocked',
        'succeeded',
        'failed',
        'cancelled',
        'interrupted',
      ],
    } as const;
    for (const from of EXECUTION_RUN_STATUSES) {
      for (const to of EXECUTION_RUN_STATUSES) {
        expect(canTransitionExecutionRun(from, to)).toBe(
          (expected[from] as readonly string[]).includes(to),
        );
      }
    }
  });

  it('matches the exhaustive effect transition matrix', () => {
    const expected = {
      planned: ['started'],
      started: ['applied', 'failed', 'cancelled', 'ambiguous'],
      applied: ['verified', 'ambiguous'],
      verified: [],
      failed: [],
      cancelled: [],
      ambiguous: ['applied', 'verified', 'failed', 'cancelled'],
    } as const;
    for (const from of EXECUTION_EFFECT_STATUSES) {
      for (const to of EXECUTION_EFFECT_STATUSES) {
        expect(canTransitionExecutionEffect(from, to)).toBe(
          (expected[from] as readonly string[]).includes(to),
        );
      }
    }
  });

  it('matches the exhaustive external-handle transition matrix', () => {
    const expected = {
      unknown: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
      pending: ['unknown', 'running', 'succeeded', 'failed', 'cancelled'],
      running: ['unknown', 'succeeded', 'failed', 'cancelled'],
      succeeded: [],
      failed: [],
      cancelled: [],
    } as const;
    for (const from of EXECUTION_EXTERNAL_HANDLE_STATUSES) {
      for (const to of EXECUTION_EXTERNAL_HANDLE_STATUSES) {
        expect(canTransitionExecutionExternalHandle(from, to)).toBe(
          (expected[from] as readonly string[]).includes(to),
        );
      }
    }
  });
});
