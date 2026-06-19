// ---------------------------------------------------------------------------
// Usage Tracker — tests
// ---------------------------------------------------------------------------

import {
  normalizeUsage,
  estimateCost,
  getUsageCacheSummary,
  recordUsage,
  getSessionUsage,
  formatUsageReport,
  clearUsageData,
  getTotalUsage,
} from '../../src/services/usage/tracker';

describe('Usage Tracker', () => {
  beforeEach(() => {
    clearUsageData();
  });

  describe('normalizeUsage', () => {
    it('normalizes OpenAI-style usage', () => {
      const result = normalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(100);
      expect(result!.outputTokens).toBe(50);
    });

    it('normalizes Anthropic-style usage', () => {
      const result = normalizeUsage({ input_tokens: 200, output_tokens: 100 });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(200);
      expect(result!.outputTokens).toBe(100);
    });

    it('normalizes cached tokens from OpenAI Responses usage details', () => {
      const result = normalizeUsage({
        input_tokens: 200,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 80 },
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(200);
      expect(result!.outputTokens).toBe(100);
      expect(result!.cacheReadTokens).toBe(80);
    });

    it('does not double count cached tokens when prompt totals are already explicit', () => {
      const result = normalizeUsage({
        prompt_tokens: 200,
        completion_tokens: 100,
        cache_read_input_tokens: 80,
        prompt_tokens_details: { cached_tokens: 80 },
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(200);
      expect(result!.outputTokens).toBe(100);
      expect(result!.cacheReadTokens).toBe(80);
      expect(result!.totalTokens).toBe(300);
    });

    it('sums Anthropic cache fields into total effective input tokens', () => {
      const result = normalizeUsage({
        input_tokens: 50,
        output_tokens: 20,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(1000);
      expect(result!.outputTokens).toBe(20);
      expect(result!.cacheReadTokens).toBe(900);
      expect(result!.cacheWriteTokens).toBe(50);
      expect(result!.totalTokens).toBe(1020);
    });

    it('normalizes OpenRouter cache write tokens from prompt token details', () => {
      const result = normalizeUsage({
        prompt_tokens: 320,
        completion_tokens: 40,
        total_tokens: 360,
        prompt_tokens_details: {
          cached_tokens: 200,
          cache_write_tokens: 60,
        },
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(320);
      expect(result!.outputTokens).toBe(40);
      expect(result!.cacheReadTokens).toBe(200);
      expect(result!.cacheWriteTokens).toBe(60);
      expect(result!.totalTokens).toBe(360);
    });

    it('normalizes Gemini usage metadata field names', () => {
      const result = normalizeUsage({
        usageMetadata: {
          promptTokenCount: 240,
          cachedContentTokenCount: 200,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 5,
          totalTokenCount: 275,
        },
      });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(240);
      expect(result!.outputTokens).toBe(35);
      expect(result!.cacheReadTokens).toBe(200);
      expect(result!.totalTokens).toBe(275);
    });

    it('preserves OpenAI image token details for modality-aware pricing', () => {
      const result = normalizeUsage({
        input_tokens: 320,
        output_tokens: 960,
        total_tokens: 1280,
        input_tokens_details: {
          text_tokens: 120,
          image_tokens: 200,
        },
        output_tokens_details: {
          image_tokens: 960,
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          inputTokens: 320,
          outputTokens: 960,
          totalTokens: 1280,
          tokenDetails: {
            inputTextTokens: 120,
            inputImageTokens: 200,
            outputImageTokens: 960,
          },
        }),
      );
    });

    it('preserves Gemini image and thinking token details for modality-aware pricing', () => {
      const result = normalizeUsage({
        promptTokenCount: 200,
        candidatesTokenCount: 1120,
        thoughtsTokenCount: 40,
        totalTokenCount: 1360,
        promptTokensDetails: [
          { modality: 'TEXT', tokenCount: 80 },
          { modality: 'IMAGE', tokenCount: 120 },
        ],
        candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
      });

      expect(result).toEqual(
        expect.objectContaining({
          inputTokens: 200,
          outputTokens: 1160,
          totalTokens: 1360,
          tokenDetails: {
            inputTextTokens: 80,
            inputImageTokens: 120,
            outputImageTokens: 1120,
            outputThinkingTokens: 40,
          },
        }),
      );
    });

    it('handles missing fields', () => {
      const result = normalizeUsage({});
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(0);
      expect(result!.outputTokens).toBe(0);
    });

    it('returns undefined for undefined input', () => {
      const result = normalizeUsage(undefined);
      expect(result).toBeUndefined();
    });

    it('normalizes camelCase field names', () => {
      const result = normalizeUsage({ promptTokens: 50, completionTokens: 25 });
      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(50);
      expect(result!.outputTokens).toBe(25);
    });
  });

  describe('estimateCost', () => {
    it('estimates cost for GPT-5.4', () => {
      const cost = estimateCost('gpt-5.4', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('estimates cost for Claude', () => {
      const cost = estimateCost('claude-sonnet-4-6', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('estimates cost for newly listed model revisions', () => {
      const openAiCost = estimateCost('gpt-5.5', 1000, 500);
      const anthropicCost = estimateCost('claude-opus-4-7', 1000, 500);
      expect(openAiCost).toBeGreaterThan(0);
      expect(anthropicCost).toBeGreaterThan(0);
    });

    it('uses Gemini 2.5 Pro standard pricing for prompts at or below 200k tokens', () => {
      const cost = estimateCost('gemini-2.5-pro', 1000, 500);
      expect(cost).toBeCloseTo((1000 * 1.25 + 500 * 10) / 1_000_000, 10);
    });

    it('uses Gemini 3.1 Pro large-prompt pricing above 200k tokens', () => {
      const cost = estimateCost('google/gemini-3.1-pro-preview', 250_000, 10_000);
      expect(cost).toBeCloseTo((250_000 * 4 + 10_000 * 18) / 1_000_000, 10);
    });

    it('uses Gemini 3.5 Flash pricing for current stable flash model', () => {
      const cost = estimateCost('google/gemini-3.5-flash', 250_000, 10_000);
      expect(cost).toBeCloseTo((250_000 * 1.5 + 10_000 * 9) / 1_000_000, 10);
    });

    it('discounts Gemini cached tokens instead of billing them at the full input rate', () => {
      const cost = estimateCost('gemini-2.5-flash', 1000, 500, { cacheReadTokens: 800 });
      expect(cost).toBeCloseTo(((1000 - 800) * 0.3 + 800 * 0.03 + 500 * 2.5) / 1_000_000, 10);
    });

    it('uses default cost for unknown model', () => {
      const cost = estimateCost('unknown-model', 1000, 500);
      // Default: $1/1M input + $3/1M output
      expect(cost).toBeGreaterThan(0);
    });

    it('uses OpenAI GPT Image modality pricing when token details are available', () => {
      const cost = estimateCost('gpt-image-2', 320, 960, {
        tokenDetails: {
          inputTextTokens: 120,
          inputImageTokens: 200,
          outputImageTokens: 960,
        },
      });

      expect(cost).toBeCloseTo((120 * 5 + 200 * 8 + 960 * 32) / 1_000_000, 10);
    });

    it('uses Gemini image pricing and bills thinking tokens at the text-output rate', () => {
      const cost = estimateCost('gemini-3.1-flash-image', 200, 1160, {
        tokenDetails: {
          inputTextTokens: 80,
          inputImageTokens: 120,
          outputImageTokens: 1120,
          outputThinkingTokens: 40,
        },
      });

      expect(cost).toBeCloseTo((80 * 0.5 + 120 * 0.5 + 1120 * 60 + 40 * 3) / 1_000_000, 10);
    });

    it('returns 0 for zero tokens', () => {
      const cost = estimateCost('gpt-5.4', 0, 0);
      expect(cost).toBe(0);
    });

    it('returns zero cost for on-device Gemma catalog models', () => {
      const cost = estimateCost('gemma-4-E2B-it', 12_000, 2_000);
      expect(cost).toBe(0);
    });
  });

  describe('getUsageCacheSummary', () => {
    it('uses total input as the cache denominator', () => {
      const summary = getUsageCacheSummary({
        inputTokens: 1000,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
      });
      expect(summary).toEqual({
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
        cacheDenominatorTokens: 1000,
      });
    });

    it('guards against impossible provider data by never returning a zero denominator when cache exists', () => {
      const summary = getUsageCacheSummary({
        inputTokens: 0,
        cacheReadTokens: 120,
        cacheWriteTokens: 30,
      });
      expect(summary).toEqual({
        cacheReadTokens: 120,
        cacheWriteTokens: 30,
        cacheDenominatorTokens: 120,
      });
    });
  });

  describe('recordUsage / getSessionUsage', () => {
    it('records and retrieves usage', () => {
      recordUsage('conv-1', { inputTokens: 100, outputTokens: 50, model: 'gpt-5.4' });
      const usage = getSessionUsage('conv-1');
      expect(usage).toBeDefined();
      expect(usage!.totalInput).toBe(100);
      expect(usage!.totalOutput).toBe(50);
      expect(usage!.entries).toHaveLength(1);
    });

    it('preserves token bucket and prompt-cache telemetry on session entries', () => {
      recordUsage('conv-telemetry', {
        inputTokens: 1200,
        outputTokens: 50,
        model: 'gpt-5.4',
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: {
          eligible: true,
          enabled: true,
          estimatedInputTokens: 1200,
          thresholdTokens: 1024,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'provider_managed',
          reason: 'automatic_prompt_cache',
          explicitCacheName: 'cm:test',
        },
      });

      expect(getSessionUsage('conv-telemetry')?.entries[0]).toMatchObject({
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: {
          eligible: true,
          mode: 'openai_native',
          event: 'provider_managed',
          explicitCacheName: 'cm:test',
        },
      });
    });

    it('accumulates multiple recordings', () => {
      recordUsage('conv-1', { inputTokens: 100, outputTokens: 50, model: 'gpt-5.4' });
      recordUsage('conv-1', { inputTokens: 200, outputTokens: 100, model: 'gpt-5.4' });
      const usage = getSessionUsage('conv-1');
      expect(usage!.totalInput).toBe(300);
      expect(usage!.totalOutput).toBe(150);
      expect(usage!.entries).toHaveLength(2);
    });

    it('returns undefined for unknown conversation', () => {
      const usage = getSessionUsage('nonexistent');
      expect(usage).toBeUndefined();
    });

    it('tracks separate conversations', () => {
      recordUsage('conv-1', { inputTokens: 100, outputTokens: 50, model: 'gpt-5.4' });
      recordUsage('conv-2', { inputTokens: 200, outputTokens: 100, model: 'claude-sonnet-4-6' });
      expect(getSessionUsage('conv-1')!.totalInput).toBe(100);
      expect(getSessionUsage('conv-2')!.totalInput).toBe(200);
    });

    it('keeps on-device session totals at zero cost', () => {
      recordUsage('conv-local', { inputTokens: 800, outputTokens: 120, model: 'gemma-4-E2B-it' });
      const usage = getSessionUsage('conv-local');
      expect(usage?.totalCost).toBe(0);
      expect(usage?.entries[0]?.estimatedCost).toBe(0);
    });
  });

  describe('formatUsageReport', () => {
    it('returns report when no usage', () => {
      const report = formatUsageReport();
      expect(report).toContain('Usage');
      expect(report).toContain('0');
    });

    it('formats recorded usage for a session', () => {
      recordUsage('conv-1', { inputTokens: 1000, outputTokens: 500, model: 'gpt-5.4' });
      const report = formatUsageReport('conv-1');
      expect(report).toContain('1,000');
      expect(report).toContain('500');
    });

    it('includes cost estimate', () => {
      recordUsage('conv-1', { inputTokens: 10000, outputTokens: 5000, model: 'gpt-5.4' });
      const report = formatUsageReport('conv-1');
      expect(report).toContain('$');
    });
  });

  describe('clearUsageData', () => {
    it('clears all recorded usage', () => {
      recordUsage('conv-1', { inputTokens: 100, outputTokens: 50, model: 'gpt-5.4' });
      clearUsageData();
      const usage = getSessionUsage('conv-1');
      expect(usage).toBeUndefined();
    });
  });

  describe('getTotalUsage', () => {
    it('sums across all sessions', () => {
      recordUsage('c1', { inputTokens: 100, outputTokens: 50, model: 'gpt-5.4' });
      recordUsage('c2', { inputTokens: 200, outputTokens: 100, model: 'gpt-5.4' });
      const total = getTotalUsage();
      expect(total.totalInput).toBe(300);
      expect(total.totalOutput).toBe(150);
      expect(total.totalCost).toBeGreaterThan(0);
    });
  });
});
