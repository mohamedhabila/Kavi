import { compactObservedAffordanceComplementForPrompt } from '../../../src/services/memory/promptAffordanceComplement';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('compactObservedAffordanceComplementForPrompt', () => {
  it('keeps a query-matching affordance label not present in the control sequence', () => {
    const result = compactObservedAffordanceComplementForPrompt({
      observedAffordances: [{ role: 'button', label: 'marker button' }],
      compactedControlSequence: null,
      queryUnits: new Set(['marker']),
    }) as Array<{ label?: string }>;
    expect(result?.[0]?.label).toBe('marker button');
  });

  it('never splits a grapheme cluster when the 180-char label cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const label = `marker ${'l'.repeat(165)}${probe.repeat(15)}`;
      const result = compactObservedAffordanceComplementForPrompt({
        observedAffordances: [{ role: 'button', label }],
        compactedControlSequence: null,
        queryUnits: new Set(['marker']),
      }) as Array<{ label?: string }>;
      expectGraphemeSafe(result?.[0]?.label ?? '');
    }
  });
});
