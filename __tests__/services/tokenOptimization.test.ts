// ---------------------------------------------------------------------------
// Tests — Token Optimization Helpers
// ---------------------------------------------------------------------------

import {
  buildPromptCachingPlan,
  buildPromptCacheKey,
  normalizeOpenAIPromptCacheKey,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
  planIterationModel,
  resolveFinalizationMaxTokens,
  resolveSubAgentMaxTokens,
  shouldEnablePromptCaching,
} from '../../src/services/context/tokenOptimization';
import type { LlmProviderConfig } from '../../src/types';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
    ...overrides,
  };
}

describe('buildPromptCacheKey', () => {
  it('stays stable when the static prefix changes slightly within a conversation', () => {
    const baseArgs = {
      conversationId: 'conv-123',
      providerId: 'openai',
      model: 'gpt-5.4',
    };

    const first = buildPromptCacheKey({
      ...baseArgs,
      systemPrompt: 'System prompt v1',
      tools: [
        {
          name: 'read_file',
          description: 'Read a file.',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    });
    const second = buildPromptCacheKey({
      ...baseArgs,
      systemPrompt: 'System prompt v2 with extra guidance',
      tools: [
        {
          name: 'read_file',
          description: 'Read a file from disk with more detail.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
        },
      ],
    });

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
  });

  it('stays stable across provider and model changes within the same conversation', () => {
    const baseArgs = {
      conversationId: 'sub-1743476400000-mchsvm1f_abc123_7',
      systemPrompt: 'System prompt v1',
      tools: [],
    };

    const primary = buildPromptCacheKey({
      ...baseArgs,
      providerId: 'openai',
      model: 'gpt-5.4',
    });
    const economy = buildPromptCacheKey({
      ...baseArgs,
      providerId: 'openai-enterprise-production',
      model: 'gpt-5.1-codex-mini',
    });

    expect(primary).toBe(economy);
  });

  it('keeps sub-agent style session keys within OpenAI limits', () => {
    const key = buildPromptCacheKey({
      conversationId: 'sub-1743476400000-mchsvm1f_abc123_7-very-long-session-segment',
      providerId: 'openai-enterprise-production',
      model: 'gpt-5.1-codex-mini',
      systemPrompt: 'System prompt',
      tools: [],
    });

    expect(key).toMatch(/^cm:/);
    expect(key.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
  });
});

describe('normalizeOpenAIPromptCacheKey', () => {
  it('deterministically compacts oversized manual keys', () => {
    const rawKey =
      'cm:openai-enterprise-production:gpt-5.1-codex-mini:sub-1743476400000-mchsvm1f_abc123_7';

    const first = normalizeOpenAIPromptCacheKey(rawKey);
    const second = normalizeOpenAIPromptCacheKey(rawKey);

    expect(first).toBe(second);
    expect(first).toBeDefined();
    expect(first).not.toBe(rawKey);
    expect(first!.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
  });
});

describe('shouldEnablePromptCaching', () => {
  it('uses the OpenAI 1024-token floor', () => {
    expect(shouldEnablePromptCaching('gpt-5.4', 1023, 'openai')).toBe(false);
    expect(shouldEnablePromptCaching('gpt-5.4', 1024, 'openai')).toBe(true);
  });

  it('uses Gemini documented minimum token floors for cache-aware prompt shaping', () => {
    expect(shouldEnablePromptCaching('gemini-3-flash-preview', 1023, 'gemini-vertex')).toBe(false);
    expect(shouldEnablePromptCaching('gemini-3-flash-preview', 1024, 'gemini-vertex')).toBe(true);
    expect(shouldEnablePromptCaching('gemini-3.1-pro-preview', 4095, 'gemini-vertex')).toBe(false);
    expect(shouldEnablePromptCaching('gemini-3.1-pro-preview', 4096, 'gemini-vertex')).toBe(true);
    expect(shouldEnablePromptCaching('gemini-2.5-flash', 1023, 'gemini-vertex')).toBe(false);
    expect(shouldEnablePromptCaching('gemini-2.5-flash', 1024, 'gemini-vertex')).toBe(true);
    expect(shouldEnablePromptCaching('gemini-2.5-pro', 4095, 'gemini-vertex')).toBe(false);
    expect(shouldEnablePromptCaching('gemini-2.5-pro', 4096, 'gemini-vertex')).toBe(true);
  });

  it('uses the Anthropic Sonnet 4.6 2048-token floor', () => {
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2047, 'anthropic')).toBe(false);
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2048, 'anthropic')).toBe(true);
  });

  it('uses the Anthropic Opus 4.6 and Haiku 4.5 4096-token floor', () => {
    expect(shouldEnablePromptCaching('claude-opus-4-6', 4095, 'anthropic')).toBe(false);
    expect(shouldEnablePromptCaching('claude-opus-4-6', 4096, 'anthropic')).toBe(true);
    expect(shouldEnablePromptCaching('claude-haiku-4-5', 4095, 'anthropic')).toBe(false);
    expect(shouldEnablePromptCaching('claude-haiku-4-5', 4096, 'anthropic')).toBe(true);
  });
});

