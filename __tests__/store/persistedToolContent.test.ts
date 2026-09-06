import { compactPersistedToolContent } from '../../src/store/persistedToolContent';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../helpers/graphemeSafetyProbes';

describe('compactPersistedToolContent', () => {
  it('returns short content unchanged', () => {
    expect(compactPersistedToolContent('short', 100)).toBe('short');
  });

  it('never splits a grapheme cluster when plain-text content is head-tail truncated', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const content = `plain text, not JSON: ${'c'.repeat(180)}${probe.repeat(15)}`;
      const result = compactPersistedToolContent(content, 200);
      expectGraphemeSafe(result);
    }
  });

  it('never splits a grapheme cluster when a long JSON string field is compacted', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const content = JSON.stringify({
        summary: `${'s'.repeat(470)}${probe.repeat(15)}`,
      });
      const result = compactPersistedToolContent(content, 300);
      const parsed = JSON.parse(result) as { summary?: string };
      expectGraphemeSafe(parsed.summary ?? '');
    }
  });

  it('never splits a grapheme cluster in the fallback envelope excerpt', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      // A single very long string field defeats every compaction profile,
      // forcing the JSON-envelope fallback with its own head-tail excerpt.
      const content = JSON.stringify({ field: `${'f'.repeat(5000)}${probe.repeat(30)}` });
      const result = compactPersistedToolContent(content, 150);
      const parsed = JSON.parse(result) as { contentExcerpt?: string };
      expectGraphemeSafe(parsed.contentExcerpt ?? '');
    }
  });
});
