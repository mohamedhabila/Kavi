// ---------------------------------------------------------------------------
// Tests — Episode summary presentation
// ---------------------------------------------------------------------------
// A structural-turn episode's `summary` is our own versioned JSON descriptor,
// never prose. These tests exercise every descriptor field combination in
// English, and the CLDR plural forms in Arabic (which uses all six
// categories), to prove the presentation helper never leaks raw JSON.
// ---------------------------------------------------------------------------

import { i18n } from '../../../src/i18n/manager';
import { presentEpisodeSummary } from '../../../src/services/memory/episodes/episodeSummaryPresentation';
import type { MemoryEpisode } from '../../../src/services/memory/episodes/types';

function structuralEpisode(
  descriptor: {
    messageCount: number;
    toolCallCount: number;
    completedToolCallCount: number;
    hasCodeBlock: boolean;
    hasAttachments: boolean;
  },
  overrides: Partial<Pick<MemoryEpisode, 'entities' | 'toolNames'>> = {},
): Pick<MemoryEpisode, 'summary' | 'summaryKind' | 'entities' | 'toolNames'> {
  return {
    summary: JSON.stringify({ kind: 'structural_turn', version: 1, ...descriptor }),
    summaryKind: 'structural_turn',
    entities: overrides.entities ?? [],
    toolNames: overrides.toolNames ?? [],
  };
}

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

afterEach(async () => {
  await i18n.setLocale('en');
});

describe('presentEpisodeSummary — narrative episodes', () => {
  it('passes narrative summaries through unchanged', () => {
    const episode = {
      summary: 'User asked to fix the config file.',
      summaryKind: 'narrative' as const,
      entities: [],
      toolNames: [],
    };
    expect(presentEpisodeSummary(episode, t)).toBe('User asked to fix the config file.');
  });

  it('treats a missing summaryKind as narrative (legacy/default rows)', () => {
    const episode = { summary: 'Legacy prose.', entities: [], toolNames: [] };
    expect(presentEpisodeSummary(episode, t)).toBe('Legacy prose.');
  });
});

describe('presentEpisodeSummary — structural-turn episodes (English)', () => {
  it('renders only the message count when nothing else applies', () => {
    const episode = structuralEpisode({
      messageCount: 3,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe('Conversation turn with 3 messages');
  });

  it('uses the singular message form for a count of one', () => {
    const episode = structuralEpisode({
      messageCount: 1,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe('Conversation turn with 1 message');
  });

  it('adds a completed tool-call fragment when every call finished', () => {
    const episode = structuralEpisode({
      messageCount: 4,
      toolCallCount: 2,
      completedToolCallCount: 2,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(
      'Conversation turn with 4 messages · 2 tool calls',
    );
  });

  it('reports partial completion distinctly from full completion', () => {
    const episode = structuralEpisode({
      messageCount: 5,
      toolCallCount: 3,
      completedToolCallCount: 1,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(
      'Conversation turn with 5 messages · 1 of 3 tool calls completed',
    );
  });

  it('adds a code-block fragment', () => {
    const episode = structuralEpisode({
      messageCount: 2,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: true,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe('Conversation turn with 2 messages · Includes code');
  });

  it('adds an attachments fragment', () => {
    const episode = structuralEpisode({
      messageCount: 2,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: true,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(
      'Conversation turn with 2 messages · Includes attachments',
    );
  });

  it('combines every fragment in order when all signals are present', () => {
    const episode = structuralEpisode({
      messageCount: 6,
      toolCallCount: 2,
      completedToolCallCount: 2,
      hasCodeBlock: true,
      hasAttachments: true,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(
      'Conversation turn with 6 messages · 2 tool calls · Includes code · Includes attachments',
    );
  });

  it('never contains a JSON brace for any descriptor combination', () => {
    const episode = structuralEpisode({
      messageCount: 0,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).not.toContain('{');
    expect(presentEpisodeSummary(episode, t)).not.toContain('kind');
  });
});

describe('presentEpisodeSummary — malformed structural descriptor', () => {
  it('falls back to the entity/tool list, never the raw string', () => {
    const episode: Pick<MemoryEpisode, 'summary' | 'summaryKind' | 'entities' | 'toolNames'> = {
      summary: '{"kind":"structural_turn","version":2,"messageCount":"not-a-number"}',
      summaryKind: 'structural_turn',
      entities: ['project-x'],
      toolNames: ['write_file', 'write_file', 'read_file'],
    };
    const rendered = presentEpisodeSummary(episode, t);
    expect(rendered).not.toContain('{');
    expect(rendered).toBe('Conversation activity · project-x, write_file, read_file');
  });

  it('falls back to the generic label alone when there is nothing else to show', () => {
    const episode: Pick<MemoryEpisode, 'summary' | 'summaryKind' | 'entities' | 'toolNames'> = {
      summary: 'not json at all',
      summaryKind: 'structural_turn',
      entities: [],
      toolNames: [],
    };
    expect(presentEpisodeSummary(episode, t)).toBe('Conversation activity');
  });
});

describe('presentEpisodeSummary — Arabic plural forms', () => {
  beforeEach(async () => {
    await i18n.setLocale('ar');
  });

  it.each([
    [0, 'دورة محادثة بلا رسائل'],
    [1, 'دورة محادثة تضم رسالة واحدة'],
    [2, 'دورة محادثة تضم رسالتين'],
    [3, 'دورة محادثة تضم 3 رسائل'],
    [11, 'دورة محادثة تضم 11 رسالةً'],
    [100, 'دورة محادثة تضم 100 رسالة'],
  ])('renders the CLDR category for a message count of %d', (messageCount, expected) => {
    const episode = structuralEpisode({
      messageCount,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(expected);
  });

  it('joins the tool-call fragment using the Arabic plural category too', () => {
    const episode = structuralEpisode({
      messageCount: 2,
      toolCallCount: 2,
      completedToolCallCount: 2,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(presentEpisodeSummary(episode, t)).toBe(
      'دورة محادثة تضم رسالتين · استدعاءا أداة',
    );
  });
});
