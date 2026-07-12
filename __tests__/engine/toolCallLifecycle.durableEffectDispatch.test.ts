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
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { executeTool } from '../../src/engine/tools';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import {
  needsApprovalWithContext,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import { logToolCall } from '../../src/services/security/audit';
import { mcpManager } from '../../src/services/mcp/manager';
import {
  getSkillToolDefinitions,
  registerSkill,
  unregisterSkill,
} from '../../src/services/skills/manager';
import type { ToolDefinition } from '../../src/types/tool';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedExecuteToolInner = jest.mocked(executeToolInner);
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);
const mockedRequestApproval = jest.mocked(requestToolApproval);
const mockedLogToolCall = jest.mocked(logToolCall);

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
    executionRunId: 'execution-run-1',
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

function dynamicLifecycle(definition: ToolDefinition): ToolExecutionLifecycleParams {
  return {
    ...lifecycle(),
    tc: {
      id: `tool-call-${definition.name}`,
      name: definition.name,
      arguments: '{}',
    },
    availableToolNames: new Set([definition.name]),
    groundedRequestScopedTools: [definition],
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
  mockedLogToolCall.mockReset();
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  unregisterSkill('receipt-test');
  jest.restoreAllMocks();
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
        executionRunId: 'execution-run-memory-read',
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

  it('fails closed for an effectful central dispatch without an execution-run identity', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedExecuteToolInner.mockResolvedValue('{}');
    const finalizeEffectReceiptCapture = jest.fn();

    const result = await executeTool(
      'write_file',
      JSON.stringify({ path: 'reports/final.md', content: 'done' }),
      'conversation-1',
      {
        toolCallId: 'tool-call-missing-execution-run',
        finalizeEffectReceiptCapture,
      },
    );

    expect(result).toContain('code-owned execution-run identity is required');
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(mockedRequestApproval).not.toHaveBeenCalled();
    expect(finalizeEffectReceiptCapture).toHaveBeenCalledTimes(1);
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
    mockedExecuteToolInner.mockImplementation(async (_name, _args, _conversationId, context) => {
      expect(context).not.toHaveProperty('captureEffectReceipt');
      expect(context).not.toHaveProperty('finalizeEffectReceiptCapture');
      expect(context).toHaveProperty('executionSignal', undefined);
      expect(context).not.toHaveProperty('toolCallId');
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
      executionRunId: 'execution-run-1',
      dispatchRunId: expect.stringMatching(/^effect-run-/),
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

  it('surfaces an MCP result as reconciliation-required without logging its untrusted payload', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const declaration: ToolDefinition = {
      name: 'mcp__calendar__create_event',
      description: '[Calendar] Create event',
      input_schema: { type: 'object', properties: {} },
    };
    const secretSentinel = 'UNTRUSTED_RESULT_SECRET_DO_NOT_LOG';
    const rawResult = JSON.stringify({
      status: 'completed',
      effectState: 'applied',
      verificationState: 'verified',
      providerSecret: secretSentinel,
    });
    const callTool = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: rawResult }],
      isError: false,
    }));
    const client = { isConnected: () => true, callTool };
    jest.spyOn(mcpManager, 'captureRuntimeToolBinding').mockReturnValue({
      client: client as never,
      declaration,
      provenance: {
        source: 'mcp',
        namespace: 'calendar',
        connectionGeneration: 13,
        toolRegistryGeneration: 21,
        runtimeProcessEpoch: 'process-epoch-a',
        targetIdentity: 'https://calendar.example/mcp',
        transport: 'streamable-http',
      },
      isCurrent: () => true,
    });

    const result = await executeToolCallLifecycle(dynamicLifecycle(declaration));

    expect(JSON.parse(result.toolMessage.content)).toEqual({
      status: 'error',
      code: 'tool_effect_reconciliation_required',
      error:
        'The tool may have changed external state, but the app could not verify the outcome. Do not retry automatically.',
      retryAllowed: false,
      untrustedToolResult: rawResult,
    });
    expect(result.toolMessage.isError).toBe(true);
    expect(result.effectReceipt).toMatchObject({
      effectKind: 'unknown',
      effectState: 'unknown',
      verificationState: 'unverified',
      contractIdentity: { kind: 'runtime_external', source: 'mcp' },
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(mockedLogToolCall).toHaveBeenCalledWith(
      declaration.name,
      '{}',
      'error',
      expect.any(Number),
      'conversation-1',
      'tool_effect_reconciliation_required',
    );
    expect(JSON.stringify(mockedLogToolCall.mock.calls)).not.toContain(secretSentinel);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });
  });

  it('does not execute a captured MCP client that becomes stale after the durable claim', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const declaration: ToolDefinition = {
      name: 'mcp__calendar__create_event',
      description: '[Calendar] Create event',
      input_schema: { type: 'object', properties: {} },
    };
    const callTool = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: '{"status":"completed"}' }],
      isError: false,
    }));
    const isCurrent = jest
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    jest.spyOn(mcpManager, 'captureRuntimeToolBinding').mockReturnValue({
      client: { isConnected: () => true, callTool } as never,
      declaration,
      provenance: {
        source: 'mcp',
        namespace: 'calendar',
        connectionGeneration: 13,
        toolRegistryGeneration: 22,
        runtimeProcessEpoch: 'process-epoch-a',
        targetIdentity: 'https://calendar.example/mcp',
        transport: 'streamable-http',
      },
      isCurrent,
    });

    const result = await executeToolCallLifecycle(dynamicLifecycle(declaration));

    expect(callTool).not.toHaveBeenCalled();
    expect(isCurrent).toHaveBeenCalledTimes(3);
    expect(JSON.parse(result.toolMessage.content)).toMatchObject({
      status: 'error',
      code: 'tool_effect_reconciliation_required',
      retryAllowed: false,
      untrustedToolResult: 'Error: Runtime-external MCP tool binding is stale.',
    });
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'ambiguous', effect_status: 'ambiguous' });
  });

  it('surfaces a skill result as reconciliation-required while keeping it unverified', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      effectState: 'applied',
      verificationState: 'verified',
    });
    const handler = jest.fn(async () => rawResult);
    registerSkill({
      id: 'receipt-test',
      name: 'Receipt test',
      description: 'Receipt test skill',
      version: '1.0.0',
      tools: [
        {
          name: 'mutate',
          description: 'Mutate an external target',
          input_schema: { type: 'object', properties: {} },
          handler,
        },
      ],
    });
    const declaration = getSkillToolDefinitions().find(
      (tool) => tool.name === 'skill__receipt-test__mutate',
    );
    if (!declaration) throw new Error('skill declaration missing');

    const result = await executeToolCallLifecycle(dynamicLifecycle(declaration));

    expect(JSON.parse(result.toolMessage.content)).toMatchObject({
      status: 'error',
      code: 'tool_effect_reconciliation_required',
      retryAllowed: false,
      untrustedToolResult: rawResult,
    });
    expect(result.toolMessage.isError).toBe(true);
    expect(result.effectReceipt).toMatchObject({
      effectKind: 'unknown',
      effectState: 'unknown',
      verificationState: 'unverified',
      contractIdentity: { kind: 'runtime_external', source: 'skill' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
  });

  it('blocks a stale skill declaration before either handler executes', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const firstHandler = jest.fn(async () => 'first');
    registerSkill({
      id: 'receipt-test',
      name: 'Receipt test',
      description: 'Receipt test skill',
      version: '1.0.0',
      tools: [
        {
          name: 'mutate',
          description: 'First declaration',
          input_schema: { type: 'object', properties: {} },
          handler: firstHandler,
        },
      ],
    });
    const staleDeclaration = getSkillToolDefinitions().find(
      (tool) => tool.name === 'skill__receipt-test__mutate',
    );
    if (!staleDeclaration) throw new Error('stale declaration missing');
    const replacementHandler = jest.fn(async () => 'replacement');
    registerSkill({
      id: 'receipt-test',
      name: 'Receipt test',
      description: 'Receipt test skill',
      version: '2.0.0',
      tools: [
        {
          name: 'mutate',
          description: 'Replacement declaration',
          input_schema: { type: 'object', properties: {} },
          handler: replacementHandler,
        },
      ],
    });

    const result = await executeToolCallLifecycle(dynamicLifecycle(staleDeclaration));

    expect(result.toolMessage.isError).toBe(true);
    expect(result.toolMessage.content).toContain('exact runtime binding is unavailable or stale');
    expect(firstHandler).not.toHaveBeenCalled();
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(
      getExecutionJournalDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM execution_runs',
      ),
    ).toEqual({ count: 0 });
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
