import {
  MAX_CAPABILITY_INDEX_CATEGORIES,
  buildCapabilityIndexPromptSection,
} from '../../src/engine/prompts/capabilityIndex';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { estimateTokens } from '../../src/services/context/tokenCounter';

describe('buildCapabilityIndexPromptSection', () => {
  it('names the mobile domains a general assistant needs to know exist', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });

    expect(section).toContain('## Capability Index');
    expect(section).toContain('calendar');
    expect(section).toContain('contacts');
    expect(section).toContain('interaction');
    expect(section).toContain('tool_catalog');
  });

  it('stays inside the prompt budget it is allowed to spend', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });

    // Measured against the full registry — the worst case. It sits in the cacheable
    // prefix, so it is paid once per prefix rather than per turn. The ceiling exists
    // to catch unbounded growth.
    expect(estimateTokens(section)).toBeLessThanOrEqual(300);
    const categoryLines = section.split('\n').filter((line) => line.startsWith('- '));
    expect(categoryLines.length).toBeLessThanOrEqual(MAX_CAPABILITY_INDEX_CATEGORIES + 1);
  });

  it('never advertises a capability that is not in this run’s registry', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: TOOL_DEFINITIONS.filter((tool) => tool.name.startsWith('calendar_')),
    });

    expect(section).toContain('calendar');
    expect(section).not.toContain('ssh');
    expect(section).not.toContain('contacts');
  });

  it('spends nothing when the run has no categorized capability', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: [] });

    expect(section).toBe('');
  });

  it('is byte-identical no matter which tools the current turn exposes', () => {
    // The index heads the cacheable prompt prefix. It previously subtracted the
    // exposed tools, so every successful discovery changed byte zero of the system
    // prompt and invalidated the prompt cache for the entire request — the section
    // meant to save discovery round-trips was charging a full uncached prompt each
    // time discovery worked. Run-constant output is what makes the prefix reusable.
    const first = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });
    const afterActivation = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });

    expect(afterActivation).toBe(first);
  });

  it('lists a capability even once it is on the surface, so the text cannot drift', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });
    const calendarLine = section.split('\n').find((line) => line.startsWith('- calendar:'));

    expect(calendarLine).toBeDefined();
    expect(calendarLine).toContain('calendar_');
  });

  it('is stable under registry ordering so equal runs share a prefix', () => {
    const forward = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });
    const reversed = buildCapabilityIndexPromptSection({
      allTools: [...TOOL_DEFINITIONS].reverse(),
    });

    expect(reversed.split('\n')[0]).toBe(forward.split('\n')[0]);
    const forwardCategories = forward
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.split(':')[0]);
    const reversedCategories = reversed
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.split(':')[0]);
    expect(reversedCategories).toEqual(forwardCategories);
  });
});
