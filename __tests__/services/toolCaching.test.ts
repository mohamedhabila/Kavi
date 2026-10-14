import {
  buildPromptCachingToolOrder,
  buildToolDeclarationDigest,
  reorderToolsForPromptCaching,
} from '../../src/services/llm/core/toolCaching';
import type { ToolDefinition } from '../../src/types/tool';

function tool(name: string, description = `${name} tool`): ToolDefinition {
  return {
    name,
    description,
    input_schema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    },
  };
}

describe('toolCaching', () => {
  // The turn surface lists tools in the order the conversation first brought them in, so
  // ordering keeps that order: a newly added tool lands at the end instead of shifting every
  // declaration after it (name order put an activated tool in the middle of the block).
  it('keeps tools in the order given, so an added tool lands at the end', () => {
    const before = reorderToolsForPromptCaching([
      tool('read_file'),
      tool('tool_catalog'),
      tool('calendar_create_event'),
    ]).map((entry) => entry.name);
    const after = reorderToolsForPromptCaching([
      tool('read_file'),
      tool('tool_catalog'),
      tool('calendar_create_event'),
      tool('browser_click'),
    ]).map((entry) => entry.name);

    expect(before).toEqual(['read_file', 'tool_catalog', 'calendar_create_event']);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('browser_click');
  });

  it('treats tools without a placement as one stable declaration prefix', () => {
    const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder([
      tool('mcp__device__calendar_list'),
      tool('calendar_list'),
      tool('tool_catalog'),
    ]);

    expect(orderedTools.map((entry) => entry.name)).toEqual([
      'mcp__device__calendar_list',
      'calendar_list',
      'tool_catalog',
    ]);
    expect(lastStablePrefixIndex).toBe(2);
  });

  it('keeps dynamic-suffix tools after the stable prefix, each group in the order given', () => {
    const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder([
      { ...tool('sms_compose'), promptCache: { placement: 'dynamic_suffix' } },
      { ...tool('tool_catalog'), promptCache: { placement: 'stable_prefix' } },
      { ...tool('memory_recall'), promptCache: { placement: 'stable_prefix' } },
      { ...tool('calendar_list'), promptCache: { placement: 'dynamic_suffix' } },
    ]);

    expect(orderedTools.map((entry) => entry.name)).toEqual([
      'tool_catalog',
      'memory_recall',
      'sms_compose',
      'calendar_list',
    ]);
    expect(lastStablePrefixIndex).toBe(1);
  });

  it('does not mutate the caller-owned tool array while ordering for providers', () => {
    const tools = [
      { ...tool('write_file'), promptCache: { placement: 'dynamic_suffix' as const } },
      { ...tool('read_file'), promptCache: { placement: 'stable_prefix' as const } },
    ];

    const orderedTools = reorderToolsForPromptCaching(tools);

    expect(tools.map((entry) => entry.name)).toEqual(['write_file', 'read_file']);
    expect(orderedTools.map((entry) => entry.name)).toEqual(['read_file', 'write_file']);
  });

  it('builds a stable structural digest for tool declarations', () => {
    const tools = [tool('read_file'), tool('write_file')];
    const first = buildToolDeclarationDigest(tools);
    const second = buildToolDeclarationDigest([
      {
        ...tool('read_file'),
        input_schema: {
          properties: {
            value: { type: 'string' },
          },
          type: 'object',
        },
      },
      tool('write_file'),
    ]);
    const changed = buildToolDeclarationDigest([
      tool('read_file', 'Read a file with changed contract text'),
      tool('write_file'),
    ]);

    expect(first).toMatch(/^tools-fnv1a32:[0-9a-f]{8}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
