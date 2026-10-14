// ---------------------------------------------------------------------------
// Tests — Thinking Level Control
// ---------------------------------------------------------------------------

import { getThinkingParams, ThinkingLevel } from '../../src/engine/thinking';
import { inferOpenAIReasoningCapability } from '../../src/services/llm/catalog/providerCapabilities';

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

  // Claude's thinking follows what Anthropic's models API declares for each model (live
  // declarations, 2026-10-15), not rules read from the model id.
  describe('Claude models, from their declared thinking modes and efforts', () => {
    const FULL = ['low', 'medium', 'high', 'xhigh', 'max'];
    const declared = {
      // Sonnet 5.5, Opus 5.5, Fable 5.1: always thinks.
      adaptiveOnly: { mandatory: true, supportedEfforts: FULL, thinkingModes: ['adaptive'] },
      // Haiku 5.5, Sonnet 5: thinks by default, can be turned off.
      adaptiveOrOff: {
        mandatory: false,
        supportedEfforts: FULL,
        thinkingModes: ['adaptive', 'disabled'],
      },
      // Opus 4.6, Sonnet 4.6: no xhigh tier.
      withManual: {
        mandatory: false,
        supportedEfforts: ['low', 'medium', 'high', 'max'],
        thinkingModes: ['enabled', 'adaptive', 'disabled'],
      },
      // Haiku 4.5: manual thinking only, no effort control.
      manualOnly: {
        mandatory: false,
        supportedEfforts: [],
        thinkingModes: ['enabled', 'disabled'],
      },
    };
    const params = (
      level: ThinkingLevel,
      capability: (typeof declared)[keyof typeof declared],
      maxTokens?: number,
    ) =>
      getThinkingParams(level, 'claude-model', {
        reasoningCapability: capability,
        ...(maxTokens ? { maxTokens } : {}),
      });

    it('asks for adaptive thinking at the nearest declared effort', () => {
      expect(params('low', declared.adaptiveOnly)).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
      });
      expect(params('minimal', declared.adaptiveOnly)).toMatchObject({
        output_config: { effort: 'low' },
      });
      expect(params('high', declared.adaptiveOrOff)).toMatchObject({
        output_config: { effort: 'high' },
      });
      expect(params('xhigh', declared.adaptiveOnly)).toMatchObject({
        output_config: { effort: 'xhigh' },
      });
      // No xhigh tier: the strongest chip asks for the model's ceiling.
      expect(params('xhigh', declared.withManual)).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'max' },
      });
    });

    it('turns thinking off where the model can, and runs a model that cannot at its least', () => {
      expect(params('off', declared.adaptiveOrOff)).toEqual({ thinking: { type: 'disabled' } });
      expect(params('off', declared.manualOnly)).toEqual({ thinking: { type: 'disabled' } });
      expect(params('off', declared.adaptiveOnly)).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
      });
    });

    it('asks a manual-only model for a thinking budget that fits max_tokens', () => {
      expect(params('medium', declared.manualOnly)).toEqual({
        thinking: { type: 'enabled', budget_tokens: 8192 },
      });
      expect(params('high', declared.manualOnly, 10_000)).toEqual({
        thinking: { type: 'enabled', budget_tokens: 8192 },
      });
      expect(params('high', declared.manualOnly, 900)).toEqual({});
    });

    it('asks a Claude model nothing until its thinking modes are known', () => {
      for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
        expect(getThinkingParams('high', model)).toEqual({});
        expect(getThinkingParams('off', model)).toEqual({});
      }
    });
  });

  describe('OpenAI reasoning models (efforts read from the generation)', () => {
    const openAI = (level: ThinkingLevel, model: string) =>
      getThinkingParams(level, model, {
        reasoningCapability: inferOpenAIReasoningCapability(model),
      });

    it.each(['o1-preview', 'o3-mini', 'o4-mini', 'gpt-5.4', 'openai/o3-mini', 'gpt-6-astra'])(
      'asks %s for the effort its level names',
      (model) => {
        expect(openAI('low', model)).toEqual({ reasoning_effort: 'low' });
        expect(openAI('high', model)).toEqual({ reasoning_effort: 'high' });
      },
    );

    it('reaches xhigh on GPT-6; earlier reasoning models stop at high', () => {
      expect(openAI('xhigh', 'gpt-6.1-sol')).toEqual({ reasoning_effort: 'xhigh' });
      expect(openAI('xhigh', 'gpt-5.5')).toEqual({ reasoning_effort: 'high' });
      expect(openAI('xhigh', 'o4-mini')).toEqual({ reasoning_effort: 'high' });
    });

    it('asks for the least effort the model accepts when thinking is off or minimal', () => {
      // GPT-6 Astra and 6.1 Sol reject `none`; every GPT-6 model rejects `minimal`.
      expect(openAI('off', 'gpt-6-astra')).toEqual({ reasoning_effort: 'low' });
      expect(openAI('minimal', 'gpt-6-luna')).toEqual({ reasoning_effort: 'low' });
    });

    it('treats GPT before 5, image models and open-weight ids as non-reasoning', () => {
      expect(inferOpenAIReasoningCapability('gpt-4.1')).toBeUndefined();
      expect(inferOpenAIReasoningCapability('gpt-image-2')).toBeUndefined();
      expect(inferOpenAIReasoningCapability('openai/gpt-oss-120b')).toBeUndefined();
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
