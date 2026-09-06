import { hasCompleteEpisodeSource } from '../../../src/services/memory/episodes/accessPolicy';
import type { EpisodeRow } from '../../../src/services/memory/episodes/types';
import { ZWJ_FAMILY_EMOJI } from '../../helpers/graphemeSafetyProbes';

function makeRow(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 'ep-1',
    conversation_id: 'conv-1',
    thread_id: 'conv-1',
    task_id: null,
    started_at: 1,
    ended_at: 2,
    summary: 'a valid summary',
    sensitivity: 'normal',
    entities_json: '[]',
    message_ids_json: '["m1","m2"]',
    tool_names_json: '[]',
    importance: 0.5,
    embedding: null,
    created_at: 2,
    deleted_at: null,
    source_start_message_id: 'm1',
    source_end_message_id: 'm2',
    source_identity_manifest_json: '{}',
    ...overrides,
  };
}

describe('hasCompleteEpisodeSource summary length gate', () => {
  it('accepts a summary at exactly the 1200-grapheme limit', () => {
    const row = makeRow({ summary: 'a'.repeat(1200) });
    expect(hasCompleteEpisodeSource(row)).toBe(true);
  });

  it('rejects a summary one grapheme past the limit', () => {
    const row = makeRow({ summary: 'a'.repeat(1201) });
    expect(hasCompleteEpisodeSource(row)).toBe(false);
  });

  it('measures length in graphemes, not UTF-16 code units — a 1200-grapheme summary built from 2-code-unit emoji (2400 UTF-16 units) is accepted', () => {
    // Before the fix, this row's summary was measured with `.length` (UTF-16
    // code units): 1200 ZWJ-family emoji sequences are far more than 1200
    // code units, so a validly-capped (by grapheme count) persisted summary
    // would have been wrongly rejected as "too long".
    const summary = ZWJ_FAMILY_EMOJI.repeat(1200);
    expect(summary.length).toBeGreaterThan(1200);
    const row = makeRow({ summary });
    expect(hasCompleteEpisodeSource(row)).toBe(true);
  });
});
