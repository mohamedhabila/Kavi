jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
jest.mock('../../src/services/executionJournal/externalToolDurabilityLifecycle', () => {
  const actual = jest.requireActual(
    '../../src/services/executionJournal/externalToolDurabilityLifecycle',
  );
  return {
    ...actual,
    observeExternalToolResultDurability: jest.fn().mockResolvedValue({ kind: 'not_external' }),
  };
});
jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn(),
  ONE_SHOT_APPROVAL_DECISION_POLICY: {
    persistentApproval: 'forbidden',
    expiryFallback: 'reject',
  },
  requestToolApproval: jest.fn(),
}));
jest.mock('../../src/engine/tools/toolDispatchRouter', () => ({ executeToolInner: jest.fn() }));

import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import { executeTool } from '../../src/engine/tools';
import {
  needsApprovalWithContext,
  ONE_SHOT_APPROVAL_DECISION_POLICY,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createMobileControllerCapabilityFixture } from '../helpers/mobileControllerHandoffFixture';
import { isTerminalToolEffectDispatchObservation } from '../../src/services/executionJournal/toolEffectDispatchLifecycle';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);
const mockedRequestApproval = jest.mocked(requestToolApproval);

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  mockedNeedsApproval.mockReset();
  mockedRequestApproval.mockReset();
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('mobile controller pre-claim validation', () => {
  it('rejects an invalid mobile action before claiming external effect authority', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const captureEffectReceipt = jest.fn();
    const finalizeEffectReceiptCapture = jest.fn();

    const result = await executeTool(
      'mobile_ui_action',
      JSON.stringify({
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: 'observation-before-1',
          x: 90,
          y: 1_850,
        },
      }),
      'conversation-1',
      {
        toolCallId: 'tool-call-mobile-invalid',
        executionRunId: 'execution-run-mobile-invalid',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        mobileController: {
          capability: createMobileControllerCapabilityFixture({
            supportedActionKinds: ['activate'],
          }),
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'d'.repeat(64)}`,
          },
        },
        captureEffectReceipt,
        finalizeEffectReceiptCapture,
      },
    );

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      code: 'action_invalid',
      retryable: true,
      repair: {
        currentObservationId: 'observation-before-1',
        normalizedCoordinateRange: { minimum: 0, maximum: 999 },
      },
    });
    expect(result.effectDispatchObservation).toEqual({
      kind: 'not_claimed',
      reason: 'tool_arguments_invalid',
    });
    expect(isTerminalToolEffectDispatchObservation(result.effectDispatchObservation)).toBe(false);
    expect(captureEffectReceipt).not.toHaveBeenCalled();
    expect(finalizeEffectReceiptCapture).toHaveBeenCalledTimes(1);
    expect(mockedRequestApproval).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effects',
      ),
    ).toEqual({ count: 0 });
  });

  it('requires focused one-shot confirmation before claiming a reviewed action', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    let resolveApproval: ((decision: 'approved') => void) | undefined;
    mockedRequestApproval.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve as (decision: 'approved') => void;
        }),
    );
    const reviewAction = jest.fn().mockReturnValue({
      kind: 'confirm',
      title: 'Confirm message send',
      description: 'Send the prepared message to the selected recipient.',
    });

    const execution = executeTool(
      'mobile_ui_action',
      JSON.stringify({
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: 'observation-before-1',
          x: 90,
          y: 850,
        },
      }),
      'conversation-1',
      {
        toolCallId: 'tool-call-mobile-confirm',
        executionRunId: 'execution-run-mobile-confirm',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        mobileController: {
          capability: createMobileControllerCapabilityFixture({
            environmentClass: 'managed',
            supportedActionKinds: ['activate'],
          }),
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'d'.repeat(64)}`,
          },
          reviewAction,
        },
      },
    );
    for (let index = 0; index < 10 && mockedRequestApproval.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(mockedRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mobile_ui_action',
        reviewPresentation: {
          title: 'Confirm message send',
          description: 'Send the prepared message to the selected recipient.',
        },
        decisionPolicy: ONE_SHOT_APPROVAL_DECISION_POLICY,
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effects',
      ),
    ).toEqual({ count: 0 });

    resolveApproval?.('approved');
    const result = await execution;

    expect(result.status).toBe('deferred');
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effects',
      ),
    ).toEqual({ count: 1 });
  });

  it('does not request approval or claim an action that requires takeover', async () => {
    mockedNeedsApproval.mockReturnValue(false);

    const result = await executeTool(
      'mobile_ui_action',
      JSON.stringify({
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: 'observation-before-1',
          x: 90,
          y: 850,
        },
      }),
      'conversation-1',
      {
        toolCallId: 'tool-call-mobile-takeover',
        executionRunId: 'execution-run-mobile-takeover',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        mobileController: {
          capability: createMobileControllerCapabilityFixture({
            environmentClass: 'policy_approved',
            supportedActionKinds: ['activate'],
          }),
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'e'.repeat(64)}`,
          },
          reviewAction: jest.fn().mockReturnValue({
            kind: 'takeover',
            title: 'Review account deletion',
            description: 'Review and complete the account deletion directly.',
          }),
        },
      },
    );

    expect(result.status).toBe('failed');
    expect(result.effectDispatchObservation).toEqual({
      kind: 'not_claimed',
      reason: 'user_takeover_required',
    });
    expect(mockedRequestApproval).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effects',
      ),
    ).toEqual({ count: 0 });
  });

  it('does not claim a reviewed action when focused confirmation is rejected', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedRequestApproval.mockResolvedValue('rejected');

    const result = await executeTool(
      'mobile_ui_action',
      JSON.stringify({
        kind: 'activate',
        target: {
          kind: 'coordinate',
          observationId: 'observation-before-1',
          x: 90,
          y: 850,
        },
      }),
      'conversation-1',
      {
        toolCallId: 'tool-call-mobile-rejected',
        executionRunId: 'execution-run-mobile-rejected',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        mobileController: {
          capability: createMobileControllerCapabilityFixture({
            environmentClass: 'managed',
            supportedActionKinds: ['activate'],
          }),
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'f'.repeat(64)}`,
          },
          reviewAction: jest.fn().mockReturnValue({
            kind: 'confirm',
            title: 'Confirm message send',
            description: 'Send the prepared message to the selected recipient.',
          }),
        },
      },
    );

    expect(result.status).toBe('failed');
    expect(result.effectDispatchObservation).toEqual({
      kind: 'not_claimed',
      reason: 'user_approval_denied',
    });
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_effects',
      ),
    ).toEqual({ count: 0 });
  });
});
