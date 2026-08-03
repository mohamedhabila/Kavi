import {
  MAX_CAPABILITY_INDEX_CATEGORIES,
  buildCapabilityIndexPromptSection,
} from '../../src/engine/prompts/capabilityIndex';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { estimateTokens } from '../../src/services/context/tokenCounter';

describe('buildCapabilityIndexPromptSection', () => {
  it('names the mobile domains a general assistant needs but cannot see this turn', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS,
      selectedToolNames: new Set(['read_file', 'write_file']),
    });

    expect(section).toContain('## Capability Index');
    expect(section).toContain('calendar');
    expect(section).toContain('contacts');
    expect(section).toContain('interaction');
    expect(section).toContain('tool_catalog');
  });

  it('stays inside the prompt budget it is allowed to spend', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS,
      selectedToolNames: new Set<string>(),
    });

    // Measured at 255 tokens against the full registry with nothing pre-selected —
    // the worst case. It sits in the cacheable prefix, so it is paid once per prefix
    // rather than per turn. The ceiling exists to catch unbounded growth.
    expect(estimateTokens(section)).toBeLessThanOrEqual(300);
    const categoryLines = section.split('\n').filter((line) => line.startsWith('- '));
    expect(categoryLines.length).toBeLessThanOrEqual(MAX_CAPABILITY_INDEX_CATEGORIES + 1);
  });

  it('never advertises a capability that is not in this run’s registry', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS.filter((tool) => tool.name.startsWith('calendar_')),
      selectedToolNames: new Set<string>(),
    });

    expect(section).toContain('calendar');
    expect(section).not.toContain('ssh');
    expect(section).not.toContain('contacts');
  });

  it('spends nothing when the surface already exposes everything', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS,
      selectedToolNames: new Set(TOOL_DEFINITIONS.map((tool) => tool.name)),
    });

    expect(section).toBe('');
  });

  it('omits tools that are already on the turn surface', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS,
      selectedToolNames: new Set(['calendar_events']),
    });

    const calendarLine = section.split('\n').find((line) => line.startsWith('- calendar:'));
    expect(calendarLine).toBeDefined();
    expect(calendarLine).not.toContain('calendar_events');
  });
});
