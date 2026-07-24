jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/memory/verifiedProcedure/invalidation', () => ({
  invalidateVerifiedProcedureObservationsForExecutionRun: jest.fn(() => ({
    status: 'invalidated',
    deletedCount: 0,
  })),
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

function sessionSpawnInput(
  execute: AuthorizedToolEffectDispatchInput['execute'],
): AuthorizedToolEffectDispatchInput {
  return {
    conversationId: 'conversation-session-spawn-1',
    toolCallId: 'tool-call-session-spawn-1',
    toolName: 'sessions_spawn',
    argumentsText: JSON.stringify({
      prompt: 'Return exactly: DELEGATION PASS',
      waitForCompletion: true,
    }),
    context: {
      agentRunId: 'agent-run-session-spawn-1',
      executionRunId: 'execution-run-session-spawn-1',
    },
    approvalState: 'not_required',
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
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('code-owned operational effect dispatch', () => {
  it('settles a returned operation without claiming goal completion', async () => {
    const rawResult = JSON.stringify({
      status: 'completed',
      sessionId: 'sub-agent-1',
      completionState: 'verified_success',
      output: 'DELEGATION PASS',
    });
    const execute = jest.fn(async () => completedToolOutcome(rawResult));

    const result = await dispatchAuthorizedToolEffect(sessionSpawnInput(execute), {
      now: () => 100,
    });

    expect(result).toMatchObject({
      kind: 'executed',
      status: 'completed',
      result: rawResult,
      disposition: 'returned_unverified',
      requiresReconciliation: false,
      receipt: {
        transportState: 'returned',
        effectKind: 'workflow.start',
        effectState: 'unknown',
        verificationState: 'unverified',
        contractIdentity: {
          kind: 'code_owned',
          toolName: 'sessions_spawn',
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
