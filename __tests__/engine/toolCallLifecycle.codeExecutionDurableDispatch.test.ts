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

  it('keeps an effect-free failed JavaScript invocation replannable', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'failed',
      isError: true,
      failureKind: 'execution_failed',
      workspaceMutationState: 'none_observed',
      error: 'undefined is not a function',
    });
    mockedExecuteToolInner.mockResolvedValue(failedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'javascript',
      JSON.stringify({ code: 'fs.unsupported()' }),
      'conversation-javascript-failed-read',
      {
        toolCallId: 'tool-call-javascript-failed-read',
        executionRunId: 'execution-run-javascript-failed-read',
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

  it('continues after acknowledged local Python persistence so the artifact can be inspected', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      workspaceMutationState: 'applied',
      networkAccessState: 'blocked',
      networkMutationState: 'none_observed',
      networkRequestCount: 0,
      executionEffectState: 'unknown',
      fileCount: 1,
      files: [{ path: 'report.md', size: 128 }],
      output: 'wrote report.md',
    });
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'write_report()', allowNetwork: false }),
      'conversation-python-local-write',
      {
        toolCallId: 'tool-call-python-local-write',
        executionRunId: 'execution-run-python-local-write',
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
        verificationState: 'acknowledged',
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'returned' });
  });

  it('does not settle a completed Python run with a possible network mutation', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      workspaceMutationState: 'applied',
      networkAccessState: 'used',
      networkMutationState: 'possible',
      networkRequestCount: 1,
      executionEffectState: 'unknown',
      files: [{ path: 'report.md', size: 128 }],
      output: 'remote response unavailable',
    });
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome(rawResult));
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'await post_and_write()', allowNetwork: true }),
      'conversation-python-possible-network-write',
      {
        toolCallId: 'tool-call-python-possible-network-write',
        executionRunId: 'execution-run-python-possible-network-write',
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

  it('keeps a network-blocked Python timeout replannable', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'timed_out',
      isError: true,
      failureKind: 'timed_out',
      workspaceMutationState: 'none_observed',
      networkAccessState: 'blocked',
      networkMutationState: 'none_observed',
      networkRequestCount: 0,
      executionEffectState: 'none_observed',
      error: 'Python runtime startup timed out.',
    });
    mockedExecuteToolInner.mockResolvedValue(failedToolOutcome(rawResult));
    const captureEffectReceipt = jest.fn();
    const captureEffectReconciliationRequired = jest.fn();

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'print(42)', allowNetwork: false }),
      'conversation-python-timeout',
      {
        toolCallId: 'tool-call-python-timeout',
        executionRunId: 'execution-run-python-timeout',
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
        executionState: 'timed_out',
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
