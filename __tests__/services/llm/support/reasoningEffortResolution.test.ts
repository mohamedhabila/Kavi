import {
  resolveDeclaredReasoningEffort,
  resolveHelperReasoningEffort,
  resolveThinkingLevelReasoningEffort,
} from '../../../../src/services/llm/support/reasoningEffortResolution';
import type { LlmProviderConfig } from '../../../../src/types/provider';
import type { ModelReasoningCapability } from '../../../../src/types/tool';

// Shapes copied from OpenRouter's models API `reasoning` field (2026-10-09).
const GLM_FLASH: ModelReasoningCapability = {
  mandatory: true,
  supportedEfforts: ['max', 'high', 'low'],
};
const GEMINI_FLASH: ModelReasoningCapability = {
  mandatory: true,
  supportedEfforts: ['high', 'medium', 'low', 'minimal'],
};
const CLAUDE_SONNET: ModelReasoningCapability = {
  mandatory: true,
  supportedEfforts: ['max', 'xhigh', 'high', 'medium', 'low'],
};
const DEEPSEEK_FLASH: ModelReasoningCapability = {
  mandatory: false,
  supportedEfforts: ['xhigh', 'high'],
};
const GPT: ModelReasoningCapability = {
  mandatory: false,
  supportedEfforts: ['xhigh', 'high', 'medium', 'low', 'none'],
};

function openRouterProvider(reasoning?: ModelReasoningCapability): LlmProviderConfig {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    providerFamily: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'key',
    model: 'z-ai/glm-5.3-flash',
    enabled: true,
    modelCapabilities: reasoning
      ? { 'z-ai/glm-5.3-flash': { vision: true, tools: true, fileInput: false, reasoning } }
      : undefined,
  };
}

describe('resolveHelperReasoningEffort', () => {
  it('asks a model that cannot turn reasoning off for its least deliberation', () => {
    expect(resolveHelperReasoningEffort(openRouterProvider(GLM_FLASH), 'z-ai/glm-5.3-flash')).toBe(
      'low',
    );
  });

  it('turns reasoning off when the model allows it, even if `none` is not listed', () => {
    expect(
      resolveHelperReasoningEffort(openRouterProvider(DEEPSEEK_FLASH), 'z-ai/glm-5.3-flash'),
    ).toBe('none');
  });

  it('sends no control to an OpenRouter model that declares nothing', () => {
    expect(
      resolveHelperReasoningEffort(openRouterProvider(), 'z-ai/glm-5.3-flash'),
    ).toBeUndefined();
  });

  it('keeps the off switch for a direct provider family', () => {
    expect(
      resolveHelperReasoningEffort(
        {
          name: 'OpenAI',
          providerFamily: 'openai',
          baseUrl: 'https://api.openai.com/v1',
        },
        'gpt-5.5',
      ),
    ).toBe('none');
  });

  it('sends no control when the only declared effort is one requests cannot carry', () => {
    expect(
      resolveHelperReasoningEffort(
        openRouterProvider({ mandatory: true, supportedEfforts: ['max'] }),
        'z-ai/glm-5.3-flash',
      ),
    ).toBeUndefined();
  });
});

describe('resolveDeclaredReasoningEffort', () => {
  it('rounds up to the nearest accepted effort', () => {
    expect(resolveDeclaredReasoningEffort(GLM_FLASH, 'medium')).toBe('high');
    expect(resolveDeclaredReasoningEffort(GEMINI_FLASH, 'none')).toBe('minimal');
  });

  it('falls back to the most deliberate accepted effort when nothing is that high', () => {
    expect(resolveDeclaredReasoningEffort(GLM_FLASH, 'xhigh')).toBe('high');
  });

  it('returns the requested effort when the model accepts it', () => {
    expect(resolveDeclaredReasoningEffort(GPT, 'medium')).toBe('medium');
  });
});

describe('resolveThinkingLevelReasoningEffort', () => {
  it.each([
    ['off', GLM_FLASH, 'low'],
    ['medium', GLM_FLASH, 'high'],
    ['off', CLAUDE_SONNET, 'low'],
    ['medium', CLAUDE_SONNET, 'medium'],
    ['off', GEMINI_FLASH, 'minimal'],
    ['off', DEEPSEEK_FLASH, 'none'],
    ['low', DEEPSEEK_FLASH, 'high'],
    ['off', GPT, 'none'],
  ] as const)('maps %s on %j to %s', (level, capability, expected) => {
    expect(resolveThinkingLevelReasoningEffort(capability, level)).toBe(expected);
  });
});
