import {
  MAX_CAPABILITY_INDEX_CATEGORIES,
  buildCapabilityIndexPromptSection,
} from '../../src/engine/prompts/capabilityIndex';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { mcpToolToDefinition, readMcpIntegrationName } from '../../src/services/mcp/bridge';
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

    // Measured against the full registry — the worst case (1,258 tokens with every tool of
    // every category named with its required arguments). It sits in the cacheable prefix, so
    // it is paid once per prefix rather than per turn. The ceiling catches unbounded growth.
    expect(estimateTokens(section)).toBeLessThanOrEqual(1500);
    const categoryLines = section.split('\n').filter((line) => line.startsWith('- '));
    expect(categoryLines.length).toBeLessThanOrEqual(MAX_CAPABILITY_INDEX_CATEGORIES + 1);
  });

  // "calendar: calendar_list, calendar_events, +2 more" hid calendar_create_event, and GLM 5.3
  // Flash told the person their flight was in the calendar without creating it.
  it('names every tool of a domain, so a write tool is never hidden behind a count', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });
    const calendar = section.split('\n').find((line) => line.startsWith('- calendar:'));

    expect(calendar).toContain('calendar_create_event');
    expect(calendar).toContain('calendar_update_event');
    expect(section).not.toMatch(/\+\d+ more/);
  });

  it('lists every category the run has, grouped by contract category', () => {
    // A 14-line cap over alphabetically sorted categories used to drop web, ssh, sessions
    // and the workspace file tools from every full run.
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });
    const categories = section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0]);

    expect(categories).toEqual(
      expect.arrayContaining(['web', 'ssh', 'sessions', 'workspace_files', 'calendar', 'contacts']),
    );
    expect(section).not.toContain('further categories');
    expect(section).toContain('- web: web_search(queries), web_fetch(urls)');
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

  // With only a name, a call to a tool off the turn's surface guessed its arguments: Claude
  // Sonnet 5.5 sent sms_compose `to` and `body` for `recipients` and `message`.
  it('names the arguments each tool requires', () => {
    const section = buildCapabilityIndexPromptSection({ allTools: TOOL_DEFINITIONS });

    expect(section).toContain('sms_compose(recipients, message)');
    expect(section).toContain('calendar_create_event(title, startDate, endDate)');
  });
});

// Listed under their transport ("- mcp: mcp__mail__mail_search, …"), the tools of the mail
// integration never said they were the person's mail: asked to add a hotel check-in to the
// calendar, GLM 5.3 Flash searched memory and asked instead (0 of 3).
describe('connected integrations in the capability index', () => {
  function integrationTool(
    serverId: string,
    serverName: string,
    name: string,
    required: string[] = [],
  ) {
    return mcpToolToDefinition({
      serverId,
      serverName,
      tool: {
        name,
        description: `${name} description`,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(required.map((key) => [key, { type: 'string' }])),
          required,
        },
      },
    });
  }

  it('lists each integration under the name the person gave it', () => {
    const section = buildCapabilityIndexPromptSection({
      allTools: [
        integrationTool('mail', 'Mail', 'mail_search'),
        integrationTool('mail', 'Mail', 'mail_read', ['id']),
        integrationTool('notes', 'Team Notes', 'notes_find'),
      ],
    });

    expect(section).toContain(
      '- Mail (connected integration): mcp__mail__mail_search, mcp__mail__mail_read(id)',
    );
    expect(section).toContain('- Team Notes (connected integration): mcp__notes__notes_find');
    expect(section).not.toContain('- mcp:');
  });

  it('keeps a long or multi-line integration name to one bounded line', () => {
    expect(readMcpIntegrationName('[My  Work\tMail] Search')).toBe('My Work Mail');
    expect(readMcpIntegrationName(`[${'x'.repeat(100)}] Search`)).toHaveLength(40);
    expect(readMcpIntegrationName('[Two\nLines] Search')).toBeUndefined();
    expect(readMcpIntegrationName('Search the inbox')).toBeUndefined();
  });
});
