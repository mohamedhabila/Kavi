jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  isLongTermMemoryEnabled: jest.fn(() => true),
}));

import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { parseSkillToolName } from '../../src/services/skills/manager';
import { CRON_TOOL } from '../../src/engine/tools/extended-definitions';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('tool_catalog contract consistency', () => {
  // A registered tool the catalog cannot return is unreachable: share_file was, while a
  // hand-kept list decided what the catalog held.
  it('finds every registered built-in tool by a search for its own name', async () => {
    const problems: string[] = [];
    for (const { name } of TOOL_DEFINITIONS) {
      if (name === 'tool_catalog' || name === 'tool_describe' || parseSkillToolName(name)) continue;
      const { tools } = parseCompletedToolOutcome(
        await executeToolCatalog({ query: name.replace(/_/g, ' ') }),
      ) as { tools: Array<{ name: string }> };
      if (!tools.some((tool) => tool.name === name)) problems.push(`${name}: not found`);
    }

    expect(problems).toEqual([]);
  });

  it('never returns the discovery tools themselves', async () => {
    const { tools } = parseCompletedToolOutcome(
      await executeToolCatalog({ query: 'tool catalog describe search tools' }),
    ) as { tools: Array<{ name: string }> };

    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['tool_catalog']));
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['tool_describe']));
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
