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
import { completedToolOutcome, failedToolOutcome } from '../../src/types/toolRuntimeOutcome';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';

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
      hasMobileController: false,
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
    modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
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

function effectFreeLifecycle(): ToolExecutionLifecycleParams {
  return {
    ...lifecycle(),
    tc: {
      id: 'tool-call-read-1',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'reports/final.md' }),
    },
    availableToolNames: new Set(['read_file']),
    groundedRequestScopedTools: [
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        contract: { sideEffects: [] },
      },
    ],
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
  it('preserves a typed failure when opaque multilingual content sounds successful', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const content = '完了しました — تم بنجاح — завершено';
    mockedExecuteToolInner.mockResolvedValue(failedToolOutcome(content));

    const result = await executeToolCallLifecycle(effectFreeLifecycle());

    expect(result.toolMessage.content).toBe(content);
    expect(result.toolMessage.isError).toBe(true);
    expect(result.toolMessage.toolCalls?.[0]?.status).toBe('failed');
    expect(result.effectReceipt).toBeUndefined();
  });

  it('preserves a typed success when opaque multilingual content sounds like failure', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const content = 'Error: فشل — Ошибка — エラー';
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome(content));

    const result = await executeToolCallLifecycle(effectFreeLifecycle());

    expect(result.toolMessage.content).toBe(content);
    expect(result.toolMessage.isError).toBeUndefined();
    expect(result.toolMessage.toolCalls?.[0]?.status).toBe('completed');
    expect(result.effectReceipt).toBeUndefined();
  });

  it('records a definitive memory rejection without inventing an ambiguous side effect', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedExecuteToolInner.mockResolvedValue(
      failedToolOutcome(
        JSON.stringify({
          status: 'rejected',
          ok: false,
          code: 'grounding_required',
          error: 'Exact current-user grounding is required.',
        }),
      ),
    );
    const captureEffectReceipt = jest.fn();

    const result = await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: 'user',
        predicate: 'preferred_channel',
        value: 'Signal',
        scope: 'global',
      }),
      'conversation-1',
      {
        toolCallId: 'tool-call-memory-rejected',
        executionRunId: 'execution-run-memory-rejected',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReceipt,
      },
    );

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      ok: false,
      code: 'grounding_required',
    });
    expect(JSON.parse(result.content)).not.toHaveProperty(
      'code',
      'tool_effect_reconciliation_required',
    );
    expect(mockedExecuteToolInner).toHaveBeenCalledWith(
      'memory_remember',
      expect.any(String),
      'conversation-1',
      expect.not.objectContaining({
        executionRunId: expect.anything(),
        toolCallId: expect.anything(),
        authorizedEffectExecutionClaim: expect.anything(),
      }),
      {
        executionRunId: 'execution-run-memory-rejected',
        toolCallId: 'tool-call-memory-rejected',
        claimedAt: expect.any(Number),
      },
    );
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKind: 'memory.write',
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

  it('keeps a scheduled-task precondition rejection repairable without reconciliation', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedExecuteToolInner.mockResolvedValue(
      failedToolOutcome(
        JSON.stringify({
          status: 'rejected',
          code: 'scheduled_job_target_required',
          error: 'A task id or exact task name is required.',
          repair: {
            retryable: true,
            code: 'scheduled_job_target_required',
            missingFields: ['id', 'name'],
            tool: 'cron',
            retryArguments: { action: 'list' },
          },
        }),
      ),
    );
    const captureEffectReceipt = jest.fn();

    const result = await executeTool(
      'cron',
      JSON.stringify({ action: 'disable' }),
      'conversation-1',
      {
        toolCallId: 'tool-call-cron-rejected',
        executionRunId: 'execution-run-cron-rejected',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        captureEffectReceipt,
      },
    );

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      code: 'scheduled_job_target_required',
      repair: { retryable: true, tool: 'cron' },
    });
    expect(JSON.parse(result.content)).not.toHaveProperty(
      'code',
      'tool_effect_reconciliation_required',
    );
    expect(captureEffectReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKind: 'workflow.mutate',
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

  it('fails closed for an effectful central dispatch without an execution-run identity', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome('{}'));
    const finalizeEffectReceiptCapture = jest.fn();

    const result = await executeTool(
      'write_file',
      JSON.stringify({ path: 'reports/final.md', content: 'done' }),
      'conversation-1',
      {
        toolCallId: 'tool-call-missing-execution-run',
        modelTurnMemoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
        finalizeEffectReceiptCapture,
      },
    );

    expect(result.status).toBe('failed');
    expect(result.content).toContain('code-owned execution-run identity is required');
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
      return completedToolOutcome(rawResult);
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

  it('returns an MCP operational result without trusting or logging its payload as evidence', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const declaration: ToolDefinition = {
      name: 'mcp__calendar__create_event',
      description: '[Calendar]\nCreate an event after checking the title and start time.',
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

    expect(result.toolMessage.content).toBe(rawResult);
    expect(result.toolMessage.isError).toBeUndefined();
    expect(result.effectReceipt).toMatchObject({
      effectKind: 'unknown',
      executionState: 'completed',
      effectState: 'unknown',
      verificationState: 'unverified',
      contractIdentity: { kind: 'runtime_external', source: 'mcp' },
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
    expect(mockedLogToolCall).toHaveBeenCalledWith(
      declaration.name,
      '{}',
      'success',
      expect.any(Number),
      'conversation-1',
      undefined,
    );
    expect(JSON.stringify(mockedLogToolCall.mock.calls)).not.toContain(secretSentinel);
    expect(
      getExecutionJournalDb().getFirstSync(
        `SELECT r.status AS run_status, e.status AS effect_status
           FROM execution_runs r JOIN execution_effects e ON e.run_id = r.id`,
      ),
    ).toEqual({ run_status: 'succeeded', effect_status: 'returned' });
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

  it('returns a skill operational result while keeping its semantics unverified', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const rawResult = JSON.stringify({
      status: 'completed',
      effectState: 'applied',
      verificationState: 'verified',
    });
    const handler = jest.fn(async () => completedToolOutcome(rawResult));
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

    expect(result.toolMessage.content).toBe(rawResult);
    expect(result.toolMessage.isError).toBeUndefined();
    expect(result.effectReceipt).toMatchObject({
      effectKind: 'unknown',
      executionState: 'completed',
      effectState: 'unknown',
      verificationState: 'unverified',
      contractIdentity: { kind: 'runtime_external', source: 'skill' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.not.objectContaining({
        executionRunId: expect.anything(),
        toolCallId: expect.anything(),
        authorizedEffectExecutionClaim: expect.anything(),
      }),
    );
    expect(mockedExecuteToolInner).not.toHaveBeenCalled();
  });

  it('blocks a stale skill declaration before either handler executes', async () => {
    mockedNeedsApproval.mockReturnValue(false);
    const firstHandler = jest.fn(async () => completedToolOutcome('first'));
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
    const replacementHandler = jest.fn(async () => completedToolOutcome('replacement'));
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
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome('{}'));

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
    mockedExecuteToolInner.mockResolvedValue(completedToolOutcome('{}'));

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
