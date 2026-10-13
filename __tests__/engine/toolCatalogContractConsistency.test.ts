jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  isLongTermMemoryEnabled: jest.fn(() => true),
}));

import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { TOOL_CATALOG_CATEGORIES } from '../../src/engine/tools/builtin-tool-catalogConfig';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { CRON_TOOL } from '../../src/engine/tools/extended-definitions';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('tool_catalog contract consistency', () => {
  it('lists only registered tools, each found by a search for its own name', async () => {
    const problems: string[] = [];
    for (const [category, config] of Object.entries(TOOL_CATALOG_CATEGORIES)) {
      for (const toolName of config.tools) {
        if (!TOOL_DEFINITIONS.some((tool) => tool.name === toolName)) {
          problems.push(`${category}/${toolName}: not a registered tool`);
          continue;
        }
        const { tools } = parseCompletedToolOutcome(
          await executeToolCatalog({ query: toolName.replace(/_/g, ' ') }),
        ) as { tools: Array<{ name: string }> };
        if (!tools.some((tool) => tool.name === toolName)) {
          problems.push(`${category}/${toolName}: not found by its own name`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('supports unique human-facing scheduled task names without exposing internal IDs', () => {
    const idDescription = CRON_TOOL.input_schema.properties?.id?.description;
    const nameDescription = CRON_TOOL.input_schema.properties?.name?.description;

    expect(CRON_TOOL.description).toContain('selected by ID or exact name');
    expect(CRON_TOOL.description).toContain('uniquely identifies one task');
    expect(CRON_TOOL.description).toContain('Request clarification when no unique match remains');
    expect(idDescription).toContain('exact unique name');
    expect(nameDescription).toContain('exact existing task name selector');
  });
});
