import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { buildCapabilitySummary } from '../../src/engine/tools/builtin-tool-catalogCapabilitySummary';
import { TOOL_CATALOG_CATEGORIES } from '../../src/engine/tools/builtin-tool-catalogConfig';

describe('tool_catalog contract consistency', () => {
  it('returns capability summaries that match registry contracts for static categories', async () => {
    const mismatches: string[] = [];

    for (const [category, config] of Object.entries(TOOL_CATALOG_CATEGORIES)) {
      if (category === 'github') {
        continue;
      }

      const result = await executeToolCatalog({ category });
      const parsed = JSON.parse(result) as {
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