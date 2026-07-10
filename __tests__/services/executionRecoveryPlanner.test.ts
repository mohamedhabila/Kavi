import {
  EXECUTION_RECOVERY_BLOCK_REASONS,
  planExecutionRecovery,
  type ExecutionRecoveryBlockReason,
} from '../../src/services/executionJournal/recoveryPlanner';
import type {
  ExecutionApprovalState,
  ExecutionCheckpointBoundary,
  ExecutionRunStatus,
} from '../../src/services/executionJournal/types';
import {
  recoveryCheckpoint,
  recoveryCheckpointHistory,
  recoveryEffect,
  recoveryHandle,
  recoveryInitialCheckpoint,
  recoveryRun,
  recoverySettledEffectHistory,
  recoverySnapshot,
} from '../helpers/executionRecoveryFixtures';

describe('execution recovery planner boundaries', () => {
  it.each<
    [
      ExecutionCheckpointBoundary,
      'system' | 'work' | 'review',
      string,
      ExecutionRecoveryBlockReason | null,
    ]
  >([
    ['run_created', 'system', 'resume_model_step', null],
    ['before_model', 'work', 'resume_model_step', null],
    ['after_model', 'work', 'resume_persisted_tool_batch', null],
    ['before_effect', 'work', 'resume_persisted_tool_batch', null],
    ['after_effect', 'work', 'continue_after_tool_result', null],
    ['waiting_approval', 'work', 'resume_persisted_tool_batch', null],
    ['waiting_external', 'work', 'block', 'missing_external_handle'],
    ['safe_yield', 'work', 'resume_model_step', null],
    ['safe_yield', 'review', 'resume_review', null],
    ['after_model', 'review', 'resume_review', null],
    ['terminal', 'work', 'block', 'terminal_boundary_status_mismatch'],
  ])('maps %s/%s to only %s', (boundary, phase, expectedKind, expectedReason) => {
    const command = planExecutionRecovery(
      recoverySnapshot({ checkpoints: recoveryCheckpointHistory({ boundary, phase }) }),
    );
    expect(command.kind).toBe(expectedKind);
    if (expectedReason) {
      expect(command).toEqual(expect.objectContaining({ reason: expectedReason }));
    }
  });

  it('emits state references and hashes, never tool payloads, for resumable work', () => {
    const command = planExecutionRecovery(recoverySnapshot());
    expect(command).toEqual({
      kind: 'resume_model_step',
      runId: 'run-1',
      checkpointId: 'checkpoint-1',
      controlEpoch: 0,
      stateRefId: 'state-0',
      stateDigest: 'c'.repeat(64),
    });
    expect(JSON.stringify(command)).not.toMatch(/prompt|credential|argument|result|requestDigest/i);
  });

  it.each(['queued', 'running', 'waiting', 'interrupted'] as ExecutionRunStatus[])(
    'resumes a valid %s run from its safe boundary',
    (status) => {
      expect(planExecutionRecovery(recoverySnapshot({ run: recoveryRun({ status }) })).kind).toBe(
        'resume_model_step',
      );
    },
  );

  it.each(['not_resumable', 'monitor_only'] as const)(
    'does not turn %s state into active execution',
    (resumeStrategy) => {
      const command = planExecutionRecovery(
        recoverySnapshot({
          checkpoints: recoveryCheckpointHistory({ resumeStrategy }),
        }),
      );
      expect(command).toEqual(
        expect.objectContaining({
          kind: 'block',
          reason: 'resume_strategy_forbids_execution',
        }),
      );
    },
  );

  it('still reconciles an exact external handle for a non-resumable local process', () => {
    const handle = recoveryHandle('pending');
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          checkpoints: recoveryCheckpointHistory({
            boundary: 'before_effect',
            resumeStrategy: 'not_resumable',
          }),
          effects: [recoveryEffect('started')],
          handles: [handle],
        }),
      ),
    ).toEqual({
      kind: 'reconcile_external_handles',
      runId: 'run-1',
      controlEpoch: 0,
      effectIds: ['effect-1'],
      handleIds: ['handle-1'],
    });
  });
});

