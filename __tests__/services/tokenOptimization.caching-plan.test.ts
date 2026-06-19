import { buildPromptCachingPlan, buildPromptCacheKey, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, planIterationModel, resolveFinalizationMaxTokens, resolveSubAgentMaxTokens } from '../../src/services/context/tokenOptimization';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { ToolDefinition } from '../../src/types/tool';
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
function tool(name: string, description = `${name} tool`): ToolDefinition {
  return {
    name,
    description,
    input_schema: { type: 'object', properties: {} },
  };
}

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
    expect(plan.telemetry).toMatchObject({
      eligible: true,
      enabled: true,
      estimatedInputTokens: 2048,
      thresholdTokens: 1024,
      providerFamily: 'openai',
      hostedFamily: 'openai',
      mode: 'openai_native',
      event: 'provider_managed',
      reason: 'automatic_prompt_cache',
      explicitCacheName: plan.promptCacheKey,
      stableSystemPromptDigest: expect.stringMatching(/^system-prompt-fnv1a32:[0-9a-f]{16}$/),
      stableToolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      cacheablePrefixDigest: expect.stringMatching(/^prompt-prefix-fnv1a32:[0-9a-f]{16}$/),
      toolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      prefixDivergenceReason: 'no_tools',
    });
  });

  it('enables Anthropic prompt caching without synthesizing an OpenAI-style key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        providerFamily: 'anthropic',
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
    expect(plan.telemetry).toMatchObject({
      eligible: true,
      enabled: true,
      estimatedInputTokens: 3000,
      thresholdTokens: 2048,
      providerFamily: 'anthropic',
      hostedFamily: 'anthropic',
      mode: 'anthropic_native',
      event: 'provider_managed',
      reason: 'cache_control_breakpoints',
    });
  });

  it('enables cache-aware Gemini prompt shaping without synthesizing a generic cache key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'gemini',
        name: 'Gemini',
        providerFamily: 'gemini',
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
    expect(plan.telemetry).toMatchObject({
      eligible: true,
      enabled: true,
      estimatedInputTokens: 5000,
      thresholdTokens: 4096,
      providerFamily: 'gemini',
      hostedFamily: 'gemini',
      mode: 'gemini_native',
      event: 'provider_managed',
      reason: 'managed_or_implicit_cache',
      stableSystemPromptDigest: expect.stringMatching(/^system-prompt-fnv1a32:[0-9a-f]{16}$/),
      stableToolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      cacheablePrefixDigest: expect.stringMatching(/^prompt-prefix-fnv1a32:[0-9a-f]{16}$/),
      toolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      prefixDivergenceReason: 'no_tools',
    });
  });

  it('reports cache-prefix shape for Gemini mobile-native tools without explicit cache handles', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'gemini',
        name: 'Gemini',
        providerFamily: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }),
      model: 'gemini-3-flash-preview',
      estimatedInputTokens: 5000,
      conversationId: 'conv-gemini-mobile-cache',
      systemPrompt: 'Stable mobile assistant system prefix',
      tools: [tool('browser_navigate'), tool('calendar_list'), tool('sms_compose')],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
    expect(plan.telemetry).toMatchObject({
      providerFamily: 'gemini',
      hostedFamily: 'gemini',
      mode: 'gemini_native',
      event: 'provider_managed',
      reason: 'managed_or_implicit_cache',
      stableSystemPromptDigest: expect.stringMatching(/^system-prompt-fnv1a32:[0-9a-f]{16}$/),
      stableToolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      cacheablePrefixDigest: expect.stringMatching(/^prompt-prefix-fnv1a32:[0-9a-f]{16}$/),
      toolDeclarationDigest: expect.stringMatching(/^tools-fnv1a32:[0-9a-f]{8}$/),
      prefixDivergenceReason: 'fully_stable_prefix',
    });
  });

  it('keeps the stable prefix digest invariant when stable core tools arrive in different order', () => {
    const first = buildPromptCachingPlan({
      provider: makeProvider(),
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-stable-tool-order',
      systemPrompt: 'Stable assistant system prefix',
      tools: [tool('tool_catalog'), tool('write_file'), tool('read_file')],
    });
    const second = buildPromptCachingPlan({
      provider: makeProvider(),
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-stable-tool-order',
      systemPrompt: 'Stable assistant system prefix',
      tools: [tool('read_file'), tool('tool_catalog'), tool('write_file')],
    });

    expect(first.telemetry.stableSystemPromptDigest).toBe(
      second.telemetry.stableSystemPromptDigest,
    );
    expect(first.telemetry.stableToolDeclarationDigest).toBe(
      second.telemetry.stableToolDeclarationDigest,
    );
    expect(first.telemetry.cacheablePrefixDigest).toBe(second.telemetry.cacheablePrefixDigest);
  });

  it('keeps the OpenAI routing key stable while reporting changed cacheable prefixes', () => {
    const provider = makeProvider();
    const baseArgs = {
      provider,
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-prefix-telemetry',
    };
    const first = buildPromptCachingPlan({
      ...baseArgs,
      systemPrompt: 'Stable system prefix',
      stableSystemPrompt: 'Stable system prefix',
      tools: [tool('tool_catalog'), tool('calendar_list')],
    });
    const second = buildPromptCachingPlan({
      ...baseArgs,
      systemPrompt: 'Stable system prefix\nDynamic turn-specific focus',
      stableSystemPrompt: 'Stable system prefix',
      tools: [tool('tool_catalog'), tool('sms_compose')],
    });
    const changedStableSystem = buildPromptCachingPlan({
      ...baseArgs,
      systemPrompt: 'Updated stable system prefix',
      stableSystemPrompt: 'Updated stable system prefix',
      tools: [tool('tool_catalog'), tool('sms_compose')],
    });

    expect(first.promptCacheKey).toBe(second.promptCacheKey);
    expect(second.promptCacheKey).toBe(changedStableSystem.promptCacheKey);
    expect(first.telemetry.stableSystemPromptDigest).toBe(
      second.telemetry.stableSystemPromptDigest,
    );
    expect(first.telemetry.cacheablePrefixDigest).not.toBe(second.telemetry.cacheablePrefixDigest);
    expect(second.telemetry.stableSystemPromptDigest).not.toBe(
      changedStableSystem.telemetry.stableSystemPromptDigest,
    );
    expect(second.telemetry.cacheablePrefixDigest).not.toBe(
      changedStableSystem.telemetry.cacheablePrefixDigest,
    );
  });

  it('keeps cacheable prefix telemetry stable when only graph-marked dynamic tools change', () => {
    const provider = makeProvider();
    const baseArgs = {
      provider,
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-dynamic-tool-suffix',
      systemPrompt: 'Stable system prefix',
      stableSystemPrompt: 'Stable system prefix',
    };
    const first = buildPromptCachingPlan({
      ...baseArgs,
      tools: [
        { ...tool('tool_catalog'), promptCache: { placement: 'stable_prefix' } },
        { ...tool('calendar_list'), promptCache: { placement: 'dynamic_suffix' } },
      ],
    });
    const second = buildPromptCachingPlan({
      ...baseArgs,
      tools: [
        { ...tool('tool_catalog'), promptCache: { placement: 'stable_prefix' } },
        { ...tool('sms_compose'), promptCache: { placement: 'dynamic_suffix' } },
      ],
    });

    expect(first.telemetry.stableToolDeclarationDigest).toBe(
      second.telemetry.stableToolDeclarationDigest,
    );
    expect(first.telemetry.cacheablePrefixDigest).toBe(second.telemetry.cacheablePrefixDigest);
    expect(first.telemetry.toolDeclarationDigest).not.toBe(
      second.telemetry.toolDeclarationDigest,
    );
    expect(first.telemetry.prefixDivergenceReason).toBe('stable_prefix_with_dynamic_suffix');
  });

  it('enables cache-aware Vertex Gemini prompt shaping without synthesizing a generic cache key', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'gemini-vertex',
        name: 'Gemini',
        providerFamily: 'gemini',
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
    expect(plan.telemetry).toMatchObject({
      providerFamily: 'gemini',
      hostedFamily: 'gemini',
      mode: 'gemini_native',
      thresholdTokens: 4096,
    });
  });

  it('enables OpenRouter-hosted Claude caching without synthesizing OpenAI cache keys', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'openrouter',
        name: 'OpenRouter',
        providerFamily: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
        model: 'anthropic/claude-sonnet-4-6',
      }),
      model: 'anthropic/claude-sonnet-4-6',
      estimatedInputTokens: 2048,
      conversationId: 'conv-openrouter-claude',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
    expect(plan.telemetry).toMatchObject({
      eligible: true,
      enabled: true,
      estimatedInputTokens: 2048,
      thresholdTokens: 2048,
      providerFamily: 'openrouter',
      hostedFamily: 'anthropic',
      mode: 'openrouter_compatible',
      event: 'provider_managed',
      reason: 'sticky_provider_cache',
    });
  });

  it('uses hosted-model floors for OpenRouter Gemini cache-aware planning', () => {
    const provider = makeProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      providerFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      model: 'google/gemini-2.5-pro',
    });

    const belowThresholdPlan = buildPromptCachingPlan({
      provider,
      model: 'google/gemini-2.5-pro',
      estimatedInputTokens: 2047,
      conversationId: 'conv-openrouter-gemini',
      systemPrompt: 'System',
      tools: [],
    });
    const eligiblePlan = buildPromptCachingPlan({
      provider,
      model: 'google/gemini-2.5-pro',
      estimatedInputTokens: 2048,
      conversationId: 'conv-openrouter-gemini',
      systemPrompt: 'System',
      tools: [],
    });

    expect(belowThresholdPlan).toMatchObject({
      enablePromptCaching: false,
      telemetry: {
        eligible: false,
        enabled: false,
        estimatedInputTokens: 2047,
        thresholdTokens: 2048,
        providerFamily: 'openrouter',
        hostedFamily: 'gemini',
        mode: 'openrouter_compatible',
        event: 'skip',
        reason: 'below_threshold',
      },
    });
    expect(eligiblePlan).toMatchObject({
      enablePromptCaching: true,
      telemetry: {
        eligible: true,
        enabled: true,
        estimatedInputTokens: 2048,
        thresholdTokens: 2048,
        providerFamily: 'openrouter',
        hostedFamily: 'gemini',
        mode: 'openrouter_compatible',
        event: 'provider_managed',
        reason: 'sticky_provider_cache',
      },
    });
  });

  it('honors explicit provider family metadata without rediscovering provider identity from names', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'custom-openai-compatible',
        name: 'Internal gateway',
        providerFamily: 'openai',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'gateway-key',
        model: 'gpt-5.4',
      }),
      model: 'gpt-5.4',
      estimatedInputTokens: 2048,
      conversationId: 'conv-provider-family-openai',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeDefined();
    expect(plan.telemetry).toMatchObject({
      providerFamily: 'openai',
      mode: 'openai_native',
      explicitCacheName: plan.promptCacheKey,
    });
  });

  it('falls back to the hosted model family for proxy providers with opaque names', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'corp-relay',
        name: 'Corporate Relay',
        providerFamily: 'custom',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'relay-key',
        model: 'gemini-3-flash-preview',
      }),
      model: 'gemini-3-flash-preview',
      estimatedInputTokens: 5000,
      conversationId: 'conv-provider-family-gemini-fallback',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan.enablePromptCaching).toBe(true);
    expect(plan.promptCacheKey).toBeUndefined();
    expect(plan.telemetry).toMatchObject({
      providerFamily: 'gemini',
      hostedFamily: 'gemini',
      mode: 'gemini_native',
    });
  });

  it('reports unsupported custom providers as explicit cache skips', () => {
    const plan = buildPromptCachingPlan({
      provider: makeProvider({
        id: 'opaque-local',
        name: 'Opaque Local',
        providerFamily: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'local-key',
        model: 'unknown-local-model',
      }),
      model: 'unknown-local-model',
      estimatedInputTokens: 5000,
      conversationId: 'conv-custom-provider',
      systemPrompt: 'System',
      tools: [],
    });

    expect(plan).toMatchObject({
      enablePromptCaching: false,
      telemetry: {
        eligible: true,
        enabled: false,
        estimatedInputTokens: 5000,
        thresholdTokens: 1024,
        providerFamily: 'custom',
        mode: 'unsupported',
        event: 'skip',
        reason: 'unsupported_provider',
      },
    });
  });
});