describe('buildPromptCachingPlan', () => {
  it('builds a stable prompt_cache_key for OpenAI', () => {
    const args = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-1',
      systemPrompt: 'System',
      tools: [],
    };

    const plan = buildPromptCachingPlan(args);

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBe(buildPromptCacheKey(args));
    expect(plan.promptCacheKey!.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
  });

  it('enables Anthropic prompt caching without synthesizing an OpenAI-style key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }),
      model: 'claude-sonnet-4-6',
      estimatedInputTokens: 3000,
      conversationId: 'conv-2',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
  });

  it('enables cache-aware Gemini prompt shaping without synthesizing a generic cache key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }),
      model: 'gemini-3-flash-preview',
      estimatedInputTokens: 5000,
      conversationId: 'conv-3',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
  });

  it('enables cache-aware Vertex Gemini prompt shaping without synthesizing a generic cache key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'gemini-vertex',
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        apiKey: 'AIza-vertex',
        model: 'gemini-3-flash-preview',
      }),
      model: 'gemini-3-flash-preview',
      estimatedInputTokens: 5000,
      conversationId: 'conv-vertex',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
  });
});

describe('resolveSubAgentMaxTokens', () => {
  it('gives reasoning-heavy worker models a larger ceiling', () => {
    expect(resolveSubAgentMaxTokens('gpt-5.4')).toBe(16384);
    expect(resolveSubAgentMaxTokens('claude-sonnet-4-6')).toBe(16384);
  });

  it('keeps smaller-context models inside safe output reserves', () => {
    expect(resolveSubAgentMaxTokens('phi4')).toBe(8192);
  });
});

describe('resolveFinalizationMaxTokens', () => {
  it('raises finalization budgets for reasoning-heavy models', () => {
    expect(resolveFinalizationMaxTokens('gpt-5.4')).toBe(8192);
    expect(resolveFinalizationMaxTokens('claude-sonnet-4-6')).toBe(8192);
  });

  it('keeps simpler models on a moderate finalization budget', () => {
    expect(resolveFinalizationMaxTokens('phi4')).toBe(4096);
  });
});

describe('planIterationModel', () => {
  it('protects actionable turns with a larger planning floor', () => {
    const plan = planIterationModel({
      provider: makeProvider(),
      primaryModel: 'gpt-5.4',
      iteration: 1,
      maxTokens: 16384,
      actionableRequest: true,
      hasRecentToolMessages: false,
      hasAttachments: false,
      thinkingLevel: 'medium',
    });

    expect(plan.maxTokens).toBe(8192);
    expect(plan.reason).toBe('actionable-request-capped-output');
  });

  it('keeps sub-agent actionable turns at their larger worker budget', () => {
    const plan = planIterationModel({
      provider: makeProvider(),
      primaryModel: 'gpt-5.4',
      iteration: 1,
      maxTokens: resolveSubAgentMaxTokens('gpt-5.4'),
      actionableRequest: true,
      hasRecentToolMessages: false,
      hasAttachments: false,
      thinkingLevel: 'medium',
      responseBudgetProfile: 'sub-agent',
    });

    expect(plan.maxTokens).toBe(12288);
    expect(plan.reason).toBe('actionable-request-capped-output');
  });

  it('protects tool-follow-up turns even after the first iteration', () => {
    const plan = planIterationModel({
      provider: makeProvider(),
      primaryModel: 'gpt-5.4',
      iteration: 2,
      maxTokens: 16384,
      actionableRequest: false,
      hasRecentToolMessages: true,
      hasAttachments: false,
      thinkingLevel: 'low',
    });

    expect(plan.maxTokens).toBe(8192);
  });

  it('keeps the requested primary model on tool follow-up turns by default', () => {
    const plan = planIterationModel({
      provider: makeProvider({
        model: 'gpt-5.4-mini',
        availableModels: ['gpt-5.4-mini'],
      }),
      primaryModel: 'gpt-5.4',
      iteration: 2,
      maxTokens: 16384,
      actionableRequest: false,
      hasRecentToolMessages: true,
      hasAttachments: false,
      thinkingLevel: 'low',
    });

    expect(plan.model).toBe('gpt-5.4');
    expect(plan.reason).toBe('tool-follow-up-primary-model');
  });

  it('only routes tool follow-up turns onto an economy model when explicitly allowed', () => {
    const plan = planIterationModel({
      provider: makeProvider({
        model: 'gpt-5.4-mini',
        availableModels: ['gpt-5.4-mini'],
      }),
      primaryModel: 'gpt-5.4',
      allowModelDowngrade: true,
      iteration: 2,
      maxTokens: 16384,
      actionableRequest: false,
      hasRecentToolMessages: true,
      hasAttachments: false,
      thinkingLevel: 'low',
    });

    expect(plan.model).toBe('gpt-5.4-mini');
    expect(plan.reason).toBe('tool-follow-up-economy-model');
  });

  it('clamps expanded sub-agent budgets for smaller-context models', () => {
    const plan = planIterationModel({
      provider: makeProvider({ model: 'phi4' }),
      primaryModel: 'phi4',
      iteration: 1,
      maxTokens: resolveSubAgentMaxTokens('phi4'),
      actionableRequest: true,
      hasRecentToolMessages: false,
      hasAttachments: false,
      thinkingLevel: 'medium',
      responseBudgetProfile: 'sub-agent',
    });

    expect(plan.maxTokens).toBe(8192);
  });
});