describe('execution recovery planner effect safety', () => {
  it.each([
    ['planned', 'resume_persisted_tool_batch', null],
    ['started', 'block', 'unresolved_effect_without_reconciliation'],
    ['applied', 'continue_after_tool_result', null],
    ['verified', 'continue_after_tool_result', null],
    ['failed', 'continue_after_tool_result', null],
    ['cancelled', 'continue_after_tool_result', null],
    ['ambiguous', 'block', 'unresolved_effect_without_reconciliation'],
  ] as const)('handles a %s effect without unsafe inference', (status, kind, reason) => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect' }),
        effects: [recoveryEffect(status)],
      }),
    );
    expect(command.kind).toBe(kind);
    if (reason) expect(command).toEqual(expect.objectContaining({ reason }));
  });

  it.each(['started', 'ambiguous'] as const)(
    'replays only explicitly effect-free, replay-safe %s work',
    (status) => {
      const command = planExecutionRecovery(
        recoverySnapshot({
          checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect' }),
          effects: [
            recoveryEffect(status, {
              effectClass: 'none',
              idempotencyClass: 'effect_free',
              idempotencyKeyDigest: null,
              retryPolicy: 'replay_safe',
            }),
          ],
        }),
      );
      expect(command).toEqual(
        expect.objectContaining({
          kind: 'resume_persisted_tool_batch',
          replayEffectIds: ['effect-1'],
          requiresExecutionAuthorityRevalidation: true,
        }),
      );
    },
  );

  it.each(['started', 'ambiguous'] as const)(
    'reconciles every durable handle before resolving a %s effect',
    (status) => {
      const command = planExecutionRecovery(
        recoverySnapshot({
          checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect' }),
          effects: [recoveryEffect(status)],
          handles: [recoveryHandle('succeeded')],
        }),
      );
      expect(command).toEqual({
        kind: 'reconcile_external_handles',
        runId: 'run-1',
        controlEpoch: 0,
        effectIds: ['effect-1'],
        handleIds: ['handle-1'],
      });
    },
  );

  it.each([
    ['unknown', 'reconcile_external_handles'],
    ['pending', 'reconcile_external_handles'],
    ['running', 'reconcile_external_handles'],
    ['succeeded', 'continue_after_tool_result'],
    ['failed', 'continue_after_tool_result'],
    ['cancelled', 'continue_after_tool_result'],
  ] as const)('treats a %s handle monotonically', (status, expectedKind) => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect' }),
        effects: [recoveryEffect('verified')],
        handles: [recoveryHandle(status)],
      }),
    );
    expect(command.kind).toBe(expectedKind);
  });

  it('reconciles before processing completed results or planning remaining batch work', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect' }),
        effects: [
          recoveryEffect('verified'),
          recoveryEffect('planned', {
            id: 'effect-2',
            toolCallId: 'tool-call-2',
            idempotencyKeyDigest: 'e'.repeat(64),
          }),
        ],
        handles: [recoveryHandle('pending')],
      }),
    );
    expect(command.kind).toBe('reconcile_external_handles');
  });

  it('continues a persisted result even when authority or the run later became blocked', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        run: recoveryRun({ status: 'blocked' }),
        checkpoints: recoveryCheckpointHistory({
          boundary: 'before_effect',
          approvalState: 'expired',
        }),
        effects: [recoveryEffect('failed')],
      }),
    );
    expect(command.kind).toBe('continue_after_tool_result');
  });

  it('does not reprocess completed effects from a settled earlier batch', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoverySettledEffectHistory(),
        effects: [recoveryEffect('verified')],
      }),
    );
    expect(command.kind).toBe('resume_model_step');
  });

  it('does not hide an unverified applied effect behind a later model boundary', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoverySettledEffectHistory(),
        effects: [recoveryEffect('applied')],
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        kind: 'block',
        reason: 'snapshot_invalid',
        effectIds: ['effect-1'],
      }),
    );
  });

  it('blocks an ambiguous run that has no effect evidence to reconcile or replay', () => {
    expect(
      planExecutionRecovery(recoverySnapshot({ run: recoveryRun({ status: 'ambiguous' }) })),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'ambiguous_run_without_evidence' }));
  });
});

