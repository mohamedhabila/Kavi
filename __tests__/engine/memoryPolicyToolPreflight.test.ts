jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resolveToolCallPreflight } from '../../src/engine/toolExecution/toolCallLifecyclePreflight';
import {
  buildModelTurnMemoryPolicyBinding,
  POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
  type ModelTurnMemoryPolicyBinding,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { RuntimeToolCallInput } from '../../src/engine/toolExecution/toolExecutionMessages';
import type { ToolDefinition } from '../../src/types/tool';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const expoSqlite = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

function lifecycleFor(
  tool: ToolDefinition,
  toolCall: RuntimeToolCallInput,
  binding: ModelTurnMemoryPolicyBinding = POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
) {
  return {
    tc: toolCall,
    availableToolNames: new Set([tool.name]),
    groundedRequestScopedTools: [tool],
    modelTurnMemoryPolicyBinding: binding,
    toolCallHistory: [],
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    idPrefixes: {
      blocked: 'blocked',
      filtered: 'filtered',
      workflow: 'workflow',
      cancelled: 'cancelled',
      success: 'success',
      error: 'error',
    },
  } as unknown as ToolExecutionLifecycleParams;
}

function memoryTool(
  name: string,
  capabilities: string[],
  sideEffects: string[],
  riskHints: string[] = [],
): ToolDefinition {
  return {
    name,
    description: name,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    contract: {
      category: 'custom',
      capabilities,
      resourceKinds: ['memory'],
      sideEffects,
      riskHints,
    },
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  closeMemoryDb();
});

describe('memory-policy tool preflight', () => {
  it('rejects a previously advertised dynamic memory tool after opt-out', () => {
    const definition = memoryTool('記憶_حفظ', ['write'], ['remote_mutation']);
    const toolCall = { id: 'call-1', name: definition.name, arguments: '{}' };
    const lifecycle = lifecycleFor(definition, toolCall);
    useSettingsStore.setState({ disableLongTermMemory: true });

    const result = resolveToolCallPreflight(lifecycle, toolCall);

    expect(result).toBeDefined();
    expect(JSON.parse(result?.toolMessage.content ?? '{}')).toEqual(
      expect.objectContaining({ status: 'rejected', ok: false, code: 'memory_disabled' }),
    );
    expect(lifecycle.callbacks.onToolCallStart).toHaveBeenCalledTimes(1);
    expect(lifecycle.callbacks.onToolCallComplete).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit typed erasure under opt-out', () => {
    const definition = memoryTool(
      'eliminar_datos',
      ['delete'],
      ['destructive'],
      ['requires_approval'],
    );
    const toolCall = { id: 'call-2', name: definition.name, arguments: '{}' };
    useSettingsStore.setState({ disableLongTermMemory: true });

    expect(resolveToolCallPreflight(lifecycleFor(definition, toolCall), toolCall)).toBeUndefined();
  });

  it('rejects a tool preflight at exact memory-expiry equality', () => {
    const definition = memoryTool('leer_registro', ['read'], []);
    const toolCall = { id: 'call-expired', name: definition.name, arguments: '{}' };
    const validUntil = Date.now() + 1_000;
    const binding = buildModelTurnMemoryPolicyBinding({
      ...captureCurrentModelTurnMemoryFence(),
      validUntil,
    });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(validUntil);

    try {
      const result = resolveToolCallPreflight(
        lifecycleFor(definition, toolCall, binding),
        toolCall,
      );
      expect(JSON.parse(result?.toolMessage.content ?? '{}')).toMatchObject({
        status: 'rejected',
        code: 'model_turn_memory_epoch_expired',
        replanRequired: true,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
