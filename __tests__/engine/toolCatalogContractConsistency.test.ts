jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  isLongTermMemoryEnabled: jest.fn(() => true),
}));

import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { TOOL_CATALOG_TOOL } from '../../src/engine/tools/builtin-definitions-coordination';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { CRON_TOOL } from '../../src/engine/tools/extended-definitions';
import { buildCapabilitySummary } from '../../src/engine/tools/builtin-tool-catalogCapabilitySummary';
import { TOOL_CATALOG_CATEGORIES } from '../../src/engine/tools/builtin-tool-catalogConfig';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('tool_catalog contract consistency', () => {
  it('constrains category arguments to the code-owned catalog taxonomy', () => {
    expect(TOOL_CATALOG_TOOL.input_schema.properties?.category?.enum).toEqual(
      expect.arrayContaining(Object.keys(TOOL_CATALOG_CATEGORIES)),
    );
  });

  it('distinguishes autonomous scheduling from calendar events and notification alerts', () => {
    const catalogDescription = TOOL_CATALOG_TOOL.description;
    const categoryDescription = TOOL_CATALOG_TOOL.input_schema.properties?.category?.description;

    expect(catalogDescription).toContain('Prefer query');
    expect(categoryDescription).toContain('Automation');
    expect(categoryDescription).toContain('calendar is only for device calendar events');
    expect(categoryDescription).toContain('notifications is only for user alerts');
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

  it('returns capability summaries that match registry contracts for static categories', async () => {
    const mismatches: string[] = [];

    for (const [category, config] of Object.entries(TOOL_CATALOG_CATEGORIES)) {
      if (category === 'github') {
        continue;
      }

      const result = await executeToolCatalog({ category });
      const parsed = parseCompletedToolOutcome(result) as {
        tools: Array<{
          name: string;
          capabilitySummary: ReturnType<typeof buildCapabilitySummary>;
        }>;
      };

      for (const listedTool of parsed.tools) {
        const registryTool = TOOL_DEFINITIONS.find((tool) => tool.name === listedTool.name);
        if (!registryTool?.contract?.capabilities?.length) {
          mismatches.push(`${listedTool.name}: missing registry contract`);
          continue;
        }

        const expected = buildCapabilitySummary(registryTool);
        const actual = listedTool.capabilitySummary;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push(`${listedTool.name}: catalog/registry capabilitySummary mismatch`);
        }
      }

      for (const toolName of config.tools) {
        if (!TOOL_DEFINITIONS.some((tool) => tool.name === toolName)) {
          continue;
        }
        if (!parsed.tools.some((tool) => tool.name === toolName)) {
          mismatches.push(`${category}/${toolName}: missing from catalog response`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
