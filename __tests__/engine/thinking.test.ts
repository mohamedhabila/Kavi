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
    it('keeps minimal Anthropic adaptive turns on the provider default path', () => {
      expect(getThinkingParams('minimal', 'claude-sonnet-4-6')).toEqual({});
    });

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

    it('maps xhigh to max for Claude Sonnet 4.6 (same effort range as Opus 4.6)', () => {
      // Authoritative table groups Opus 4.6 and Sonnet 4.6 together: both support
      // effort low|medium|high|max (no xhigh) — Sonnet is not a smaller range here.
      expect(getThinkingParams('xhigh', 'claude-sonnet-4-6')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'max' },
      });
    });

    it('ignores maxTokens because adaptive thinking uses max_tokens as a hard cap', () => {
      expect(getThinkingParams('high', 'claude-sonnet-4-6', { maxTokens: 900 })).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    });
  });

  describe('Anthropic Fable models (no thinking param, effort only)', () => {
    it('sends no thinking param at all, only output_config.effort', () => {
      expect(getThinkingParams('low', 'claude-fable-5-1')).toEqual({
        output_config: { effort: 'low' },
      });
      expect(getThinkingParams('medium', 'claude-fable-5')).toEqual({
        output_config: { effort: 'medium' },
      });
    });

    it('keeps minimal Fable turns on the provider default path', () => {
      expect(getThinkingParams('minimal', 'claude-fable-5-1')).toEqual({});
    });

    it('maps xhigh to the xhigh effort tier for both Fable 5 and 5.1, never escalating to max', () => {
      expect(getThinkingParams('xhigh', 'claude-fable-5-1')).toEqual({
        output_config: { effort: 'xhigh' },
      });
      expect(getThinkingParams('xhigh', 'claude-fable-5')).toEqual({
        output_config: { effort: 'xhigh' },
      });
    });

    it('ignores maxTokens (Fable never builds a budget_tokens shape)', () => {
      expect(getThinkingParams('high', 'claude-fable-5-1', { maxTokens: 900 })).toEqual({
        output_config: { effort: 'high' },
      });
    });
  });

  describe('Anthropic Opus/Sonnet 5.x and Opus 4.7/4.8 (adaptive-only, full effort range)', () => {
    it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5'])(
      'level low/medium/high map straight through to effort for %s',
      (model) => {
        expect(getThinkingParams('low', model)).toEqual({
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
        });
        expect(getThinkingParams('medium', model)).toEqual({
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
        });
        expect(getThinkingParams('high', model)).toEqual({
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
        });
      },
    );

    it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5'])(
      'xhigh maps to the xhigh effort tier for %s, never escalating to max',
      (model) => {
        expect(getThinkingParams('xhigh', model)).toEqual({
          thinking: { type: 'adaptive' },
          output_config: { effort: 'xhigh' },
        });
      },
    );

    it('keeps minimal turns on the provider default path', () => {
      expect(getThinkingParams('minimal', 'claude-opus-5')).toEqual({});
    });

    it('ignores maxTokens because adaptive thinking uses max_tokens as a hard cap', () => {
      expect(getThinkingParams('high', 'claude-opus-5', { maxTokens: 900 })).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    });
  });

  describe('degrading an unsupported effort level to the nearest one the model supports', () => {
    it('degrades a level requesting an effort tier the model does not have, instead of dropping or rejecting it', () => {
      // claude-haiku-4-5 supports no effort tiers at all (pre-4.6, legacy budget_tokens
      // path) — the level must still resolve to a valid, non-empty request rather than
      // silently vanishing or sending an unsupported effort value.
      const result = getThinkingParams('xhigh', 'claude-haiku-4-5');
      expect(result.output_config).toBeUndefined();
      expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 65536 });
    });

    it('never sends a bare, unmapped ThinkingLevel string as an effort value', () => {
      for (const model of ['claude-sonnet-4-6', 'claude-opus-5', 'claude-fable-5-1']) {
        const result: any = getThinkingParams('xhigh', model);
        const effort = result.output_config?.effort;
        if (effort !== undefined) {
          expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(effort);
        }
      }
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

    it('supports hosted Anthropic model namespaces', () => {
      expect(getThinkingParams('high', 'anthropic/claude-sonnet-4-5')).toEqual({
        thinking: { type: 'enabled', budget_tokens: 32768 },
      });
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

    it('supports hosted OpenAI model namespaces', () => {
      expect(getThinkingParams('high', 'openai/o3-mini')).toEqual({
        reasoning_effort: 'high',
      });
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

    it('supports hosted Gemini model namespaces', () => {
      expect(getThinkingParams('off', 'google/gemini-2.5-pro')).toEqual({
        thinking: { thinkingBudget: 128 },
      });
      expect(getThinkingParams('medium', 'google/gemini-3.1-pro-preview')).toEqual({
        thinking: { thinkingLevel: 'medium' },
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
