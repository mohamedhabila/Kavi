// ---------------------------------------------------------------------------
// Tests — episodeIndexUnits (lexical episode index)
// ---------------------------------------------------------------------------
// A structural-turn episode's `summary` is our own versioned JSON descriptor,
// never prose, so it must never be tokenized into the lexical episode index —
// only its (already language-independent) entities and tool names may be.
// ---------------------------------------------------------------------------

import { episodeIndexUnits } from '../../../src/services/memory/episodes/queryScoring';

describe('episodeIndexUnits', () => {
  it('tokenizes a narrative summary as usual', () => {
    const units = episodeIndexUnits({
      summary: 'User confirmed the deploy window',
      summaryKind: 'narrative',
      entities: [],
      toolNames: [],
    });
    expect(units.has('deploy')).toBe(true);
    expect(units.has('window')).toBe(true);
  });

  it('excludes every token from a structural-turn descriptor', () => {
    const descriptor = JSON.stringify({
      kind: 'structural_turn',
      version: 1,
      messageCount: 4,
      toolCallCount: 2,
      completedToolCallCount: 2,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    const units = episodeIndexUnits({
      summary: descriptor,
      summaryKind: 'structural_turn',
      entities: [],
      toolNames: [],
    });
    expect(units.size).toBe(0);
    expect(units.has('structural_turn')).toBe(false);
    expect(units.has('kind')).toBe(false);
    expect(units.has('messagecount')).toBe(false);
  });

  it('still indexes entities and tool names for a structural-turn episode', () => {
    const descriptor = JSON.stringify({
      kind: 'structural_turn',
      version: 1,
      messageCount: 2,
      toolCallCount: 1,
      completedToolCallCount: 1,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    const units = episodeIndexUnits({
      summary: descriptor,
      summaryKind: 'structural_turn',
      entities: ['project-x'],
      toolNames: ['write_file'],
    });
    expect(units.has('project')).toBe(true);
    expect(units.has('write')).toBe(true);
    expect(units.has('file')).toBe(true);
  });

  it('treats a missing summaryKind as narrative (legacy/default rows)', () => {
    const units = episodeIndexUnits({
      summary: 'Fixed the auth bug',
      entities: [],
      toolNames: [],
    });
    expect(units.has('auth')).toBe(true);
  });
});
