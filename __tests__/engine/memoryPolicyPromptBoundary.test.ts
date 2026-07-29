jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { buildPreparedModelTurnPrompt } from '../../src/engine/graph/modelTurn/buildPreparedPromptTurn';
import { resolveModelTurnGroundedToolSurface } from '../../src/engine/graph/modelTurn/resolveGroundedToolSurface';
import { MEMORY_DISABLED_RUNTIME_CAPABILITY } from '../../src/engine/prompts/memoryPolicyPrompt';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { ToolDefinition } from '../../src/types/tool';

function tool(name: string, contract: NonNullable<ToolDefinition['contract']>): ToolDefinition {
  return {
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
    contract,
  };
}

const memoryWriteTool = tool('記憶_حفظ', {
  category: 'custom',
  capabilities: ['write'],
  resourceKinds: ['memory'],
  sideEffects: ['local_artifact'],
});

const memoryErasureTool = tool('eliminar_datos', {
  category: 'custom',
  capabilities: ['delete'],
  resourceKinds: ['memory'],
  sideEffects: ['destructive'],
  riskHints: ['requires_approval'],
});

const deviceWriteTool = tool('archivo_書込', {
  category: 'custom',
  capabilities: ['write'],
  resourceKinds: ['device'],
  sideEffects: ['local_artifact'],
});

function buildTurn(tools: ToolDefinition[]) {
  return buildPreparedModelTurnPrompt({
    actionablePromptTurn: true,
    allowSessionCoordinationTools: false,
    effectiveForceTextThisTurn: false,
    groundedRequestScopedTools: tools,
    iteration: 1,
    pinnedToolNames: tools.map((entry) => entry.name),
    promptContextSupport: {
      maxToolIterations: 12,
      resolvedPrompt: 'Base assistant prompt.',
      skillPrompts: '',
    },
    toolingEnabledForProvider: true,
    workingMessages: [],
  });
}

describe('memory policy prompt boundary', () => {
  beforeEach(() => {
    closeMemoryDb();
    const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
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

  it('rebuilds a memory-only turn as a truthful text-only turn after opt-out', () => {
    const prepared = buildTurn([memoryWriteTool]);
    expect(prepared.memoryReadFence).toBeDefined();

    useSettingsStore.setState({ disableLongTermMemory: true });
    const disabled = buildTurn([memoryWriteTool]);

    expect(disabled.selectedTools).toEqual([]);
    expect(disabled.toolsForIteration).toEqual([]);
    expect(disabled.pinnedToolNames).toEqual([]);
    expect(disabled.enrichedSystemPrompt).toContain(MEMORY_DISABLED_RUNTIME_CAPABILITY);
    expect(disabled.enrichedSystemPrompt).toContain(
      'Execution mode for this turn: no registered executable tools are available.',
    );
    expect(disabled.enrichedSystemPrompt).not.toContain(
      'With tools, batch independent calls and sequence only dependencies.',
    );
  });

  it('keeps unrelated capabilities and a tool-capable prompt after memory opt-out', () => {
    buildTurn([memoryWriteTool, deviceWriteTool]);

    useSettingsStore.setState({ disableLongTermMemory: true });
    const disabled = buildTurn([memoryWriteTool, deviceWriteTool]);

    expect(disabled.selectedTools.map((entry) => entry.name)).toEqual([deviceWriteTool.name]);
    expect(disabled.toolsForIteration?.map((entry) => entry.name)).toEqual([deviceWriteTool.name]);
    expect(disabled.enrichedSystemPrompt).toContain(MEMORY_DISABLED_RUNTIME_CAPABILITY);
    expect(disabled.enrichedSystemPrompt).toContain(
      'With tools, batch independent calls and sequence only dependencies.',
    );
    expect(disabled.enrichedSystemPrompt).not.toContain(
      'Execution mode for this turn: no registered executable tools are available.',
    );
  });

  it('re-authorizes the resolved tool surface after its async selection boundary', async () => {
    const resolution = resolveModelTurnGroundedToolSurface({
      allTools: [memoryWriteTool, memoryErasureTool, deviceWriteTool],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set(),
      explicitToolSurfaceToolNames: [
        memoryWriteTool.name,
        memoryErasureTool.name,
        deviceWriteTool.name,
      ],
      trackedAsyncOperations: new Map(),
      sessionActivatedToolNames: [
        memoryWriteTool.name,
        memoryErasureTool.name,
        deviceWriteTool.name,
      ],
      workingMessages: [
        {
          id: 'user-1',
          role: 'user',
          content: '続けてください',
          timestamp: 1,
        },
      ],
    });

    useSettingsStore.setState({ disableLongTermMemory: true });
    const resolved = await resolution;

    expect(resolved.groundedRequestScopedTools.map((entry) => entry.name).sort()).toEqual(
      [deviceWriteTool.name, memoryErasureTool.name].sort(),
    );
    expect(resolved.pinnedToolNames).toEqual([]);
    expect(resolved.toolSurfacePinTelemetry.sessionPinnedCount).toBe(2);
  });
});
