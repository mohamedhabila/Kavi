import { buildPromptCacheKey, normalizeOpenAIPromptCacheKey, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, shouldEnablePromptCaching } from '../../src/services/context/tokenOptimization';
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

describe('buildPromptCacheKey', () => {
  it('stays stable when provider-visible prefix material changes within a conversation', () => {
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

  it('stays stable when stable prefix material is unchanged', () => {
    const args = {
      conversationId: 'conv-123',
      providerId: 'openai',
      model: 'gpt-5.4',
      systemPrompt: 'Stable system prefix',
      tools: [
        {
          name: 'web_search',
          description: 'Search',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    };

    expect(buildPromptCacheKey(args)).toBe(buildPromptCacheKey(args));
  });

  it('is scoped to the conversation instead of dynamic system suffixes', () => {
    const baseArgs = {
      conversationId: 'conv-cache-prefix',
      providerId: 'openai',
      model: 'gpt-5.4',
      stableSystemPrompt: 'Stable assistant policy\nStable memory profile',
      tools: [tool('read_file')],
    };

    const first = buildPromptCacheKey({
      ...baseArgs,
      systemPrompt: 'Stable assistant policy\nStable memory profile\nDynamic focus turn A',
    });
    const second = buildPromptCacheKey({
      ...baseArgs,
      systemPrompt: 'Stable assistant policy\nStable memory profile\nDynamic focus turn B',
    });
    const stableChanged = buildPromptCacheKey({
      ...baseArgs,
      stableSystemPrompt: 'Stable assistant policy\nUpdated stable memory profile',
      systemPrompt: 'Stable assistant policy\nUpdated stable memory profile\nDynamic focus turn B',
    });

    expect(second).toBe(first);
    expect(stableChanged).toBe(first);
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

  it('keeps routing stable across provider-visible tool declaration changes', () => {
    const baseArgs = {
      conversationId: 'conv-mobile-cache',
      providerId: 'openai',
      model: 'gpt-5.4',
      systemPrompt: 'Stable system prefix',
    };

    const first = buildPromptCacheKey({
      ...baseArgs,
      tools: [tool('calendar_list'), tool('mcp__calendar__lookup')],
    });
    const dynamicSuffixChanged = buildPromptCacheKey({
      ...baseArgs,
      tools: [tool('calendar_list'), tool('mcp__calendar__search')],
    });
    const mobileDeclarationChanged = buildPromptCacheKey({
      ...baseArgs,
      tools: [
        tool('calendar_list', 'Changed dynamic calendar declaration'),
        tool('mcp__calendar__lookup'),
      ],
    });
    const coreDeclarationChanged = buildPromptCacheKey({
      ...baseArgs,
      tools: [
        tool('tool_catalog', 'Changed core catalog declaration'),
        tool('mcp__calendar__lookup'),
      ],
    });

    expect(dynamicSuffixChanged).toBe(first);
    expect(mobileDeclarationChanged).toBe(first);
    expect(coreDeclarationChanged).toBe(first);
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
    const provider = makeProvider({
      id: 'openai',
      name: 'OpenAI',
      providerFamily: 'openai',
    });
    expect(shouldEnablePromptCaching('gpt-5.4', 1023, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gpt-5.4', 1024, provider)).toBe(true);
  });

  it('uses Gemini documented minimum token floors for cache-aware prompt shaping', () => {
    const provider = makeProvider({
      id: 'gemini-vertex',
      name: 'Vertex Gateway',
      providerFamily: 'gemini',
      baseUrl: 'https://aiplatform.googleapis.com/v1',
    });
    expect(shouldEnablePromptCaching('gemini-3-flash-preview', 4095, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-3-flash-preview', 4096, provider)).toBe(true);
    expect(shouldEnablePromptCaching('gemini-3.5-flash', 4095, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-3.5-flash', 4096, provider)).toBe(true);
    expect(shouldEnablePromptCaching('gemini-3.1-pro-preview', 4095, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-3.1-pro-preview', 4096, provider)).toBe(true);
    expect(shouldEnablePromptCaching('gemini-2.5-flash', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-2.5-flash', 2048, provider)).toBe(true);
    expect(shouldEnablePromptCaching('gemini-2.5-pro', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-2.5-pro', 2048, provider)).toBe(true);
  });

  it('uses the Anthropic Sonnet 4.6 2048-token floor', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      providerFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2048, provider)).toBe(true);
  });

  it('uses the Anthropic Sonnet 4.x 2048-token floor for Sonnet aliases', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      providerFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    expect(shouldEnablePromptCaching('claude-sonnet-4-6-latest', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('claude-sonnet-4-6-latest', 2048, provider)).toBe(true);
  });

  it('uses the Anthropic Opus 4.6 and Haiku 4.5 4096-token floor', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      providerFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    expect(shouldEnablePromptCaching('claude-opus-4-6', 4095, provider)).toBe(false);
    expect(shouldEnablePromptCaching('claude-opus-4-6', 4096, provider)).toBe(true);
    expect(shouldEnablePromptCaching('claude-haiku-4-5', 4095, provider)).toBe(false);
    expect(shouldEnablePromptCaching('claude-haiku-4-5', 4096, provider)).toBe(true);
  });

  it('falls back to hosted model family when a proxy provider is structurally custom', () => {
    const provider = makeProvider({
      id: 'corp-relay',
      name: 'Corporate Relay',
      providerFamily: 'custom',
      baseUrl: 'https://relay.example.com/v1',
    });

    expect(shouldEnablePromptCaching('gemini-2.5-pro', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('gemini-2.5-pro', 2048, provider)).toBe(true);
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2047, provider)).toBe(false);
    expect(shouldEnablePromptCaching('claude-sonnet-4-6', 2048, provider)).toBe(true);
  });
});
