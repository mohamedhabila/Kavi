jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn(),
  requestToolApproval: jest.fn(),
}));
jest.mock('../../src/engine/tools/toolDispatchRouter', () => ({ executeToolInner: jest.fn() }));

import Database from 'better-sqlite3';
import {
  buildModelTurnMemoryPolicyBinding,
  POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { executeTool } from '../../src/engine/tools';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { dispatchAuthorizedToolEffect } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { captureVerifiedProcedureAuthoritySnapshot } from '../../src/services/memory/verifiedProcedure/observationAuthority';
import {
  needsApprovalWithContext,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { completedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedExecuteToolInner = jest.mocked(executeToolInner);
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);
const mockedRequestApproval = jest.mocked(requestToolApproval);

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  expect(mock).toHaveBeenCalled();
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  closeMemoryDb();
  sqliteMock.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  mockedExecuteToolInner.mockReset();
  mockedNeedsApproval.mockReset();
  mockedRequestApproval.mockReset();
  useToolPermissionsStore.getState().reset();
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  try {
    closeExecutionJournalDb();
  } catch {}
  closeMemoryDb();
});

describe('tool effect memory authority', () => {
  it('does not create a durable claim when memory authority expires during approval', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let approve!: (decision: 'approved') => void;
    mockedNeedsApproval.mockReturnValue(true);
    mockedRequestApproval.mockReturnValue(
      new Promise((resolve) => {
        approve = resolve;
      }),
    );
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome('{}'));

    const execution = executeTool(
      'write_file',
      JSON.stringify({ path: 'reports/private.md', content: 'derived' }),
      'conversation-1',
      {
        toolCallId: 'tool-call-expired-memory-authority',
        executionRunId: 'execution-run-expired-memory-authority',
        modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      },
    );
    await waitForCall(mockedRequestApproval as unknown as jest.Mock);
    useSettingsStore.setState({ disableLongTermMemory: true });
    approve('approved');
    const result = await execution;

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      code: 'model_turn_memory_epoch_expired',
      replanRequired: true,
    });
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
  });

  it.each([
    [
      'restrictive memory authority changes in another runtime',
      'restrictive-authority',
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    ],
    [
      'memory is disabled in another runtime',
      'policy-disabled',
      `UPDATE memory_vault_identity
          SET memory_policy_enabled = 0,
              memory_policy_revision = memory_policy_revision + 1
        WHERE singleton = 1`,
    ],
  ])(
    'atomically rejects an effect when %s after the early check',
    async (_label, id, mutationSql) => {
      const memoryFence = captureCurrentModelTurnMemoryFence();
      const executor = jest.fn(async () => completedToolOutcome('{}'));
      const externalMemoryDb = new Database(getMemoryDb().databasePath);
      let controlChecks = 0;

      try {
        const result = await dispatchAuthorizedToolEffect(
          {
            conversationId: 'conversation-atomic-memory-authority',
            toolCallId: `tool-call-${id}`,
            toolName: 'write_file',
            argumentsText: JSON.stringify({
              path: 'reports/private.md',
              content: 'memory-derived action',
            }),
            context: { executionRunId: `execution-run-${id}` },
            approvalState: 'not_required',
            modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
            authority: {
              approvalGranted: () => true,
              permissionGranted: () => true,
              controlGranted: () => {
                controlChecks += 1;
                if (controlChecks === 1) externalMemoryDb.prepare(mutationSql).run();
                return true;
              },
            },
            execute: executor,
          },
          { now: () => 100 },
        );

        expect(result).toMatchObject({ kind: 'blocked', status: 'failed' });
        expect(result.result).toContain('model_authority_changed');
        expect(controlChecks).toBe(1);
        expect(executor).not.toHaveBeenCalled();
        expect(
          getExecutionJournalDb().getFirstSync(
            `SELECT r.status AS run_status, e.status AS effect_status
             FROM execution_runs r
             JOIN execution_effects e ON e.run_id = r.id`,
          ),
        ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
      } finally {
        externalMemoryDb.close();
      }
    },
  );

  it('keeps an admitted effect valid across an additive projection-only update', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const executor = jest.fn(async () => completedToolOutcome('{}'));
    const externalMemoryDb = new Database(getMemoryDb().databasePath);
    let controlChecks = 0;

    try {
      const result = await dispatchAuthorizedToolEffect(
        {
          conversationId: 'conversation-additive-memory-projection',
          toolCallId: 'tool-call-additive-memory-projection',
          toolName: 'write_file',
          argumentsText: JSON.stringify({
            path: 'reports/private.md',
            content: 'already-admitted action',
          }),
          context: { executionRunId: 'execution-run-additive-memory-projection' },
          approvalState: 'not_required',
          modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
          authority: {
            approvalGranted: () => true,
            permissionGranted: () => true,
            controlGranted: () => {
              controlChecks += 1;
              if (controlChecks === 1) {
                externalMemoryDb
                  .prepare(
                    `UPDATE memory_vault_identity
                        SET projection_revision = projection_revision + 1
                      WHERE singleton = 1`,
                  )
                  .run();
              }
              return true;
            },
          },
          execute: executor,
        },
        { now: () => 100 },
      );

      expect(result).toMatchObject({ kind: 'executed', status: 'completed' });
      expect(controlChecks).toBeGreaterThanOrEqual(1);
      expect(executor).toHaveBeenCalledTimes(1);
    } finally {
      externalMemoryDb.close();
    }
  });

  it('atomically rejects an effect when verified procedure evidence changes after the early check', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const procedureAuthority = captureVerifiedProcedureAuthoritySnapshot(
      getMemoryDb(),
      memoryFence.memoryAuthoritySnapshot.restrictiveRevision.memoryOwnerId,
    );
    if (!procedureAuthority) throw new Error('procedure_authority_unavailable');
    const executor = jest.fn(async () => completedToolOutcome('{}'));
    const externalMemoryDb = new Database(getMemoryDb().databasePath);
    let controlChecks = 0;

    try {
      const result = await dispatchAuthorizedToolEffect(
        {
          conversationId: 'conversation-atomic-procedure-authority',
          toolCallId: 'tool-call-atomic-procedure-authority',
          toolName: 'write_file',
          argumentsText: JSON.stringify({
            path: 'reports/private.md',
            content: 'procedure-derived action',
          }),
          context: { executionRunId: 'execution-run-atomic-procedure-authority' },
          approvalState: 'not_required',
          modelTurnMemoryPolicyBinding: buildModelTurnMemoryPolicyBinding({
            ...memoryFence,
            verifiedProcedureAuthoritySnapshot: procedureAuthority,
          }),
          authority: {
            approvalGranted: () => true,
            permissionGranted: () => true,
            controlGranted: () => {
              controlChecks += 1;
              if (controlChecks === 1) {
                externalMemoryDb
                  .prepare(
                    `UPDATE memory_verified_procedure_state
                        SET restrictive_authority_revision = restrictive_authority_revision + 1,
                            projection_revision = projection_revision + 1
                      WHERE memory_owner_id = ?`,
                  )
                  .run(procedureAuthority.restrictiveRevision.memoryOwnerId);
              }
              return true;
            },
          },
          execute: executor,
        },
        { now: () => 100 },
      );

      expect(result).toMatchObject({ kind: 'blocked', status: 'failed' });
      expect(result.result).toContain('model_authority_changed');
      expect(controlChecks).toBe(1);
      expect(executor).not.toHaveBeenCalled();
      expect(
        getExecutionJournalDb().getFirstSync(
          `SELECT r.status AS run_status, e.status AS effect_status
             FROM execution_runs r
             JOIN execution_effects e ON e.run_id = r.id`,
        ),
      ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
    } finally {
      externalMemoryDb.close();
    }
  });

  it('keeps policy-independent effects independent of memory authority changes', async () => {
    const executor = jest.fn(async () => completedToolOutcome('{}'));
    const result = await dispatchAuthorizedToolEffect(
      {
        conversationId: 'conversation-policy-independent-effect',
        toolCallId: 'tool-call-policy-independent-effect',
        toolName: 'write_file',
        argumentsText: JSON.stringify({ path: 'reports/public.md', content: 'direct input' }),
        context: { executionRunId: 'execution-run-policy-independent-effect' },
        approvalState: 'not_required',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        authority: {
          approvalGranted: () => true,
          permissionGranted: () => true,
          controlGranted: () => true,
        },
        execute: executor,
      },
      { now: () => 100 },
    );

    expect(result).toMatchObject({ kind: 'executed' });
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