describe('resolveSubAgentMaxTokens', () => {
  it('uses the global model-output ceiling for frontier worker models', () => {
    expect(resolveSubAgentMaxTokens('gpt-5.4')).toBe(32000);
    expect(resolveSubAgentMaxTokens('claude-sonnet-4-6')).toBe(32000);
  });

  it('keeps smaller-context models inside safe output reserves', () => {
    expect(resolveSubAgentMaxTokens('phi4')).toBe(8192);
  });
});

describe('resolveFinalizationMaxTokens', () => {
  it('uses the global model-output ceiling for frontier models', () => {
    expect(resolveFinalizationMaxTokens('gpt-5.4')).toBe(32000);
    expect(resolveFinalizationMaxTokens('claude-sonnet-4-6')).toBe(32000);
  });

  it('clamps smaller-context models by context headroom', () => {
    expect(resolveFinalizationMaxTokens('phi4')).toBe(8192);
  });
});

describe('planIterationModel', () => {
  it('uses the requested ceiling for actionable turns when the model can support it', () => {
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

    expect(plan.maxTokens).toBe(16384);
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
    });

    expect(plan.maxTokens).toBe(32000);
    expect(plan.reason).toBe('actionable-request-capped-output');
  });

  it('uses the requested ceiling for tool-follow-up turns when the model can support it', () => {
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

    expect(plan.maxTokens).toBe(16384);
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

  it('keeps tool follow-up turns on the primary model even when a smaller sibling model exists', () => {
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
    });

    expect(plan.maxTokens).toBe(8192);
  });
});
