import { useSchedulerStore } from '../../src/services/scheduler/store';
import type { SchedulerTerminalReport } from '../../src/services/cron/types';
import { MAX_SCHEDULER_REPORT_WARNINGS } from '../../src/services/scheduler/terminalReport';
jest.mock('../../src/services/cron/schedule', () => ({
  computeNextRunAtMs: jest.fn((schedule: any, referenceMs: number) =>
    schedule.kind === 'at' ? schedule.atMs : referenceMs + 60_000,
  ),
}));
function addJob(name: string, schedule: any = { kind: 'every', everyMs: 60_000 }): string {
  return useSchedulerStore.getState().addJob({
    name,
    schedule,
    prompt: `Run ${name}`,
  });
}
function report(
  jobId: string,
  attemptId: string,
  overrides: Partial<SchedulerTerminalReport> = {},
): SchedulerTerminalReport {
  return {
    id: attemptId,
    jobId,
    jobName: 'Test job',
    status: 'success',
    notification: 'none',
    startedAtMs: 1,
    completedAtMs: 2,
    attempt: 1,
    trigger: 'scheduled',
    ...overrides,
  };
}
describe('scheduler store durability', () => {
  beforeEach(() => {
    useSchedulerStore.setState({ jobs: [], terminalReports: [] });
  });
  it('persists non-default failure alert policy', () => {
    const id = useSchedulerStore.getState().addJob({
      name: 'Policy Job',
      schedule: { kind: 'every', everyMs: 60_000 },
      prompt: 'Run policy job',
      failureAlert: { enabled: true, maxRetries: 4 },
    });
    expect(useSchedulerStore.getState().getJob(id)?.failureAlert).toEqual({
      enabled: true,
      maxRetries: 4,
    });
  });
  it('allows exactly one atomic claim for a due occurrence', () => {
    const id = addJob('Claim Job');
    const now = Date.now() + 60_000;
    const first = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-1',
      timestamp: now,
      force: true,
    });
    const second = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-2',
      timestamp: now,
      force: true,
    });
    expect(first).toMatchObject({ attempt: 1, job: { runningAttemptId: 'attempt-1' } });
    expect(second).toBeUndefined();
  });
  it('preserves an active claim across edits and rejects removal', () => {
    const id = addJob('Active Job');
    useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-active',
      timestamp: Date.now(),
      force: true,
    });
    useSchedulerStore.getState().disableJob(id);
    useSchedulerStore.getState().updateJob(id, { name: 'Renamed Active Job' });
    useSchedulerStore.getState().resetJobRetry(id);
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      name: 'Renamed Active Job',
      runningAttemptId: 'attempt-active',
    });
    expect(useSchedulerStore.getState().removeJob(id)).toBe(false);
  });
  it('settles only the attempt that owns the claim', () => {
    const id = addJob('CAS Job');
    useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-owner',
      timestamp: Date.now(),
      force: true,
    });
    const definitionRevision = useSchedulerStore.getState().getJob(id)!.definitionRevision;
    expect(
      useSchedulerStore
        .getState()
        .recordRun(
          id,
          'attempt-stale',
          definitionRevision,
          Date.now(),
          report(id, 'attempt-stale'),
        ),
    ).toBe(false);
    expect(useSchedulerStore.getState().getJob(id)?.runningAttemptId).toBe('attempt-owner');
    expect(
      useSchedulerStore
        .getState()
        .recordRun(
          id,
          'attempt-owner',
          definitionRevision,
          Date.now(),
          report(id, 'attempt-owner'),
        ),
    ).toBe(true);
    expect(useSchedulerStore.getState().getJob(id)?.runningAttemptId).toBeUndefined();
  });
  it('stages a terminal report atomically and removes it when settlement is restored', () => {
    const id = addJob('Atomic report');
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-report',
      timestamp: 100,
      force: true,
    })!;
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        'attempt-report',
        claim.job.definitionRevision,
        200,
        report(id, 'attempt-report'),
      );
    expect(useSchedulerStore.getState().terminalReports).toHaveLength(1);
    useSchedulerStore.getState().restoreJobAttemptClaim({
      id,
      attemptId: 'attempt-report',
      startedAtMs: 100,
      definitionRevision: claim.job.definitionRevision,
      attempt: 1,
    });
    expect(useSchedulerStore.getState()).toMatchObject({
      jobs: [expect.objectContaining({ runningAttemptId: 'attempt-report' })],
      terminalReports: [],
    });
  });
  it('reuses a durable retry conversation only until the occurrence settles', () => {
    const id = addJob('Retry conversation');
    const first = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-retry-conversation',
      timestamp: 100,
      force: true,
    })!;
    useSchedulerStore.getState().recordRunFailure(
      id,
      first.job.runningAttemptId!,
      first.job.definitionRevision,
      { timestamp: 200, error: 'transient', attempt: 1, nextRetryAtMs: 300, final: false },
      report(id, first.job.runningAttemptId!, {
        status: 'retrying',
        conversationId: 'conversation-1',
        conversationDurable: true,
      }),
    );
    expect(useSchedulerStore.getState().getJob(id)?.retryConversationId).toBe('conversation-1');
    const second = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-retry-success',
      timestamp: 300,
      force: true,
    })!;
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        second.job.runningAttemptId!,
        second.job.definitionRevision,
        400,
        report(id, second.job.runningAttemptId!),
      );
    expect(useSchedulerStore.getState().getJob(id)?.retryConversationId).toBeUndefined();
  });
  it('defers a safely fenced stranded attempt and preserves its thread', () => {
    const id = addJob('Safe background recovery', { kind: 'at', atMs: Date.now() + 1_000 });
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-safe-background',
      timestamp: 100,
      force: true,
    })!;
    expect(claim.job.runningEffectRisk).toBe('safe');
    expect(
      useSchedulerStore.getState().recordRunningAttemptConversation({
        id,
        attemptId: claim.job.runningAttemptId!,
        conversationId: 'conversation-safe-background',
      }),
    ).toBe(true);
    const [reconciled] = useSchedulerStore.getState().reconcileStrandedAttempts(200);
    expect(reconciled).toMatchObject({
      id,
      enabled: true,
      retryAttempts: 0,
      nextRetryAtMs: 200,
      retryConversationId: 'conversation-safe-background',
      retryOccurrenceId: 'attempt-safe-background',
      runningAttemptId: undefined,
    });
    expect(useSchedulerStore.getState().terminalReports).toEqual([
      expect.objectContaining({
        id: 'attempt-safe-background',
        status: 'retrying',
        notification: 'none',
        conversationId: 'conversation-safe-background',
      }),
    ]);
  });
  it('suppresses replay after the durable pre-effect fence becomes unsafe', () => {
    const id = addJob('Unsafe effect interruption');
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-effect-claimed',
      timestamp: 100,
      force: true,
    })!;
    expect(claim.job.runningEffectRisk).toBe('safe');
    expect(
      useSchedulerStore.getState().markRunningAttemptEffectUnsafe(id, claim.job.runningAttemptId!),
    ).toBe(true);
    const [reconciled] = useSchedulerStore.getState().reconcileStrandedAttempts(200);
    expect(reconciled).toMatchObject({
      lastAmbiguousAttemptId: 'attempt-effect-claimed',
      nextRetryAtMs: undefined,
      retryConversationId: undefined,
      runningAttemptId: undefined,
    });
    expect(useSchedulerStore.getState().terminalReports).toEqual([
      expect.objectContaining({ id: 'attempt-effect-claimed', status: 'error' }),
    ]);
  });
  it('settles a durable running completion instead of replaying its model turn', () => {
    const id = addJob('Recovered completion', { kind: 'at', atMs: Date.now() + 1_000 });
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-completed-before-crash',
      timestamp: 100,
      force: true,
    })!;
    useSchedulerStore.getState().recordRunningAttemptConversation({
      id,
      attemptId: claim.job.runningAttemptId!,
      conversationId: 'conversation-completed',
    });
    expect(
      useSchedulerStore.getState().recordRunningAttemptCompletion({
        id,
        attemptId: claim.job.runningAttemptId!,
        completion: {
          completedAtMs: 175,
          output: 'Durably projected answer',
          conversationId: 'conversation-completed',
          conversationDurable: true,
        },
      }),
    ).toBe(true);
    const [reconciled] = useSchedulerStore.getState().reconcileStrandedAttempts(200);
    expect(reconciled).toMatchObject({
      enabled: false,
      lastSuccessAtMs: 175,
      lastSettledAttemptId: 'attempt-completed-before-crash',
      runningAttemptId: undefined,
      nextRunAtMs: undefined,
    });
    expect(useSchedulerStore.getState().terminalReports).toEqual([
      expect.objectContaining({
        id: 'attempt-completed-before-crash',
        status: 'success',
        output: 'Durably projected answer',
        trigger: 'missed-recovery',
      }),
    ]);
  });
  it('terminalizes stranded recurring and one-shot claims without replay', () => {
    const recurringId = addJob('Recurring');
    const oneShotId = addJob('One Shot', { kind: 'at', atMs: Date.now() + 1_000 });
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((job) => ({
        ...job,
        runningAttemptId: `attempt-${job.id}`,
        runningStartedAtMs: 100,
        runningDefinitionRevision: job.definitionRevision,
      })),
    }));
    const now = Date.now() + 5_000;
    const reconciled = useSchedulerStore.getState().reconcileStrandedAttempts(now);
    expect(reconciled).toHaveLength(2);
    expect(useSchedulerStore.getState().getJob(recurringId)).toMatchObject({
      enabled: true,
      lastAmbiguousAttemptId: `attempt-${recurringId}`,
      lastAmbiguousAtMs: now,
      runningAttemptId: undefined,
    });
    expect(useSchedulerStore.getState().getJob(oneShotId)).toMatchObject({
      enabled: false,
      lastAmbiguousAttemptId: `attempt-${oneShotId}`,
      nextRunAtMs: undefined,
    });
    expect(useSchedulerStore.getState().terminalReports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `attempt-${recurringId}`,
          trigger: 'missed-recovery',
          status: 'error',
        }),
        expect.objectContaining({
          id: `attempt-${oneShotId}`,
          trigger: 'missed-recovery',
          status: 'error',
        }),
      ]),
    );
  });
  it('does not consume a replacement definition when an old attempt succeeds', () => {
    const id = addJob('Old definition', { kind: 'at', atMs: Date.now() + 1_000 });
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-old',
      timestamp: Date.now(),
      force: true,
    })!;
    const replacementRunAtMs = Date.now() + 120_000;
    useSchedulerStore.getState().updateJob(id, {
      name: 'Replacement definition',
      schedule: { kind: 'at', atMs: replacementRunAtMs },
      payload: { prompt: 'Run the replacement', mode: 'agentic' },
    });
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        'attempt-old',
        claim.job.definitionRevision,
        Date.now(),
        report(id, 'attempt-old'),
      );
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      name: 'Replacement definition',
      enabled: true,
      nextRunAtMs: replacementRunAtMs,
      runningAttemptId: undefined,
    });
  });
  it('does not schedule an old failure retry against a replacement definition', () => {
    const id = addJob('Old retry definition');
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-old-failure',
      timestamp: Date.now(),
      force: true,
    })!;
    useSchedulerStore.getState().updateJob(id, {
      name: 'New retry definition',
      schedule: { kind: 'every', everyMs: 300_000 },
      payload: { prompt: 'Use the new instructions', mode: 'agentic' },
    });
    const replacementNextRunAtMs = useSchedulerStore.getState().getJob(id)?.nextRunAtMs;
    useSchedulerStore.getState().recordRunFailure(
      id,
      'attempt-old-failure',
      claim.job.definitionRevision,
      {
        timestamp: Date.now(),
        error: 'old provider failed',
        attempt: 1,
        nextRetryAtMs: Date.now() + 30_000,
        final: false,
      },
      report(id, 'attempt-old-failure'),
    );
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      name: 'New retry definition',
      nextRunAtMs: replacementNextRunAtMs,
      nextRetryAtMs: undefined,
      runningAttemptId: undefined,
    });
  });
  it('rejects a delivery failure from an older settled occurrence', () => {
    const id = addJob('Delivery CAS');
    const first = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-first',
      timestamp: Date.now(),
      force: true,
    })!;
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        'attempt-first',
        first.job.definitionRevision,
        Date.now(),
        report(id, 'attempt-first'),
      );
    const second = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-second',
      timestamp: Date.now(),
      force: true,
    })!;
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        'attempt-second',
        second.job.definitionRevision,
        Date.now(),
        report(id, 'attempt-second'),
      );
    expect(
      useSchedulerStore.getState().recordTerminalReportDeliveryFailure({
        id,
        attemptId: 'attempt-first',
        timestamp: Date.now(),
        error: 'late notification failure',
      }),
    ).toEqual({ jobRecorded: false, reportRecorded: true });
    expect(useSchedulerStore.getState().getJob(id)?.lastDeliveryError).toBeUndefined();
  });
  it('bounds distinct terminal delivery diagnostics during a prolonged outage', () => {
    const id = addJob('Bounded delivery diagnostics');
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: 'attempt-delivery-outage',
      timestamp: 100,
      force: true,
    })!;
    useSchedulerStore
      .getState()
      .recordRun(
        id,
        claim.job.runningAttemptId!,
        claim.job.definitionRevision,
        200,
        report(id, claim.job.runningAttemptId!),
      );
    for (let index = 0; index < MAX_SCHEDULER_REPORT_WARNINGS + 5; index += 1) {
      useSchedulerStore.getState().recordTerminalReportDeliveryFailure({
        id,
        attemptId: 'attempt-delivery-outage',
        timestamp: 300 + index,
        error: `delivery failure ${index}`,
      });
    }
    expect(useSchedulerStore.getState().terminalReports[0]?.deliveryWarnings).toHaveLength(
      MAX_SCHEDULER_REPORT_WARNINGS,
    );
  });
  it.each([
    {
      label: 'rename',
      updates: { name: 'Renamed one shot' },
    },
    {
      label: 'delivery and failure policy edit',
      updates: {
        delivery: { mode: 'conversation' as const },
        failureAlert: { enabled: false },
      },
    },
  ])('settles a running one-shot once after a $label', ({ label, updates }) => {
    const runAtMs = Date.now() + 1_000;
    const id = addJob('One shot presentation edit', { kind: 'at', atMs: runAtMs });
    const claim = useSchedulerStore.getState().tryClaimJobAttempt({
      id,
      attemptId: `attempt-${label.replaceAll(' ', '-')}`,
      timestamp: Date.now(),
      force: true,
    })!;
    useSchedulerStore.getState().updateJob(id, updates);
    const editedJob = useSchedulerStore.getState().getJob(id)!;
    expect(editedJob.definitionRevision).toBe(claim.job.definitionRevision);
    expect(
      useSchedulerStore
        .getState()
        .recordRun(
          id,
          claim.job.runningAttemptId!,
          claim.job.definitionRevision,
          Date.now(),
          report(id, claim.job.runningAttemptId!),
        ),
    ).toBe(true);
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      nextRunAtMs: undefined,
      runningAttemptId: undefined,
      lastSettledAttemptId: claim.job.runningAttemptId,
    });
    expect(
      useSchedulerStore
        .getState()
        .recordRun(
          id,
          claim.job.runningAttemptId!,
          claim.job.definitionRevision,
          Date.now(),
          report(id, claim.job.runningAttemptId!),
        ),
    ).toBe(false);
  });
  it('preserves retry state for presentation edits and resets it for execution changes', () => {
    const id = addJob('Definition boundaries');
    const nextRetryAtMs = Date.now() + 30_000;
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              retryAttempts: 2,
              nextRetryAtMs,
              lastError: 'temporary provider failure',
            }
          : job,
      ),
    }));
    const initialRevision = useSchedulerStore.getState().getJob(id)!.definitionRevision;
    useSchedulerStore.getState().updateJob(id, {
      name: 'Renamed definition boundaries',
      delivery: { mode: 'conversation' },
      failureAlert: { enabled: true, maxRetries: 4 },
    });
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      definitionRevision: initialRevision,
      retryAttempts: 2,
      nextRetryAtMs,
      lastError: 'temporary provider failure',
    });
    const currentPayload = useSchedulerStore.getState().getJob(id)!.payload;
    useSchedulerStore.getState().updateJob(id, {
      payload: { ...currentPayload, prompt: 'Use replacement instructions' },
    });
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      definitionRevision: initialRevision + 1,
      retryAttempts: 0,
      nextRetryAtMs: undefined,
      lastError: undefined,
    });
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id ? { ...job, retryAttempts: 1, nextRetryAtMs, lastError: 'retry again' } : job,
      ),
    }));
    useSchedulerStore.getState().updateJob(id, {
      schedule: { kind: 'every', everyMs: 300_000 },
    });
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      definitionRevision: initialRevision + 2,
      retryAttempts: 0,
      nextRetryAtMs: undefined,
      lastError: undefined,
    });
    useSchedulerStore.setState((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? { ...job, retryAttempts: 1, nextRetryAtMs, lastError: 'retry once more' }
          : job,
      ),
    }));
    useSchedulerStore.getState().updateJob(id, { enabled: false });
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      enabled: false,
      definitionRevision: initialRevision + 3,
      retryAttempts: 0,
      nextRetryAtMs: undefined,
      lastError: undefined,
    });
  });
  it('invalidates a renamed wake while retaining its cancellation handle', () => {
    const id = addJob('Old wake title');
    const runAtMs = Date.now() + 60_000;
    useSchedulerStore.getState().updateJobRuntimeState(id, {
      pendingWakeNotificationId: 'wake-old-title',
      pendingWakeNotificationRunAtMs: runAtMs,
    });
    const initialRevision = useSchedulerStore.getState().getJob(id)!.definitionRevision;
    useSchedulerStore.getState().updateJob(id, { name: 'New wake title' });
    expect(useSchedulerStore.getState().getJob(id)).toMatchObject({
      name: 'New wake title',
      definitionRevision: initialRevision,
      pendingWakeNotificationId: 'wake-old-title',
      pendingWakeNotificationRunAtMs: undefined,
    });
  });
  it('does not redeliver v5 ambiguity history and removes evaluation telemetry', async () => {
    const id = addJob('Migrated ambiguity');
    const legacyJob = {
      ...useSchedulerStore.getState().getJob(id)!,
      lastAmbiguousAttemptId: 'attempt-already-reported',
      lastAmbiguousReportedAttemptId: undefined,
    };
    const persistOptions = useSchedulerStore.persist.getOptions();
    expect(persistOptions.version).toBe(7);
    const migrated = (await Promise.resolve(
      persistOptions.migrate?.(
        {
          jobs: [legacyJob],
          lastEvaluationAtMs: Date.now(),
        },
        5,
      ),
    )) as {
      jobs: (typeof legacyJob)[];
      terminalReports: SchedulerTerminalReport[];
      lastEvaluationAtMs?: number;
    };
    expect(migrated).not.toHaveProperty('lastEvaluationAtMs');
    expect(migrated.jobs[0]).not.toHaveProperty('lastAmbiguousReportedAttemptId');
    expect(migrated.terminalReports).toEqual([]);
  });
  it('migrates an unreported v6 ambiguity into the durable outbox', async () => {
    const id = addJob('Unreported v6 ambiguity');
    const legacyJob = {
      ...useSchedulerStore.getState().getJob(id)!,
      lastError: 'replay suppressed',
      lastSettledAttemptId: 'attempt-v6',
      lastAmbiguousAttemptId: 'attempt-v6',
      lastAmbiguousAtMs: 200,
      lastAmbiguousStartedAtMs: 100,
      lastAmbiguousAttemptNumber: 2,
      lastAmbiguousReportedAttemptId: undefined,
    };
    const migrated = (await Promise.resolve(
      useSchedulerStore.persist
        .getOptions()
        .migrate?.({ jobs: [legacyJob], terminalReports: [] }, 6),
    )) as { jobs: (typeof legacyJob)[]; terminalReports: SchedulerTerminalReport[] };
    expect(migrated.jobs[0]).not.toHaveProperty('lastAmbiguousReportedAttemptId');
    expect(migrated.terminalReports).toEqual([
      expect.objectContaining({
        id: 'attempt-v6',
        jobId: id,
        trigger: 'missed-recovery',
        notification: 'failure',
      }),
    ]);
  });
});
