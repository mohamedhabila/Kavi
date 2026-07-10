jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    randomUUID: jest.fn(() => 'unused-random-uuid'),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
  };
});

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  mapExpoWorkflowRunForRecovery,
  mapGitHubWorkflowRunForRecovery,
  type ExecutionExternalHandleInspectors,
} from '../../src/services/executionJournal/externalHandleReconciliation';
import { ExpoGraphqlRequestError } from '../../src/services/expo/providers/expoGraphql';
import { GitHubApiError } from '../../src/services/github/api';
import { registerExecutionExternalHandle } from '../../src/services/executionJournal/mutations';
import { persistExternalToolObservation } from '../../src/services/executionJournal/externalToolObservationStore';
import {
  coordinatePersistedExecutionRecovery,
  readPersistedExternalRecoveryCandidate,
  type ProductionExecutionRecoveryOptions,
} from '../../src/services/executionJournal/productionRecovery';
import {
  DIGEST_A,
  seedPlannedFixtureEffect,
  startFixtureEffect,
} from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

function seedExternalHandle(
  locator:
    | {
        version: 1;
        kind: 'expo_workflow_run';
        projectId: string;
        workflowRunId: string;
        credentialRef: string;
      }
    | {
        version: 1;
        kind: 'github_workflow_run';
        repository: string;
        workflowRunId: string;
        credentialRef: string;
      } = {
    version: 1,
    kind: 'expo_workflow_run',
    projectId: 'project-1',
    workflowRunId: 'workflow-run-1',
    credentialRef: 'CUSTOM_EXPO_TOKEN',
  },
): void {
  seedPlannedFixtureEffect();
  startFixtureEffect();
  registerExecutionExternalHandle({
    id: 'handle-1',
    runId: 'run-1',
    effectId: 'effect-1',
    expectedControlEpoch: 0,
    locator,
    sourceToolNameDigest: DIGEST_A,
    status: 'pending',
    createdAt: 15,
  });
}

function recoveryOptions(
  inspectors: ExecutionExternalHandleInspectors,
  clock: () => number,
): ProductionExecutionRecoveryOptions {
  let sequence = 0;
  return {
    controlStore: {
      clock,
      fenceLeaseMs: 1_000,
      createId: (kind) => `${kind}-${++sequence}`,
    },
    externalHandleReconciliation: { inspectors, retryAfterMs: 60_000 },
  };
}