describe('execution recovery planner authority', () => {
  const cases: Array<
    [
      ExecutionApprovalState,
      'resume_persisted_tool_batch' | 'block',
      ExecutionRecoveryBlockReason | null,
    ]
  > = [
    ['not_required', 'resume_persisted_tool_batch', null],
    ['granted', 'resume_persisted_tool_batch', null],
    ['pending', 'block', 'approval_pending'],
    ['denied', 'block', 'approval_denied'],
    ['expired', 'block', 'approval_expired'],
    ['unknown', 'block', 'approval_unknown'],
  ];

  it.each(cases)('maps approval %s to %s', (approvalState, kind, reason) => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoveryCheckpointHistory({ boundary: 'after_model', approvalState }),
      }),
    );
    expect(command.kind).toBe(kind);
    if (reason) expect(command).toEqual(expect.objectContaining({ reason }));
  });

  it.each(cases)('maps permission %s independently to %s', (permissionState, kind, reason) => {
    const permissionReason = reason?.replace('approval_', 'permission_');
    const command = planExecutionRecovery(
      recoverySnapshot({
        checkpoints: recoveryCheckpointHistory({
          boundary: 'after_model',
          approvalState: 'granted',
          permissionState,
        }),
      }),
    );
    expect(command.kind).toBe(kind);
    if (permissionReason)
      expect(command).toEqual(expect.objectContaining({ reason: permissionReason }));
  });

  it('requires execution-time authority revalidation even for a previously granted batch', () => {
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          checkpoints: recoveryCheckpointHistory({
            boundary: 'after_model',
            approvalState: 'granted',
          }),
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 'resume_persisted_tool_batch',
        requiresExecutionAuthorityRevalidation: true,
      }),
    );
  });

  it('reports a safe-authority blocked run without pretending it can resume', () => {
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ status: 'blocked' }),
          checkpoints: recoveryCheckpointHistory({ boundary: 'after_model' }),
        }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'run_blocked' }));
  });
});

