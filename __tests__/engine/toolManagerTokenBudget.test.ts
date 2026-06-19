import {
  compactToolDefinitionForPrompt,
  compressToolDefinitions,
  compressToolDescription,
  compressToolDescriptionMinimal,
  enforceToolTokenBudget,
  estimateAllToolTokens,
  estimateToolTokens,
} from '../../src/engine/tools/toolManagerTokenBudget';
import type { ToolDefinition } from '../../src/types/tool';

function makeTool(name: string, description = 'Test tool.'): ToolDefinition {
  return {
    name,
    description,
    input_schema: { type: 'object' as const, properties: {} },
  };
}

describe('toolManagerTokenBudget', () => {
  it('estimates positive token counts for tools', () => {
    const tool = makeTool('read_file', 'Read a file from the workspace.');
    expect(estimateToolTokens(tool)).toBeGreaterThan(0);
    expect(estimateAllToolTokens([tool, tool])).toBeGreaterThan(estimateToolTokens(tool));
  });

  it('keeps pinned and core tools when enforcing a tight budget', () => {
    const tools = [
      makeTool('read_file', 'Core tool.'),
      makeTool('sessions_spawn', 'Core tool.'),
      makeTool('python', 'Large optional tool.'),
      makeTool(
        'mcp__docs__search_docs',
        'Very long MCP tool description that should be removable.',
      ),
      makeTool(
        'skill__weather__forecast',
        'Very long skill tool description that should be removable.',
      ),
      makeTool('extra_tool', 'Very long extra tool description that should be removable.'),
    ];

    const result = enforceToolTokenBudget(
      tools,
      estimateToolTokens(tools[0]) + estimateToolTokens(tools[1]) + 40,
      {
        pinnedToolNames: ['mcp__docs__search_docs'],
      },
    );

    const selectedNames = new Set(result.map((tool) => tool.name));
    expect(selectedNames.has('read_file')).toBe(true);
    expect(selectedNames.has('sessions_spawn')).toBe(true);
    expect(selectedNames.has('python')).toBe(false);
    expect(selectedNames.has('mcp__docs__search_docs')).toBe(true);
  });

  it('compresses long descriptions to the first two sentences for non-core tools', () => {
    const description = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    expect(compressToolDescription(description)).toBe('Sentence one. Sentence two.');
  });

  it('compresses core and non-core tool descriptions during prompt compaction', () => {
    const tools = [
      makeTool('read_file', 'Sentence one. Sentence two. Sentence three.'),
      makeTool('sessions_spawn', 'Sentence one. Sentence two. Sentence three.'),
      makeTool('custom_tool', 'Sentence one. Sentence two. Sentence three.'),
    ];

    const result = compressToolDefinitions(tools);

    expect(result[0].description).toBe('Sentence one. Sentence two.');
    expect(result[1].description).toBe('Sentence one. Sentence two.');
    expect(result[2].description).toBe('Sentence one.');
  });

  it('strips verbose schema prose from prompt-facing tool definitions', () => {
    const tool = makeTool('read_file', 'Read a file. More detail than needed.');
    tool.input_schema = {
      type: 'object',
      description: 'Root description that should not reach the prompt.',
      properties: {
        path: {
          type: 'string',
          description: 'Path description that should be stripped.',
          default: './tmp.txt',
        },
      },
      required: ['path'],
    };

    const result = compactToolDefinitionForPrompt(tool);

    expect(result.input_schema).toEqual({
      type: 'object',
      properties: {
        path: {
          type: 'string',
        },
      },
      required: ['path'],
    });
    expect(result.contract).toBeUndefined();
  });

  it('preserves argument names that match schema metadata keys', () => {
    const tool = makeTool('calendar_create_event', 'Create an event.');
    tool.input_schema = {
      type: 'object',
      title: 'Root schema title stripped from prompt.',
      properties: {
        title: {
          type: 'string',
          description: 'Event title prose stripped.',
        },
        default: {
          type: 'string',
          description: 'Default calendar prose stripped.',
        },
        nested: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Nested title prose stripped.',
            },
          },
          required: ['title'],
        },
      },
      required: ['title', 'default'],
    };

    const result = compactToolDefinitionForPrompt(tool);

    expect(result.input_schema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        default: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            title: { type: 'string' },
          },
          required: ['title'],
        },
      },
      required: ['title', 'default'],
    });
  });

  it('uses minimal descriptions for non-pinned optional tools', () => {
    const tool = makeTool('mcp__docs__search_docs', 'Sentence one. Sentence two. Sentence three.');
    const result = compactToolDefinitionForPrompt(tool, {
      pinnedToolNames: new Set(['read_file']),
    });
    expect(result.description).toBe('Sentence one.');
    expect(compressToolDescriptionMinimal(tool.description)).toBe('Sentence one.');
  });

  it('keeps richer descriptions for pinned goal-capability tools', () => {
    const tool = makeTool('web_search', 'Sentence one. Sentence two. Sentence three.');
    const result = compactToolDefinitionForPrompt(tool, {
      pinnedToolNames: new Set(['web_search']),
    });
    expect(result.description).toBe('Sentence one. Sentence two.');
  });
});
