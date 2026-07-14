const mockIsLongTermMemoryEnabled = jest.fn(() => true);
const mockMcpDefinitions = jest.fn(() => [] as any[]);
const mockSkillDefinitions = jest.fn(() => [] as any[]);

jest.mock('../../src/services/memory/policy', () => ({
  isLongTermMemoryEnabled: () => mockIsLongTermMemoryEnabled(),
}));

jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: { getAllToolDefinitions: () => mockMcpDefinitions() },
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillToolDefinitions: () => mockSkillDefinitions(),
}));

jest.mock('../../src/engine/tools/definitions', () => ({
  TOOL_DEFINITIONS: [],
}));

import { resolveMemoryPolicyVisibleToolNames } from '../../src/engine/tools/memoryPolicyCatalogVisibility';

describe('memory-policy catalog visibility', () => {
  beforeEach(() => {
    mockIsLongTermMemoryEnabled.mockReturnValue(true);
    mockMcpDefinitions.mockReturnValue([]);
    mockSkillDefinitions.mockReturnValue([]);
  });

  it('recomputes dynamic catalog visibility from current typed policy', () => {
    mockIsLongTermMemoryEnabled.mockReturnValue(false);
    mockMcpDefinitions.mockReturnValue([
      {
        name: '記憶_حفظ',
        description: 'dynamic memory write',
        input_schema: { type: 'object', properties: {} },
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
          sideEffects: ['remote_mutation'],
        },
      },
      {
        name: 'eliminar_datos',
        description: 'approved erasure',
        input_schema: { type: 'object', properties: {} },
        contract: {
          capabilities: ['delete'],
          resourceKinds: ['memory'],
          sideEffects: ['destructive'],
          riskHints: ['requires_approval'],
        },
      },
      {
        name: '日程_tool',
        description: 'calendar read',
        input_schema: { type: 'object', properties: {} },
        contract: {
          capabilities: ['read'],
          resourceKinds: ['calendar'],
          sideEffects: ['none'],
        },
      },
    ]);

    expect(
      Array.from(
        resolveMemoryPolicyVisibleToolNames(
          new Set(['記憶_حفظ', 'eliminar_datos', '日程_tool']),
        ) ?? [],
      ).sort(),
    ).toEqual(['eliminar_datos', '日程_tool'].sort());
  });
});
