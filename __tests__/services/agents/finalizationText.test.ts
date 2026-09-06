import {
  normalizeFinalizationOutputText,
  normalizeFinalizationPreviewText,
  summarizeFinalizationToolResultPreview,
  truncateFinalizationText,
} from '../../../src/services/agents/finalizationText';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

const PROBES = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];

describe('normalizeFinalizationOutputText', () => {
  it('returns text unchanged when within budget', () => {
    expect(normalizeFinalizationOutputText('hello', 100)).toBe('hello');
  });

  it('never splits a grapheme cluster at an arbitrary maxLength cut', () => {
    for (const probe of PROBES) {
      const value = `${'a'.repeat(90)}${probe.repeat(15)}`;
      const result = normalizeFinalizationOutputText(value, 100);
      expectGraphemeSafe(result ?? '');
    }
  });
});

describe('truncateFinalizationText', () => {
  it('never splits a grapheme cluster at the ellipsis-suffixed cut', () => {
    for (const probe of PROBES) {
      const value = `${'a'.repeat(90)}${probe.repeat(15)}`;
      const result = truncateFinalizationText(value, 100);
      expectGraphemeSafe(result ?? '');
    }
  });
});

describe('normalizeFinalizationPreviewText', () => {
  it('never splits a grapheme cluster at the default 320-char preview cut', () => {
    for (const probe of PROBES) {
      const value = `${'a'.repeat(310)}${probe.repeat(15)}`;
      const result = normalizeFinalizationPreviewText(value);
      expectGraphemeSafe(result ?? '');
    }
  });
});

describe('summarizeFinalizationToolResultPreview', () => {
  it('never splits a grapheme cluster when a plain-text tool result is previewed', () => {
    for (const probe of PROBES) {
      const value = `${'a'.repeat(310)}${probe.repeat(15)}`;
      const result = summarizeFinalizationToolResultPreview(value);
      expectGraphemeSafe(result ?? '');
    }
  });

  it('never splits a grapheme cluster when a structured JSON scalar leaf is summarized', () => {
    for (const probe of PROBES) {
      const value = JSON.stringify({ message: `${'a'.repeat(85)}${probe.repeat(15)}` });
      const result = summarizeFinalizationToolResultPreview(value);
      expectGraphemeSafe(result ?? '');
    }
  });
});
