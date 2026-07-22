jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
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
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import { needsApprovalWithContext } from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import { completedToolOutcome, failedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedExecuteToolInner = jest.mocked(executeToolInner);
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  mockedExecuteToolInner.mockReset();
  mockedNeedsApproval.mockReset();
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('code execution durable effect dispatch', () => {
  it('settles a compute-only JavaScript invocation without effect reconciliation', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      workspaceMutationState: 'none_observed',
      output: '3981',
    });
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'javascript',
      JSON.stringify({ code: '137 * 29 + 8' }),
      'conversation-javascript-compute',
      {
        toolCallId: 'tool-call-javascript-compute',
        executionRunId: 'execution-run-javascript-compute',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReceipt,
        captureEffectReconciliationRequired,
      },
    );

    expect(result).toMatchObject({ status: 'completed', content: rawResult });
    expect(captureEffectReconciliationRequired).not.toHaveBeenCalled();
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKind: 'compute.execute',
        executionState: 'completed',
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'verified' });
  });

  it('settles a network-blocked Python computation without effect reconciliation', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      workspaceMutationState: 'none_observed',
      networkAccessState: 'blocked',
      networkMutationState: 'none_observed',
      networkRequestCount: 0,
      executionEffectState: 'none_observed',
      output: '3981',
    });
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: '137 * 29 + 8', allowNetwork: false }),
      'conversation-python-compute',
      {
        toolCallId: 'tool-call-python-compute',
        executionRunId: 'execution-run-python-compute',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReceipt,
        captureEffectReconciliationRequired,
      },
    );

    expect(result).toMatchObject({ status: 'completed', content: rawResult });
    expect(captureEffectReconciliationRequired).not.toHaveBeenCalled();
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKind: 'compute.execute',
        executionState: 'completed',
        effectState: 'applied',
        verificationState: 'verified',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'verified' });
  });

  it('keeps a provably effect-free failed Python execution replannable', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'failed',
      isError: true,
      failureKind: 'execution_failed',
      workspaceMutationState: 'unknown',
      networkAccessState: 'enabled',
      networkMutationState: 'none_observed',
      networkRequestCount: 1,
      executionEffectState: 'none_observed',
      error: "AttributeError: 'str' object has no attribute 'status_code'",
    });
    mockedExecuteToolInner.mockResolvedValue(failedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'await get_text()', allowNetwork: true }),
      'conversation-python-failed-read',
      {
        toolCallId: 'tool-call-python-failed-read',
        executionRunId: 'execution-run-python-failed-read',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReceipt,
        captureEffectReconciliationRequired,
      },
    );

    expect(result).toMatchObject({ status: 'failed', content: rawResult });
    expect(captureEffectReconciliationRequired).not.toHaveBeenCalled();
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKind: 'compute.execute',
        executionState: 'failed',
        effectState: 'failed',
        verificationState: 'unverified',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'failed', effect_status: 'failed' });
  });

  it('keeps a failed mutation-capable Python execution closed for reconciliation', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'failed',
      isError: true,
      failureKind: 'execution_failed',
      networkAccessState: 'enabled',
      networkMutationState: 'possible',
      networkRequestCount: 1,
      executionEffectState: 'unknown',
      error: 'RuntimeError: response parsing failed',
    });
    mockedExecuteToolInner.mockResolvedValue(failedToolOutcome(rawResult));
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'await post()', allowNetwork: true }),
      'conversation-python-failed-mutation',
      {
        toolCallId: 'tool-call-python-failed-mutation',
        executionRunId: 'execution-run-python-failed-mutation',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReconciliationRequired,
      },
    );

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      code: 'tool_effect_reconciliation_required',
      retryAllowed: false,
    });
    expect(captureEffectReconciliationRequired).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });
  });
});
