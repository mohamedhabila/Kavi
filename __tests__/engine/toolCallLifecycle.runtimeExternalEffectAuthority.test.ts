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
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import { mcpManager } from '../../src/services/mcp/manager';
import { needsApprovalWithContext } from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import type { ToolDefinition } from '../../src/types/tool';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};
const mockedNeedsApproval = jest.mocked(needsApprovalWithContext);

function runtimeLifecycle(declaration: ToolDefinition): ToolExecutionLifecycleParams {
  return {
    tc: {
      id: `tool-call-${declaration.name}`,
      name: declaration.name,
      arguments: '{}',
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
    availableToolNames: new Set([declaration.name]),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    },
    toolCallHistory: [],
    groundedRequestScopedTools: [declaration],
    trackedAsyncOperations: new Map(),
    callbacks: { onToolCallStart: jest.fn(), onToolCallComplete: jest.fn() },
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

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  mockedNeedsApproval.mockReset();
  mockedNeedsApproval.mockReturnValue(false);
  useToolPermissionsStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('runtime-external effect authority', () => {
  it('returns a trusted read-only MCP error for model recovery without an ambiguous effect', async () => {
    const declaration: ToolDefinition = {
      name: 'mcp__orders__get_order',
      description: '[Orders] Get one order',
      input_schema: { type: 'object', properties: {} },
      contract: { sideEffects: ['none'] },
    };
    const callTool = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Order not found' }],
      isError: true,
    }));
    jest.spyOn(mcpManager, 'captureRuntimeToolBinding').mockReturnValue({
      client: { isConnected: () => true, callTool } as never,
      declaration,
      provenance: {
        source: 'mcp',
        namespace: 'orders',
        connectionGeneration: 13,
        toolRegistryGeneration: 23,
        runtimeProcessEpoch: 'process-epoch-a',
        targetIdentity: 'https://orders.example/mcp',
        transport: 'streamable-http',
        toolAnnotationsTrusted: true,
      },
      isCurrent: () => true,
    });

    const result = await executeToolCallLifecycle(runtimeLifecycle(declaration));

    expect(result.toolMessage).toMatchObject({ content: 'Error: Order not found', isError: true });
    expect(result.effectReceipt).toMatchObject({
      effectKind: 'unknown',
      effectState: 'none',
      verificationState: 'not_applicable',
      contractIdentity: { kind: 'runtime_external', source: 'mcp', effectClass: 'none' },
    });
    expect(result.effectReconciliationRequired).toBeUndefined();
    expect(result.effectDispatchObservation).toEqual({ kind: 'not_applicable' });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(
      getExecutionJournalDb().getFirstSync('SELECT COUNT(*) AS count FROM execution_runs'),
    ).toEqual({ count: 0 });
  });

  it('keeps an untrusted MCP error behind reconciliation regardless of its name', async () => {
    const declaration: ToolDefinition = {
      name: 'mcp__orders__get_order',
      description: '[Orders] Get one order',
      input_schema: { type: 'object', properties: {} },
    };
    const callTool = jest.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Order not found' }],
      isError: true,
    }));
    jest.spyOn(mcpManager, 'captureRuntimeToolBinding').mockReturnValue({
      client: { isConnected: () => true, callTool } as never,
      declaration,
      provenance: {
        source: 'mcp',
        namespace: 'orders',
        connectionGeneration: 13,
        toolRegistryGeneration: 24,
        runtimeProcessEpoch: 'process-epoch-a',
        targetIdentity: 'https://orders.example/mcp',
        transport: 'streamable-http',
      },
      isCurrent: () => true,
    });

    const result = await executeToolCallLifecycle(runtimeLifecycle(declaration));

    expect(JSON.parse(result.toolMessage.content)).toMatchObject({
      code: 'tool_effect_reconciliation_required',
      retryAllowed: false,
      untrustedToolResult: 'Error: Order not found',
    });
    expect(result.effectReconciliationRequired).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
