import {
  buildAgentRunEvidencePromptSection,
  normalizeAgentRunEvidenceEntry,
} from '../../../src/services/agents/lifecycle/evidence';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('normalizeAgentRunEvidenceEntry', () => {
  it('normalizes a minimal draft entry', () => {
    const entry = normalizeAgentRunEvidenceEntry({ kind: 'fact', content: 'a fact' }, 100);
    expect(entry?.content).toBe('a fact');
    expect(entry?.createdAt).toBe(100);
  });

  it('never splits a grapheme cluster when the default 80-char title cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const content = `${'c'.repeat(70)}${probe.repeat(15)}`;
      const entry = normalizeAgentRunEvidenceEntry({ kind: 'fact', content }, 100);
      expectGraphemeSafe(entry?.title ?? '');
    }
  });

  it('never splits a grapheme cluster when the evidence-line content cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const content = `${'c'.repeat(1590)}${probe.repeat(15)}`;
      const section = buildAgentRunEvidencePromptSection([
        { kind: 'fact', status: 'candidate', recorder: 'supervisor', id: 'e1', title: 't', content, createdAt: 1, updatedAt: 1 },
      ]);
      expect(section).toBeDefined();
      expectGraphemeSafe(section as string);
    }
  });
});
