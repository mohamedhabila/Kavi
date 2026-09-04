// ---------------------------------------------------------------------------
// Tests — Anthropic model generation parsing and capability predicates
// ---------------------------------------------------------------------------

import {
  getAnthropicModelGeneration,
  isAnthropicClaude4Model,
  isAnthropicClaude4OpusModel,
  rejectsForcedToolChoice,
  rejectsSamplingParams,
  rejectsThinkingParam,
  requiresAdaptiveThinkingOnly,
  supportedEffortLevels,
  supportsAdaptiveThinking,
} from '../../../../src/services/llm/catalog/providerCapabilities';

describe('getAnthropicModelGeneration', () => {
  it('parses family, major, and minor from a two-segment generation id', () => {
    expect(getAnthropicModelGeneration('claude-opus-4-7')).toEqual({
      family: 'opus',
      major: 4,
      minor: 7,
    });
    expect(getAnthropicModelGeneration('claude-haiku-4-5')).toEqual({
      family: 'haiku',
      major: 4,
      minor: 5,
    });
    expect(getAnthropicModelGeneration('claude-fable-5-1')).toEqual({
      family: 'fable',
      major: 5,
      minor: 1,
    });
  });

  it('defaults minor to 0 for a single-segment generation id', () => {
    expect(getAnthropicModelGeneration('claude-opus-5')).toEqual({
      family: 'opus',
      major: 5,
      minor: 0,
    });
    expect(getAnthropicModelGeneration('claude-fable-5')).toEqual({
      family: 'fable',
      major: 5,
      minor: 0,
    });
  });

  it('parses through a hosted namespace prefix and trailing suffix', () => {
    expect(getAnthropicModelGeneration('anthropic/claude-sonnet-4-6-latest')).toEqual({
      family: 'sonnet',
      major: 4,
      minor: 6,
    });
  });

  it('parses an unrecognized family the same way (structural, not enumerated)', () => {
    expect(getAnthropicModelGeneration('claude-zeta-7')).toEqual({
      family: 'zeta',
      major: 7,
      minor: 0,
    });
  });

  it('returns undefined for a non-Anthropic model', () => {
    expect(getAnthropicModelGeneration('gpt-5.4')).toBeUndefined();
    expect(getAnthropicModelGeneration('gemini-2.5-pro')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(getAnthropicModelGeneration(undefined)).toBeUndefined();
  });
});

describe('rejectsThinkingParam (Fable)', () => {
  it('is true for every Fable minor', () => {
    expect(rejectsThinkingParam('claude-fable-5')).toBe(true);
    expect(rejectsThinkingParam('claude-fable-5-1')).toBe(true);
  });

  it('is false for non-Fable families, including 5.x', () => {
    expect(rejectsThinkingParam('claude-opus-5')).toBe(false);
    expect(rejectsThinkingParam('claude-sonnet-5')).toBe(false);
    expect(rejectsThinkingParam('claude-haiku-4-5')).toBe(false);
  });
});

describe('supportsAdaptiveThinking', () => {
  it('is true from Opus/Sonnet 4.6 onward', () => {
    expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-opus-4-7')).toBe(true);
    expect(supportsAdaptiveThinking('claude-opus-4-8')).toBe(true);
    expect(supportsAdaptiveThinking('claude-opus-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-sonnet-5')).toBe(true);
  });

  it('is false before 4.6, for Haiku, and for Fable', () => {
    expect(supportsAdaptiveThinking('claude-opus-4-5')).toBe(false);
    expect(supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
    expect(supportsAdaptiveThinking('claude-fable-5-1')).toBe(false);
  });
});

describe('requiresAdaptiveThinkingOnly', () => {
  it('is true from Opus/Sonnet 4.7 onward, including every 5.x', () => {
    expect(requiresAdaptiveThinkingOnly('claude-opus-4-7')).toBe(true);
    expect(requiresAdaptiveThinkingOnly('claude-opus-4-8')).toBe(true);
    expect(requiresAdaptiveThinkingOnly('claude-sonnet-5')).toBe(true);
    expect(requiresAdaptiveThinkingOnly('claude-opus-5')).toBe(true);
  });

  it('is false for 4.6 (budget_tokens still accepted there, deprecated) and older', () => {
    expect(requiresAdaptiveThinkingOnly('claude-opus-4-6')).toBe(false);
    expect(requiresAdaptiveThinkingOnly('claude-sonnet-4-6')).toBe(false);
  });

  it('is false for Haiku and Fable (handled by their own rules)', () => {
    expect(requiresAdaptiveThinkingOnly('claude-haiku-4-5')).toBe(false);
    expect(requiresAdaptiveThinkingOnly('claude-fable-5-1')).toBe(false);
  });
});

describe('rejectsSamplingParams', () => {
  it('is true for Fable and every Opus/Sonnet 4.7+', () => {
    expect(rejectsSamplingParams('claude-fable-5')).toBe(true);
    expect(rejectsSamplingParams('claude-fable-5-1')).toBe(true);
    expect(rejectsSamplingParams('claude-opus-5')).toBe(true);
    expect(rejectsSamplingParams('claude-opus-4-8')).toBe(true);
    expect(rejectsSamplingParams('claude-opus-4-7')).toBe(true);
    expect(rejectsSamplingParams('claude-sonnet-5')).toBe(true);
  });

  it('is false for 4.6 (sampling allowed) and pre-4.6 legacy models', () => {
    expect(rejectsSamplingParams('claude-opus-4-6')).toBe(false);
    expect(rejectsSamplingParams('claude-sonnet-4-6')).toBe(false);
    expect(rejectsSamplingParams('claude-haiku-4-5')).toBe(false);
  });
});

describe('rejectsForcedToolChoice', () => {
  it('is true only for Fable 5.1 and Mythos 5.1 specifically', () => {
    expect(rejectsForcedToolChoice('claude-fable-5-1')).toBe(true);
    expect(rejectsForcedToolChoice('claude-mythos-5-1')).toBe(true);
  });

  it('is false for Fable 5 (not 5.1) and every other model', () => {
    expect(rejectsForcedToolChoice('claude-fable-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-opus-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-sonnet-4-6')).toBe(false);
    expect(rejectsForcedToolChoice('claude-haiku-4-5')).toBe(false);
  });
});

describe('supportedEffortLevels', () => {
  it('supports the full range up to xhigh for Fable and every Opus/Sonnet 4.7+', () => {
    const full = ['low', 'medium', 'high', 'xhigh', 'max'];
    expect(supportedEffortLevels('claude-fable-5')).toEqual(full);
    expect(supportedEffortLevels('claude-fable-5-1')).toEqual(full);
    expect(supportedEffortLevels('claude-opus-5')).toEqual(full);
    expect(supportedEffortLevels('claude-opus-4-8')).toEqual(full);
    expect(supportedEffortLevels('claude-opus-4-7')).toEqual(full);
    expect(supportedEffortLevels('claude-sonnet-5')).toEqual(full);
  });

  it('excludes xhigh for Opus/Sonnet 4.6', () => {
    expect(supportedEffortLevels('claude-opus-4-6')).toEqual(['low', 'medium', 'high', 'max']);
    expect(supportedEffortLevels('claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('is empty for Haiku and other pre-4.6 legacy models', () => {
    expect(supportedEffortLevels('claude-haiku-4-5')).toEqual([]);
  });

  it('is empty for a non-Anthropic model', () => {
    expect(supportedEffortLevels('gpt-5.4')).toEqual([]);
  });

  it('is permissive (full range) when no model is supplied at all', () => {
    expect(supportedEffortLevels(undefined)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('isAnthropicClaude4Model / isAnthropicClaude4OpusModel', () => {
  it('scope to the 4.x Opus/Sonnet generation only', () => {
    expect(isAnthropicClaude4Model('claude-opus-4-7')).toBe(true);
    expect(isAnthropicClaude4Model('claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicClaude4Model('claude-opus-5')).toBe(false);
    expect(isAnthropicClaude4Model('claude-haiku-4-5')).toBe(false);

    expect(isAnthropicClaude4OpusModel('claude-opus-4-7')).toBe(true);
    expect(isAnthropicClaude4OpusModel('claude-sonnet-4-6')).toBe(false);
    expect(isAnthropicClaude4OpusModel('claude-opus-5')).toBe(false);
  });
});
