jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockInvalidateVerifiedProcedureObservationsForExecutionRun = jest.fn();
jest.mock('../../src/services/memory/verifiedProcedure/invalidation', () => ({
  invalidateVerifiedProcedureObservationsForExecutionRun: (...args: unknown[]) =>
    mockInvalidateVerifiedProcedureObservationsForExecutionRun(...args),
}));

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  dispatchAuthorizedToolEffect,
  type AuthorizedToolEffectDispatchInput,
} from '../../src/services/executionJournal/toolEffectDispatchLifecycle';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { completedToolOutcome } from '../../src/types/toolRuntimeOutcome';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function notificationInput(
  execute: AuthorizedToolEffectDispatchInput['execute'],
): AuthorizedToolEffectDispatchInput {
  return {
    conversationId: 'conversation-notification-1',
    toolCallId: 'tool-call-notification-1',
    toolName: 'notification_send',
    argumentsText: JSON.stringify({ title: 'Reminder', body: 'Leave now' }),
    context: {
      agentRunId: 'agent-run-notification-1',
      executionRunId: 'execution-run-notification-1',
    },
    approvalState: 'granted',
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    authority: {
      approvalGranted: () => true,
      permissionGranted: () => true,
      controlGranted: () => true,
    },
    execute,
  };
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  mockInvalidateVerifiedProcedureObservationsForExecutionRun.mockReturnValue({
    status: 'invalidated',
    deletedCount: 0,
  });
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('authorized notification effect dispatch', () => {
  it('settles an OS-accepted immediate notification without claiming delivery verification', async () => {
    const rawResult = JSON.stringify({
      status: 'notification_accepted',
      id: 'notification-accepted-1',
      title: 'Reminder',
      body: 'Leave now',
    });
    const execute = jest.fn(async () => completedToolOutcome(rawResult));

    const result = await dispatchAuthorizedToolEffect(notificationInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({
      kind: 'executed',
      status: 'completed',
      result: rawResult,
      disposition: 'returned_unverified',
      requiresReconciliation: false,
      executorThrew: false,
      receipt: {
        transportState: 'returned',
        effectKind: 'notification.send',
        effectState: 'accepted',
        verificationState: 'acknowledged',
        resource: { kind: 'notification', id: 'notification-accepted-1' },
        operationHandle: {
          kind: 'notification_request',
          id: 'notification-accepted-1',
        },
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'returned' });
  });
});
