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
});
