import { renderMemoryApplicabilityPromptSections } from '../../../src/services/memory/memoryApplicabilityPrompt';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

interface Fact {
  id: string;
  applicability?: { action: 'ask' | 'abstain'; reason: 'stale_memory' };
  renderedText: string;
}

describe('renderMemoryApplicabilityPromptSections renderedFact cut', () => {
  it('never splits a grapheme cluster when the 700-char renderedFact cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const renderedText = `${'f'.repeat(690)}${probe.repeat(15)}`;
      const fact: Fact = { id: 'f1', applicability: { action: 'ask', reason: 'stale_memory' }, renderedText };
      const sections = renderMemoryApplicabilityPromptSections([fact], (f) => f.renderedText);
      expect(sections).toHaveLength(1);
      expectGraphemeSafe(sections[0]);
    }
  });
});