function inspectors(expoResult: unknown): ExecutionExternalHandleInspectors & {
  readSecret: jest.Mock;
  inspectExpoWorkflowRun: jest.Mock;
  inspectGitHubWorkflowRun: jest.Mock;
} {
  return {
    readSecret: jest.fn(async () => 'resolved-token'),
    inspectExpoWorkflowRun: jest.fn(async () => expoResult as never),
    inspectGitHubWorkflowRun: jest.fn(async () => {
      throw new Error('unexpected GitHub inspection');
    }),
  };
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('closed provider workflow status mapping', () => {
  it.each([
    ['NEW', { kind: 'observed', status: 'pending' }],
    ['IN_PROGRESS', { kind: 'observed', status: 'running' }],
    ['ACTION_REQUIRED', { kind: 'preserved_block', reason: 'remote_action_required' }],
    ['SUCCESS', { kind: 'observed', status: 'succeeded' }],
    ['FAILURE', { kind: 'observed', status: 'failed' }],
    ['CANCELED', { kind: 'observed', status: 'cancelled' }],
    ['COMPLETED', { kind: 'blocked', reason: 'provider_contract_invalid' }],
  ])('maps Expo %s without open-ended success inference', (status, expected) => {
    expect(mapExpoWorkflowRunForRecovery({ id: 'run-1', status }, 'run-1')).toEqual(expected);
  });

  it.each([
    ['queued', null, { kind: 'observed', status: 'pending' }],
    ['in_progress', null, { kind: 'observed', status: 'running' }],
    ['waiting', null, { kind: 'preserved_block', reason: 'remote_action_required' }],
    ['completed', 'success', { kind: 'observed', status: 'succeeded' }],
    ['completed', 'cancelled', { kind: 'observed', status: 'cancelled' }],
    ['completed', 'action_required', { kind: 'preserved_block', reason: 'remote_action_required' }],
    ['completed', 'timed_out', { kind: 'observed', status: 'failed' }],
    ['completed', null, { kind: 'blocked', reason: 'provider_contract_invalid' }],
    ['mystery', null, { kind: 'blocked', reason: 'provider_contract_invalid' }],
  ])('maps GitHub %s/%s through the closed contract', (status, conclusion, expected) => {
    expect(mapGitHubWorkflowRunForRecovery({ id: 42, status, conclusion }, '42')).toEqual(expected);
  });

  it('blocks exact-resource mismatches for both providers', () => {
    expect(mapExpoWorkflowRunForRecovery({ id: 'other', status: 'SUCCESS' }, 'expected')).toEqual({
      kind: 'blocked',
      reason: 'provider_contract_invalid',
    });
    expect(
      mapGitHubWorkflowRunForRecovery(
        { id: 99, status: 'completed', conclusion: 'success' },
        '100',
      ),
    ).toEqual({ kind: 'blocked', reason: 'provider_contract_invalid' });
  });
});

describe('production external handle recovery vertical slice', () => {
  it('persists a terminal observation, settles the effect, and completes with a receipt', async () => {
    seedExternalHandle();
    const provider = inspectors({ id: 'workflow-run-1', status: 'SUCCESS' });

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'completed',
        runId: 'run-1',
        commandKind: 'reconcile_external_handles',
        receiptId: expect.stringMatching(/^receipt-/u),
        receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(provider.readSecret).toHaveBeenCalledWith('CUSTOM_EXPO_TOKEN');
    expect(provider.inspectExpoWorkflowRun).toHaveBeenCalledWith(
      'resolved-token',
      'workflow-run-1',
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, last_attempted_at, last_verified_at
         FROM execution_external_handles WHERE id = 'handle-1'`,
      ),
    ).toEqual({ status: 'succeeded', last_attempted_at: 100, last_verified_at: 100 });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, outcome_digest FROM execution_effects WHERE id = 'effect-1'`,
      ),
    ).toEqual({ status: 'verified', outcome_digest: outcome.receiptDigest });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT state, receipt_id, receipt_digest
         FROM execution_recovery_dispatches`,
      ),
    ).toEqual({
      state: 'completed',
      receipt_id: outcome.receiptId,
      receipt_digest: outcome.receiptDigest,
    });
    expect(() =>
      getExecutionJournalDb().runSync(
        `UPDATE execution_recovery_dispatches
         SET receipt_digest = ? WHERE receipt_id = ?`,
        'f'.repeat(64),
        outcome.receiptId,
      ),
    ).toThrow('execution_recovery_receipt_immutable');
  });

  it.each([
    ['SUCCESS', 'succeeded'],
    ['FAILURE', 'failed'],
    ['CANCELED', 'cancelled'],
  ] as const)(
    'closes a standalone external-operation journal after Expo %s',
    async (providerStatus, runStatus) => {
      const persisted = await persistExternalToolObservation({
        toolName: 'expo_eas_build',
        toolCallId: 'tool-call-build',
        argumentsText: '{"projectId":"project-1"}',
        resultText: '{"mode":"eas-workflow","workflowRun":{"id":"workflow-run-1"}}',
        conversationId: 'conversation-1',
        parentAgentRunId: 'agent-run-1',
        handle: {
          version: 1,
          kind: 'expo_workflow_run',
          sourceToolName: 'expo_eas_build',
          projectId: 'project-1',
          workflowRunId: 'workflow-run-1',
          credentialRef: 'CUSTOM_EXPO_TOKEN',
        },
        observedStatus: 'pending',
        observedAt: 10,
      });
      const provider = inspectors({ id: 'workflow-run-1', status: providerStatus });

      const outcome = await coordinatePersistedExecutionRecovery(
        { runId: persisted.runId },
        recoveryOptions(provider, () => 100),
      );

      expect(outcome.kind).toBe('completed');
      expect(
        getExecutionJournalDb().getFirstSync<{ status: string; terminal_at: number }>(
          'SELECT status, terminal_at FROM execution_runs WHERE id = ?',
          persisted.runId,
        ),
      ).toEqual({ status: runStatus, terminal_at: 100 });
      expect(
        getExecutionJournalDb().getFirstSync<{ boundary: string }>(
          `SELECT boundary FROM execution_checkpoints
           WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
          persisted.runId,
        ),
      ).toEqual({ boundary: 'terminal' });
      await expect(readPersistedExternalRecoveryCandidate(persisted.runId)).resolves.toEqual({
        kind: 'not_candidate',
        runId: persisted.runId,
      });
      if (runStatus === 'cancelled') {
        expect(
          getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
            'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
            persisted.runId,
          ),
        ).toEqual({ cancellation_state: 'cancelled' });
      }
    },
  );

  it('uses the persisted GitHub repository, run ID, and custom credential reference exactly', async () => {
    seedExternalHandle({
      version: 1,
      kind: 'github_workflow_run',
      repository: 'openclaw/mobile',
      workflowRunId: '12345',
      credentialRef: 'PROJECT_GITHUB_TOKEN',
    });
    const provider = inspectors(null);
    provider.inspectGitHubWorkflowRun.mockResolvedValueOnce({
      id: 12345,
      status: 'completed',
      conclusion: 'success',
    });

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome.kind).toBe('completed');
    expect(provider.readSecret).toHaveBeenCalledWith('PROJECT_GITHUB_TOKEN');
    expect(provider.inspectGitHubWorkflowRun).toHaveBeenCalledWith(
      'resolved-token',
      'openclaw/mobile',
      '12345',
    );
    expect(provider.inspectExpoWorkflowRun).not.toHaveBeenCalled();
  });

  it('records same-state pending polls and creates a fresh generation for the next attempt', async () => {
    seedExternalHandle();
    let now = 100;
    const provider = inspectors({ id: 'workflow-run-1', status: 'NEW' });
    const options = recoveryOptions(provider, () => now);

    const first = await coordinatePersistedExecutionRecovery({ runId: 'run-1' }, options);
    const fresh = await readPersistedExternalRecoveryCandidate('run-1');
    now = 200;
    const second = await coordinatePersistedExecutionRecovery({ runId: 'run-1' }, options);

    expect(first).toEqual(
      expect.objectContaining({
        kind: 'pending',
        reason: 'remote_still_pending',
        retryAt: 60_100,
      }),
    );
    expect(fresh).toEqual({
      kind: 'candidate',
      candidate: expect.objectContaining({
        runId: 'run-1',
        generation: expect.objectContaining({
          updatedAt: 100,
          snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        retryAt: 60_100,
      }),
    });
    expect(second).toEqual(
      expect.objectContaining({
        kind: 'pending',
        reason: 'remote_still_pending',
        retryAt: 60_200,
      }),
    );
    expect(provider.inspectExpoWorkflowRun).toHaveBeenCalledTimes(2);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, last_attempted_at, last_verified_at
         FROM execution_external_handles WHERE id = 'handle-1'`,
      ),
    ).toEqual({ status: 'pending', last_attempted_at: 200, last_verified_at: 200 });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_recovery_dispatches',
      )?.count,
    ).toBe(2);
  });

  it('aggregates multiple exact handles atomically without treating partial completion as success', async () => {
    seedExternalHandle();
    registerExecutionExternalHandle({
      id: 'handle-2',
      runId: 'run-1',
      effectId: 'effect-1',
      expectedControlEpoch: 0,
      locator: {
        version: 1,
        kind: 'expo_workflow_run',
        projectId: 'project-1',
        workflowRunId: 'workflow-run-2',
        credentialRef: 'CUSTOM_EXPO_TOKEN',
      },
      sourceToolNameDigest: DIGEST_A,
      status: 'pending',
      createdAt: 16,
    });
    const provider = inspectors(null);
    provider.inspectExpoWorkflowRun.mockImplementation(
      async (_token: string, workflowRunId: string) => ({
        id: workflowRunId,
        status: workflowRunId === 'workflow-run-1' ? 'SUCCESS' : 'IN_PROGRESS',
      }),
    );

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'pending', reason: 'remote_still_pending' }),
    );
    expect(
      getExecutionJournalDb().getAllSync(
        `SELECT id, status, last_attempted_at
         FROM execution_external_handles ORDER BY id`,
      ),
    ).toEqual([
      { id: 'handle-1', status: 'succeeded', last_attempted_at: 100 },
      { id: 'handle-2', status: 'running', last_attempted_at: 100 },
    ]);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status FROM execution_effects WHERE id = 'effect-1'`,
      ),
    ).toEqual({ status: 'applied' });
  });

  it('records transient attempts without falsely claiming provider verification', async () => {
    seedExternalHandle();
    const provider = inspectors(null);
    provider.inspectExpoWorkflowRun.mockRejectedValueOnce(new TypeError('network unavailable'));

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'pending',
        reason: 'provider_temporarily_unavailable',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, last_attempted_at, last_verified_at
         FROM execution_external_handles WHERE id = 'handle-1'`,
      ),
    ).toEqual({ status: 'pending', last_attempted_at: 100, last_verified_at: 15 });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, outcome_digest FROM execution_effects WHERE id = 'effect-1'`,
      ),
    ).toEqual({ status: 'started', outcome_digest: null });
  });

  it('retries typed provider outages but blocks typed authentication failures', async () => {
    seedExternalHandle();
    const transientProvider = inspectors(null);
    transientProvider.inspectExpoWorkflowRun.mockRejectedValueOnce(
      new ExpoGraphqlRequestError('temporarily unavailable', 'http', 503),
    );
    const transient = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(transientProvider, () => 100),
    );
    expect(transient).toEqual(
      expect.objectContaining({
        kind: 'pending',
        reason: 'provider_temporarily_unavailable',
      }),
    );

    closeExecutionJournalDb();
    sqliteMock.__resetExpoSqliteForTests();
    seedExternalHandle({
      version: 1,
      kind: 'github_workflow_run',
      repository: 'openclaw/mobile',
      workflowRunId: '12345',
      credentialRef: 'GITHUB_TOKEN',
    });
    const blockedProvider = inspectors(null);
    blockedProvider.inspectGitHubWorkflowRun.mockRejectedValueOnce(
      new GitHubApiError(401, 'unauthorized'),
    );
    const blocked = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(blockedProvider, () => 100),
    );
    expect(blocked).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        sourceReason: 'inspection_unavailable',
      }),
    );
  });

  it('persists action-required as a closed block while leaving the handle unresolved', async () => {
    seedExternalHandle();
    const provider = inspectors({ id: 'workflow-run-1', status: 'ACTION_REQUIRED' });

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        reason: 'handler_blocked',
        sourceReason: 'remote_action_required',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT status, last_attempted_at, last_verified_at
         FROM execution_external_handles WHERE id = 'handle-1'`,
      ),
    ).toEqual({ status: 'pending', last_attempted_at: 100, last_verified_at: 100 });
    expect(
      getExecutionJournalDb().getFirstSync(
        'SELECT state, outcome_reason FROM execution_recovery_dispatches',
      ),
    ).toEqual({ state: 'blocked', outcome_reason: 'remote_action_required' });
    await expect(readPersistedExternalRecoveryCandidate('run-1')).resolves.toEqual({
      kind: 'not_candidate',
      runId: 'run-1',
    });
  });

  it('blocks a missing credential reference without invoking either provider', async () => {
    seedExternalHandle();
    const provider = inspectors({ id: 'workflow-run-1', status: 'SUCCESS' });
    provider.readSecret.mockRejectedValueOnce(new Error('secret missing'));

    const outcome = await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        sourceReason: 'inspection_unavailable',
      }),
    );
    expect(provider.inspectExpoWorkflowRun).not.toHaveBeenCalled();
    expect(provider.inspectGitHubWorkflowRun).not.toHaveBeenCalled();
  });

  it('never persists resolved secret values or provider payloads in the control plane', async () => {
    seedExternalHandle();
    const provider = inspectors({
      id: 'workflow-run-1',
      status: 'SUCCESS',
      rawSecret: 'must-not-persist',
    });
    await coordinatePersistedExecutionRecovery(
      { runId: 'run-1' },
      recoveryOptions(provider, () => 100),
    );

    const database = getExecutionJournalDb();
    for (const table of [
      'execution_external_handles',
      'execution_recovery_controls',
      'execution_recovery_dispatches',
    ]) {
      expect(JSON.stringify(database.getAllSync(`SELECT * FROM ${table}`))).not.toMatch(
        /resolved-token|must-not-persist/u,
      );
    }
  });
});
