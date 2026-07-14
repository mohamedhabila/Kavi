import { resolveToolCallPreflight } from '../../src/engine/toolExecution/toolCallLifecyclePreflight';
import type { ToolExecutionLifecycleParams } from '../../src/engine/toolExecution/toolCallLifecycleTypes';
import type { RuntimeToolCallInput } from '../../src/engine/toolExecution/toolExecutionMessages';
import type { ToolDefinition } from '../../src/types/tool';
import { useSettingsStore } from '../../src/store/useSettingsStore';

function lifecycleFor(tool: ToolDefinition, toolCall: RuntimeToolCallInput) {
  return {
    tc: toolCall,
    availableToolNames: new Set([tool.name]),
    groundedRequestScopedTools: [tool],
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
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
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
});
