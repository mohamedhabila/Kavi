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
  it('keeps selected tools in deterministic provider order as a cacheable prefix', () => {
    expect(
      reorderToolsForPromptCaching([
        tool('browser_click'),
        tool('tool_catalog'),
        tool('memory_recall'),
        tool('read_file'),
      ]).map((entry) => entry.name),
    ).toEqual(['browser_click', 'memory_recall', 'read_file', 'tool_catalog']);
  });

  it('keeps mobile-native tools in deterministic provider order to avoid rotating prefixes', () => {
    expect(
      reorderToolsForPromptCaching([
        tool('browser_navigate'),
        tool('sms_compose'),
        tool('memory_recall'),
        tool('calendar_list'),
      ]).map((entry) => entry.name),
    ).toEqual(['browser_navigate', 'calendar_list', 'memory_recall', 'sms_compose']);
  });

  it('treats selected core, MCP, skill, and mobile tools as one stable declaration prefix', () => {
    const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder([
      tool('mcp__device__calendar_list'),
      tool('calendar_list'),
      tool('tool_catalog'),
      tool('skill__local__sms_compose'),
      tool('sms_compose'),
    ]);

    expect(orderedTools.map((entry) => entry.name)).toEqual([
      'calendar_list',
      'mcp__device__calendar_list',
      'skill__local__sms_compose',
      'sms_compose',
      'tool_catalog',
    ]);
    expect(lastStablePrefixIndex).toBe(4);
  });

  it('keeps graph-marked dynamic tools after the reusable stable prefix', () => {
    const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder([
      { ...tool('sms_compose'), promptCache: { placement: 'dynamic_suffix' } },
      { ...tool('tool_catalog'), promptCache: { placement: 'stable_prefix' } },
      { ...tool('memory_recall'), promptCache: { placement: 'stable_prefix' } },
      { ...tool('calendar_list'), promptCache: { placement: 'dynamic_suffix' } },
    ]);

    expect(orderedTools.map((entry) => entry.name)).toEqual([
      'memory_recall',
      'tool_catalog',
      'calendar_list',
      'sms_compose',
    ]);
    expect(lastStablePrefixIndex).toBe(1);
  });

  it('does not mutate the caller-owned tool array while ordering for providers', () => {
    const tools = [tool('write_file'), tool('read_file')];

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
