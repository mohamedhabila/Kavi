import { humanizeToolName } from '../../src/utils/toolDisplayName';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../src/engine/tools/native/definitions';
import { en } from '../../src/i18n/locales/en';

// Tool steps are shown by name in every answer that uses tools. A registered tool without
// a localized name fell back to its identifier in English title case — "Browser Click",
// "Skill  Weather  Current" — in every language. The other locales are held to English
// key parity by check-i18n-consistency, so covering English covers all of them.

const toolNames = (en as { toolCall: { tools: Record<string, string> } }).toolCall.tools;

describe('localized tool names', () => {
  const registered = [
    ...new Set([...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS].map((tool) => tool.name)),
  ];

  it('covers a meaningful registry', () => {
    expect(registered.length).toBeGreaterThan(100);
  });

  it.each(registered)('names %s', (name) => {
    expect(typeof toolNames[name]).toBe('string');
    expect(toolNames[name]!.trim().length).toBeGreaterThan(0);
  });
});

describe('humanizeToolName for tools added at runtime', () => {
  it.each([
    ['mcp__docs__search_docs', 'Search Docs'],
    ['skill__acme__track_parcel', 'Track Parcel'],
    ['plain_tool', 'Plain Tool'],
  ])('formats %s as %s', (name, expected) => {
    expect(humanizeToolName(name)).toBe(expected);
  });
});
