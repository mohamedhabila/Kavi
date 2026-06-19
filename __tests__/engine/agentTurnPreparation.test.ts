import { prepareAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import type { ToolDefinition } from '../../src/types/tool';

describe('prepareAgentTurn', () => {
  const tools: ToolDefinition[] = [
    {
      name: 'write_file',
      description: 'Write a workspace file.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read a workspace file.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'python',
      description: 'Execute Python in the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
        required: ['code'],
      },
    },
    {
      name: 'tool_catalog',
      description: 'Browse tools by category.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
        required: [],
      },
    },
  ];

  it('keeps graph-owned execution turns on the grounded tool surface', () => {
    const preparedTurn = prepareAgentTurn({
      allowSessionCoordinationTools: false,
      effectiveForceTextThisTurn: false,
      groundedRequestScopedTools: tools,
      promptBundleContext: {
        conversationMemory: null,
        globalMemory: null,
        groundedRequestScopedTools: tools,
        iteration: 1,
        maxToolIterations: 4,
        resolvedPrompt: 'You are a test agent.',
        skillPrompts: '',
      },
      toolingEnabledForProvider: true,
    });

    expect(preparedTurn.selectedTools.map((tool) => tool.name)).toEqual([
      'write_file',
      'read_file',
      'python',
      'tool_catalog',
    ]);
    expect(preparedTurn.enrichedSystemPrompt).toContain('You are a test agent.');
    expect(preparedTurn.enrichedSystemPrompt).not.toContain('Workflow TODO Ledger');
  });

  it('forces text-only turns when graph directives require final text', () => {
    const preparedTurn = prepareAgentTurn({
      allowSessionCoordinationTools: false,
      effectiveForceTextThisTurn: true,
      groundedRequestScopedTools: tools,
      promptBundleContext: {
        conversationMemory: null,
        effectiveForceTextReasonThisTurn: 'request_governance',
        globalMemory: null,
        groundedRequestScopedTools: tools,
        iteration: 2,
        maxToolIterations: 4,
        resolvedPrompt: 'You are a test agent.',
        skillPrompts: '',
      },
      toolingEnabledForProvider: true,
    });

    expect(preparedTurn.selectedTools).toEqual([]);
    expect(preparedTurn.enrichedSystemPrompt).toContain('CLARIFICATION REQUIRED');
  });
});
