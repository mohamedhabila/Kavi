import { fitAgentRunText } from '../../../src/services/memory/agentRunEvidenceCompaction';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('fitAgentRunText', () => {
  it('returns short text unchanged', () => {
    expect(fitAgentRunText('short observation')).toBe('short observation');
  });

  it('never splits a grapheme cluster in the single-line fallback cut', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      // A single long line (no multiline sampling) forces the plain
      // head-cut-with-ellipsis fallback at the default 900-char budget.
      const text = `${'o'.repeat(890)}${probe.repeat(15)}`;
      const result = fitAgentRunText(text);
      expectGraphemeSafe(result);
    }
  });

  it('never splits a grapheme cluster inside a multiline sampled window', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const lines = Array.from(
        { length: 12 },
        (_, index) => `line ${index}: ${'x'.repeat(20)}${probe.repeat(10)}`,
      );
      const result = fitAgentRunText(lines.join('\n'), 200);
      expectGraphemeSafe(result);
    }
  });
});
