jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
jest.mock('../../src/services/memory/verifiedToolEffectExperience', () => ({
  recordVerifiedToolEffectExperience: jest.fn().mockResolvedValue({
    status: 'skipped',
    reason: 'non_terminal_outcome',
  }),
}));
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
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { executeTool } from '../../src/engine/tools';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import {
  needsApprovalWithContext,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedExecuteToolInner = jest.mocked(executeToolInner);
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);
const mockedRequestApproval = jest.mocked(requestToolApproval);

function lifecycle(onToolCallComplete = jest.fn()): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: 'tool-call-write-1',
      name: 'write_file',
      arguments: JSON.stringify({ path: 'reports/final.md', content: 'done' }),
    },
    iteration: 1,
    conversationId: 'conversation-1',
    memoryConversationId: 'memory-conversation-1',
    provider: {
      id: 'provider-1',
      name: 'Provider',
      kind: 'remote',
      baseUrl: 'https://provider.invalid',
      apiKey: 'secret',
      model: 'model-1',
      enabled: true,
    },
    model: 'model-1',
    availableToolNames: new Set(['write_file']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [
      {
        name: 'write_file',
        description: 'Write a workspace file.',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
        contract: { sideEffects: ['local_artifact'], riskHints: ['idempotent'] },
      },
    ],
    trackedAsyncOperations: new Map(),
    callbacks: { onToolCallStart: jest.fn(), onToolCallComplete },
    usePerformanceMetrics: false,
    agentRunId: 'agent-run-1',
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'tool',
      error: 'error',
    },
  };
}

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
  sqliteMock.__resetExpoSqliteForTests();
  mockedExecuteToolInner.mockReset();
  mockedNeedsApproval.mockReset();
  mockedRequestApproval.mockReset();
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('production tool lifecycle durable effect wiring', () => {
  it('bypasses the journal for a code-owned invocation proven effect-free by arguments', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedExecuteToolInner.mockResolvedValue(
      JSON.stringify({ status: 'read', resourceId: 'memory-block-user-profile' }),
    );
    const captureEffectReceipt = jest.fn();
    const finalizeEffectReceiptCapture = jest.fn();

    const result = await executeTool(
      'memory_block',
      JSON.stringify({ action: 'read', label: 'user-profile' }),
      'conversation-1',
      {
        toolCallId: 'tool-call-memory-read',
        captureEffectReceipt,
        finalizeEffectReceiptCapture,
      },
    );

    expect(result).toContain('"status":"read"');
    expect(mockedExecuteToolInner).toHaveBeenCalledTimes(1);
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ effectState: 'none', verificationState: 'not_applicable' }),
    );
    expect(finalizeEffectReceiptCapture).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
  });

  it('waits for approval, durably claims, then dispatches and attaches the exact receipt', async () => {
    let approve!: (decision: 'approved') => void;
    mockedNeedsApproval.mockReturnValue(true);
    mockedRequestApproval.mockReturnValue(
      new Promise((resolve) => {
        approve = resolve;
      }),
    );
    const rawResult = JSON.stringify({
      status: 'written',
      path: 'reports/final.md',
      size: 4,
      sha256: 'a'.repeat(64),
    });
    mockedExecuteToolInner.mockImplementation(async () => {
      expect(
        getExecutionJournalDb().getFirstSync<{ status: string }>(
          'SELECT status FROM execution_effects LIMIT 1',
        ),
      ).toEqual({ status: 'started' });
      return rawResult;
    });
    const onToolCallComplete = jest.fn();

    const pending = executeToolCallLifecycle(lifecycle(onToolCallComplete));
    await waitForCall(mockedRequestApproval as unknown as jest.Mock);
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();

    approve('approved');
    const result = await pending;

    expect(mockedExecuteToolInner).toHaveBeenCalledTimes(1);
    expect(result.toolMessage.content).toBe(rawResult);
    expect(result.effectReceipt).toMatchObject({
      runId: expect.stringMatching(/^effect-run-/),
      toolCallId: 'tool-call-write-1',
      effectKind: 'artifact.write',
      effectState: 'applied',
      verificationState: 'verified',
    });
    expect(onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        effectReceipts: [expect.objectContaining({ receiptId: result.effectReceipt?.receiptId })],
      }),
    );
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'verified' });
  });

  it('does not prepare or dispatch when approval is denied', async () => {
    mockedNeedsApproval.mockReturnValue(true);
    mockedRequestApproval.mockResolvedValue('rejected');
    mockedExecuteToolInner.mockResolvedValue('{}');

    const result = await executeToolCallLifecycle(lifecycle());

    expect(result.toolMessage.isError).toBe(true);
    expect(result.toolMessage.content).toContain('rejected by user approval');
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
  });

  it('does not synthesize a fallback receipt when claim-time permission is revoked', async () => {
    mockedNeedsApproval.mockImplementation(() => {
      useToolPermissionsStore.getState().setPermission('write_file', false);
      return false;
    });
    mockedExecuteToolInner.mockResolvedValue('{}');

    const result = await executeToolCallLifecycle(lifecycle());

    expect(result.toolMessage.isError).toBe(true);
    expect(result.toolMessage.content).toContain('permission_not_granted');
    expect(result.effectReceipt).toBeUndefined();
    expect(result.toolMessage.toolCalls?.[0]?.effectReceipts).toBeUndefined();
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
         FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'cancelled', effect_status: 'cancelled' });
  });
});
