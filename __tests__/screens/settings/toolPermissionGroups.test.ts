import { i18n } from '../../../src/i18n/manager';
import { TOOL_DEFINITIONS } from '../../../src/engine/tools/definitions';
import { buildToolPermissionGroups } from '../../../src/screens/settings/toolPermissionGroups';
import type { ToolDefinition } from '../../../src/types/tool';

const AGENT_MACHINERY = ['tool_catalog', 'tool_describe', 'update_plan', 'wait'];

describe('settings tool permission groups', () => {
  // The groups used to be a hand-kept list that left every browser and Expo tool,
  // memory_remember and memory_forget out of Settings, so they could not be turned off.
  it('lists every registered tool exactly once, except the agent’s own machinery', () => {
    const listed = buildToolPermissionGroups(TOOL_DEFINITIONS).flatMap((group) =>
      group.definitions.map((definition) => definition.name),
    );

    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name)
        .filter((name) => !AGENT_MACHINERY.includes(name))
        .sort(),
    );
    expect(listed).toEqual(
      expect.arrayContaining([
        'browser_click',
        'expo_eas_build',
        'memory_remember',
        'memory_forget',
      ]),
    );
  });

  it('groups a tool by the category its contract declares', () => {
    const groups = buildToolPermissionGroups(TOOL_DEFINITIONS);
    const groupOf = (name: string) =>
      groups.find((group) => group.definitions.some((definition) => definition.name === name))?.id;

    expect(groupOf('calendar_update_event')).toBe('calendar');
    expect(groupOf('image_edit')).toBe('media');
    expect(groupOf('memory_search')).toBe('memory');
    expect(groupOf('ssh_fs')).toBe('ssh');
  });

  it('puts a tool without a contract under other tools', () => {
    const uncontracted: ToolDefinition = {
      name: 'custom_helper',
      description: 'A helper without a declared contract.',
      input_schema: { type: 'object', properties: {} },
    };

    expect(buildToolPermissionGroups([uncontracted])).toEqual([
      { id: 'other', definitions: [uncontracted] },
    ]);
  });

  it('has a title for every group (check:i18n covers the other locales)', () => {
    const ids = [...buildToolPermissionGroups(TOOL_DEFINITIONS).map((group) => group.id), 'other'];
    for (const id of ids) {
      const key = `settings.toolGroups.${id}.title`;
      expect(i18n.t(key)).not.toBe(key);
    }
  });
});
