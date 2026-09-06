import { buildRecentUserRetrievalQuery } from '../../../src/services/memory/retrievalQueryText';
import { makeTestMessage } from '../../helpers/factories';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('buildRecentUserRetrievalQuery', () => {
  it('joins recent user turns, most recent last, within the default turn window', () => {
    const messages = [
      makeTestMessage(1, { role: 'user', content: 'first' }),
      makeTestMessage(2, { role: 'assistant', content: 'reply' }),
      makeTestMessage(3, { role: 'user', content: 'second' }),
    ];
    expect(buildRecentUserRetrievalQuery(messages)).toBe('first\nsecond');
  });

  it('returns the text unchanged when within the char budget', () => {
    const messages = [makeTestMessage(1, { role: 'user', content: 'short query' })];
    expect(buildRecentUserRetrievalQuery(messages, 4, 2000)).toBe('short query');
  });

  it('never splits a grapheme cluster when the tail-truncation cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      // Repeat the probe near the cut boundary (kept end) so at least one
      // occurrence straddles the exact maxChars cut from the end.
      const content = `${'z'.repeat(20)}${probe.repeat(15)}${'z'.repeat(5)}`;
      const messages = [makeTestMessage(1, { role: 'user', content })];
      const result = buildRecentUserRetrievalQuery(messages, 4, 30);
      expectGraphemeSafe(result);
    }
  });
});
