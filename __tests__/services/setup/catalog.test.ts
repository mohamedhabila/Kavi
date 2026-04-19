import { TOOL_PERMISSION_GROUPS, orderToolsByGroup } from '../../../src/services/setup/catalog';
import type { ToolDefinition } from '../../../src/types';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    input_schema: { type: 'object', properties: {} },
  };
}

describe('setup catalog', () => {
  it('lists image_edit in the media permission group', () => {
    const mediaGroup = TOOL_PERMISSION_GROUPS.find((group) => group.id === 'media');

    expect(mediaGroup).toBeDefined();
    expect(mediaGroup?.description).toContain('editing');
    expect(mediaGroup?.tools).toEqual(expect.arrayContaining(['image_generate', 'image_edit']));
  });

  it('preserves image_edit when ordering tool definitions by group', () => {
    const grouped = orderToolsByGroup([
      makeTool('notify'),
      makeTool('image_generate'),
      makeTool('image_edit'),
      makeTool('audio_transcribe'),
    ]);
    const mediaGroup = grouped.find((group) => group.id === 'media');

    expect(mediaGroup?.definitions.map((definition) => definition.name)).toEqual([
      'notify',
      'image_generate',
      'image_edit',
      'audio_transcribe',
    ]);
  });
});
