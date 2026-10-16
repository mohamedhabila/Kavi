import {
  selectUpfrontIntegrationToolNames,
  UPFRONT_INTEGRATION_TOOL_CONTEXT_SHARE,
} from '../../src/engine/tools/integrationToolSurface';
import { getWorkingContextWindow } from '../../src/services/context/tokenCounter';
import type { ToolDefinition } from '../../src/types/tool';

function tool(name: string, description = 'A tool.'): ToolDefinition {
  return { name, description, input_schema: { type: 'object', properties: {} } };
}

describe('connected integration tools declared up front', () => {
  it("declares every connected integration's tools in a stable order", () => {
    expect(
      selectUpfrontIntegrationToolNames(
        [
          tool('mcp__notes__notes_list'),
          tool('read_file'),
          tool('mcp__mail__mail_search'),
          tool('skill__media__generate_qr'),
        ],
        'claude-sonnet-5-5',
      ),
    ).toEqual(['mcp__mail__mail_search', 'mcp__notes__notes_list']);
  });

  it('declares none when there is no integration', () => {
    expect(selectUpfrontIntegrationToolNames([tool('read_file')], 'claude-sonnet-5-5')).toEqual([]);
  });

  it('keeps them all in the capability index once they exceed a tenth of the working window', () => {
    // Descriptions are measured as the prompt sends them, cut to a few hundred characters, so
    // past the share means many tools: each well over fifty tokens against 10% of the window.
    const share =
      getWorkingContextWindow('claude-sonnet-5-5') * UPFRONT_INTEGRATION_TOOL_CONTEXT_SHARE;
    const tools = Array.from({ length: Math.ceil(share / 50) }, (_, index) =>
      tool(`mcp__big__tool_${index}`, `Item ${index}: ${'details '.repeat(40)}`),
    );

    expect(selectUpfrontIntegrationToolNames(tools, 'claude-sonnet-5-5')).toEqual([]);
    expect(selectUpfrontIntegrationToolNames(tools.slice(0, 10), 'claude-sonnet-5-5')).toHaveLength(
      10,
    );
  });

  it('measures an on-device model against its own small window', () => {
    const tools = Array.from({ length: 40 }, (_, index) =>
      tool(`mcp__apps__tool_${index}`, 'List the items of one of the person’s apps, newest first.'),
    );

    expect(selectUpfrontIntegrationToolNames(tools, 'claude-sonnet-5-5')).toHaveLength(40);
    expect(
      selectUpfrontIntegrationToolNames(tools, 'gemma-4-e2b', { onDeviceProvider: true }),
    ).toEqual([]);
  });
});
