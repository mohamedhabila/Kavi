// ---------------------------------------------------------------------------
// Tests — Anthropic model generation parsing and capability predicates
// ---------------------------------------------------------------------------

import {
  getAnthropicModelGeneration,
  rejectsForcedToolChoice,
  rejectsSamplingParams,
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

describe('rejectsSamplingParams', () => {
  // Haiku 5.5 rejected temperature ("deprecated for this model") while the rule covered only
  // Fable and Opus/Sonnet 4.7+, so a memory extraction call at temperature 0 failed on it.
  it('is true for every Claude 5.x model and Opus/Sonnet 4.7+', () => {
    expect(rejectsSamplingParams('claude-haiku-5-5')).toBe(true);
    expect(rejectsSamplingParams('claude-sonnet-5-5')).toBe(true);
    expect(rejectsSamplingParams('claude-opus-5-5')).toBe(true);
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
