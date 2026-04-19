// ---------------------------------------------------------------------------
// Tests — Thinking Level Control
// ---------------------------------------------------------------------------

import { getThinkingParams, ThinkingLevel } from '../../src/engine/thinking';

describe('getThinkingParams', () => {
  it('returns empty object for "off"', () => {
    expect(getThinkingParams('off', 'claude-sonnet-4-6')).toEqual({});
    expect(getThinkingParams('off', 'gpt-5.4')).toEqual({});
  });

  it('returns native Gemini thinking budgets for flash models when off', () => {
    expect(getThinkingParams('off', 'gemini-2.5-flash')).toEqual({
      thinking: { thinkingBudget: 0 },
    });
    expect(getThinkingParams('off', 'gemini-2.5-flash-lite')).toEqual({
      thinking: { thinkingBudget: 0 },
    });
  });

  describe('Anthropic adaptive thinking models (Claude 4.6)', () => {
    it.each<[ThinkingLevel, string]>([
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
    ])('level %s → adaptive effort %s', (level, effort) => {
      const result = getThinkingParams(level, 'claude-sonnet-4-6');
      expect(result).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort },
      });
    });

    it('maps xhigh to max for Claude Opus 4.6', () => {
      expect(getThinkingParams('xhigh', 'claude-opus-4-6')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'max' },
      });
    });

    it('maps xhigh to high for Claude Sonnet 4.6', () => {
      expect(getThinkingParams('xhigh', 'claude-sonnet-4-6')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    });

    it('ignores maxTokens because adaptive thinking uses max_tokens as a hard cap', () => {
      expect(getThinkingParams('high', 'claude-sonnet-4-6', { maxTokens: 900 })).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    });
  });

  describe('Older Anthropic models (manual thinking)', () => {
    it.each<[ThinkingLevel, number]>([
      ['low', 2048],
      ['medium', 8192],
      ['high', 32768],
    ])('level %s → budget_tokens %d', (level, budget) => {
      const result = getThinkingParams(level, 'claude-sonnet-4-5');
      expect(result).toEqual({
        thinking: { type: 'enabled', budget_tokens: budget },
      });
    });

    it('matches case-insensitively', () => {
      const result = getThinkingParams('high', 'Claude-Sonnet-4');
      expect(result.thinking).toBeDefined();
    });

    it('downgrades the thinking budget to fit max_tokens', () => {
      expect(getThinkingParams('high', 'claude-sonnet-4-5', { maxTokens: 3072 })).toEqual({
        thinking: { type: 'enabled', budget_tokens: 2048 },
      });
      expect(getThinkingParams('medium', 'claude-sonnet-4-5', { maxTokens: 1500 })).toEqual({
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });
    });

    it('disables Anthropic thinking when max_tokens is too small for the minimum budget', () => {
      expect(getThinkingParams('minimal', 'claude-sonnet-4-5', { maxTokens: 1024 })).toEqual({});
      expect(getThinkingParams('high', 'claude-sonnet-4-5', { maxTokens: 900 })).toEqual({});
    });
  });

  describe('OpenAI reasoning models', () => {
    it.each(['o1-preview', 'o3-mini', 'o4-mini', 'gpt-5.4'])(
      'detects %s as reasoning model',
      (model) => {
        const result = getThinkingParams('high', model);
        expect(result).toHaveProperty('reasoning_effort', 'high');
      },
    );

    it('maps low to low effort', () => {
      expect(getThinkingParams('low', 'o1-preview')).toEqual({ reasoning_effort: 'low' });
    });

    it('maps medium to medium effort', () => {
      expect(getThinkingParams('medium', 'o3-mini')).toEqual({ reasoning_effort: 'medium' });
    });
  });

  describe('Gemini models', () => {
    it('maps Gemini 2.5 pro to native thinking budgets', () => {
      expect(getThinkingParams('off', 'gemini-2.5-pro')).toEqual({
        thinking: { thinkingBudget: 128 },
      });
      expect(getThinkingParams('low', 'gemini-2.5-pro')).toEqual({
        thinking: { thinkingBudget: 2048 },
      });
      expect(getThinkingParams('high', 'gemini-2.5-pro')).toEqual({
        thinking: { thinkingBudget: 16384 },
      });
    });

    it('maps Gemini 3 pro to supported native thinking levels', () => {
      expect(getThinkingParams('minimal', 'gemini-3.1-pro-preview')).toEqual({
        thinking: { thinkingLevel: 'low' },
      });
      expect(getThinkingParams('medium', 'gemini-3.1-pro-preview')).toEqual({
        thinking: { thinkingLevel: 'medium' },
      });
    });

    it('maps Gemini 3 flash to minimal/high native thinking levels', () => {
      expect(getThinkingParams('off', 'gemini-3-flash-preview')).toEqual({
        thinking: { thinkingLevel: 'minimal' },
      });
      expect(getThinkingParams('high', 'gemini-3-flash-preview')).toEqual({
        thinking: { thinkingLevel: 'high' },
      });
    });
  });

  describe('other models (temperature fallback)', () => {
    it.each<[ThinkingLevel, number]>([
      ['low', 0.5],
      ['medium', 0.7],
      ['high', 1.0],
    ])('level %s → temperature %d', (level, temp) => {
      const result = getThinkingParams(level, 'llama3.2');
      expect(result).toEqual({ temperature: temp });
    });
  });
});