describe('execution recovery planner control epochs and structure', () => {
  it('blocks local resume from a stale checkpoint and rejects a future epoch as invalid', () => {
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ controlEpoch: 1 }),
          checkpoints: recoveryCheckpointHistory({ controlEpoch: 1 }),
        }),
      ).kind,
    ).toBe('resume_model_step');
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ controlEpoch: 1 }),
          checkpoints: recoveryCheckpointHistory({ controlEpoch: 0 }),
        }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'stale_control_epoch' }));
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ controlEpoch: 1 }),
          checkpoints: recoveryCheckpointHistory({ controlEpoch: 2 }),
        }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'snapshot_invalid' }));
  });

  it('never executes a planned effect from an older control epoch', () => {
    const oldCheckpoint = recoveryCheckpoint({ boundary: 'before_effect', controlEpoch: 0 });
    const currentCheckpoint = recoveryCheckpoint({
      id: 'checkpoint-2',
      sequence: 2,
      controlEpoch: 1,
      boundary: 'before_effect',
      createdAt: 40,
    });
    const command = planExecutionRecovery(
      recoverySnapshot({
        run: recoveryRun({ controlEpoch: 1 }),
        checkpoints: [recoveryInitialCheckpoint(), oldCheckpoint, currentCheckpoint],
        effects: [recoveryEffect('planned')],
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        kind: 'block',
        reason: 'stale_control_epoch',
        effectIds: ['effect-1'],
      }),
    );
  });

  it('never replays an in-flight effect-free call from an older control epoch', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        run: recoveryRun({ controlEpoch: 1 }),
        checkpoints: [
          recoveryInitialCheckpoint(),
          recoveryCheckpoint({ boundary: 'before_effect', controlEpoch: 0 }),
          recoveryCheckpoint({
            id: 'checkpoint-2',
            sequence: 2,
            boundary: 'before_effect',
            controlEpoch: 1,
            createdAt: 40,
          }),
        ],
        effects: [
          recoveryEffect('started', {
            effectClass: 'none',
            idempotencyClass: 'effect_free',
            idempotencyKeyDigest: null,
            retryPolicy: 'replay_safe',
          }),
        ],
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        kind: 'block',
        reason: 'stale_control_epoch',
        effectIds: ['effect-1'],
      }),
    );
  });

  it('still reconciles a durable handle after control invalidation', () => {
    const command = planExecutionRecovery(
      recoverySnapshot({
        run: recoveryRun({ controlEpoch: 1 }),
        checkpoints: recoveryCheckpointHistory({ boundary: 'before_effect', controlEpoch: 0 }),
        effects: [recoveryEffect('started')],
        handles: [recoveryHandle('pending')],
      }),
    );
    expect(command.kind).toBe('reconcile_external_handles');
  });

  it.each([
    recoverySnapshot({ checkpoints: [] }),
    recoverySnapshot({ checkpoints: [recoveryCheckpoint({ runId: 'other-run' })] }),
    recoverySnapshot({ checkpoints: [recoveryCheckpoint({ sequence: 1 })] }),
    recoverySnapshot({ effects: [recoveryEffect('planned', { checkpointId: 'missing' })] }),
    recoverySnapshot({
      effects: [recoveryEffect('planned')],
      handles: [recoveryHandle('pending', { effectId: 'missing' })],
    }),
    recoverySnapshot({
      run: recoveryRun({ controlEpoch: 1 }),
      checkpoints: [
        recoveryInitialCheckpoint(),
        recoveryCheckpoint({ controlEpoch: 1 }),
        recoveryCheckpoint({ id: 'checkpoint-2', sequence: 2, controlEpoch: 0, createdAt: 30 }),
      ],
    }),
    recoverySnapshot({ effects: [recoveryEffect('planned', { createdAt: 19, updatedAt: 19 })] }),
    recoverySnapshot({
      effects: [recoveryEffect('started')],
      handles: [recoveryHandle('pending', { sourceToolNameDigest: 'f'.repeat(64) })],
    }),
    recoverySnapshot({
      effects: [recoveryEffect('planned')],
      handles: [recoveryHandle('pending')],
    }),
    (() => {
      const snapshot = recoverySnapshot();
      return { ...snapshot, run: { ...snapshot.run, permissionState: 'denied' as const } };
    })(),
  ])('fails closed on incomplete or cross-owned snapshots', (snapshot) => {
    const command = planExecutionRecovery(snapshot);
    expect(command.kind).toBe('block');
    expect((command as { reason: string }).reason).toBe(
      snapshot.checkpoints.length === 0 ? 'no_checkpoint' : 'snapshot_invalid',
    );
  });

  it('does not mutate the validated snapshot while planning', () => {
    const history = recoveryCheckpointHistory();
    const snapshot = recoverySnapshot({
      checkpoints: [...history].reverse(),
    });
    const before = JSON.stringify(snapshot);
    planExecutionRecovery(Object.freeze(snapshot));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('execution recovery planner terminal projection', () => {
  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'finalizes an existing %s terminal projection without rerunning work',
    (status) => {
      const command = planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ status, terminalAt: 90 }),
          checkpoints: recoveryCheckpointHistory({ boundary: 'terminal', phase: 'deliver' }),
        }),
      );
      expect(command).toEqual(
        expect.objectContaining({
          kind: 'finalize_existing_terminal_projection',
          terminalStatus: status,
          terminalAt: 90,
        }),
      );
    },
  );

  it('blocks terminal rows with no terminal projection or unresolved work', () => {
    expect(
      planExecutionRecovery(
        recoverySnapshot({ run: recoveryRun({ status: 'failed', terminalAt: 90 }) }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'missing_terminal_projection' }));
    expect(
      planExecutionRecovery(
        recoverySnapshot({
          run: recoveryRun({ status: 'failed', terminalAt: 90 }),
          checkpoints: recoverySettledEffectHistory({ boundary: 'terminal' }),
          effects: [recoveryEffect('ambiguous')],
        }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'block', reason: 'unresolved_terminal_run' }));
  });

  it('keeps the block reason vocabulary closed', () => {
    expect(new Set(EXECUTION_RECOVERY_BLOCK_REASONS).size).toBe(
      EXECUTION_RECOVERY_BLOCK_REASONS.length,
    );
  });
});
