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
import { buildMobileControllerDeferredExecution } from '../../src/engine/mobileController/runtimeExecution';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

const CAPABILITY = Object.freeze({
  version: 1,
  controllerId: 'android-controller-1',
  controllerContractVersion: 1,
  capabilityDigest: `sha256:${'b'.repeat(64)}`,
  policyAdmissionDigest: `sha256:${'c'.repeat(64)}`,
  environmentClass: 'sandbox',
  supportedActionKinds: ['set_text'],
  allowedAppIds: [],
  observationEvidence: ['screenshot', 'window_identity'],
  outcomeDeliveryModes: ['deferred'],
  normalizedCoordinateScale: 1_000,
  maxPendingActions: 1,
  maxPayloadBytes: 16_384,
  timeoutMs: 10_000,
});

const OBSERVATION = Object.freeze({
  observationId: 'observation-before-1',
  digest: `sha256:${'d'.repeat(64)}`,
  appId: 'notes',
  windowId: 'note-editor',
});

function input(execute: AuthorizedToolEffectDispatchInput['execute']) {
  return {
    conversationId: 'conversation-mobile-1',
    toolCallId: 'tool-call-mobile-1',
    toolName: 'mobile_ui_action',
    argumentsText: JSON.stringify({ kind: 'set_text', text: 'private draft text' }),
    context: {
      agentRunId: 'agent-run-mobile-1',
      executionRunId: 'execution-run-mobile-1',
    },
    approvalState: 'granted' as const,
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

describe('mobile controller durable dispatch', () => {
  it('parks an action as pending without fabricating a terminal receipt', async () => {
    const execute = jest.fn(async () => {
      const deferred = buildMobileControllerDeferredExecution({
        capability: CAPABILITY,
        action: { kind: 'set_text', text: 'private draft text' },
        beforeObservation: OBSERVATION,
      });
      if (!deferred) throw new Error('test_mobile_deferred_invalid');
      return deferred;
    });

    const result = await dispatchAuthorizedToolEffect(input(execute), { now: () => 100 });

    expect(result).toMatchObject({
      kind: 'deferred',
      handoff: {
        kind: 'persisted',
        handoff: {
          controllerId: 'android-controller-1',
          action: { kind: 'set_text', text: 'private draft text' },
          beforeObservation: { observationId: 'observation-before-1' },
        },
        handoffRef: {
          toolCallId: 'tool-call-mobile-1',
          executionRunId: 'execution-run-mobile-1',
        },
        handle: { status: 'pending' },
        checkpoint: { boundary: 'waiting_external' },
        run: { status: 'waiting' },
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effect_receipts',
      ),
    ).toEqual({ count: 0 });
    expect(
      getExecutionJournalDb().getFirstSync<{ run_status: string; effect_status: string }>(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'waiting', effect_status: 'started' });

    const durableRows = JSON.stringify({
      runs: getExecutionJournalDb().getAllSync('SELECT * FROM execution_runs'),
      checkpoints: getExecutionJournalDb().getAllSync('SELECT * FROM execution_checkpoints'),
      effects: getExecutionJournalDb().getAllSync('SELECT * FROM execution_effects'),
      handles: getExecutionJournalDb().getAllSync('SELECT * FROM execution_external_handles'),
    });
    expect(durableRows).not.toContain('private draft text');
  });
});
