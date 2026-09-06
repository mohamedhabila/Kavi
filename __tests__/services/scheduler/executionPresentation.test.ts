import { summarizeScheduledJobNotification } from '../../../src/services/scheduler/executionPresentation';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('summarizeScheduledJobNotification', () => {
  it('returns short text unchanged (collapsing whitespace)', () => {
    expect(summarizeScheduledJobNotification('  hello   world  ')).toBe('hello world');
  });

  it('falls back to a default message for empty text', () => {
    expect(summarizeScheduledJobNotification('   ')).toBe('Task completed.');
  });

  it('never splits a grapheme cluster when the 180-char notification cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const text = `${'n'.repeat(170)}${probe.repeat(15)}`;
      const result = summarizeScheduledJobNotification(text);
      expectGraphemeSafe(result);
    }
  });
});
