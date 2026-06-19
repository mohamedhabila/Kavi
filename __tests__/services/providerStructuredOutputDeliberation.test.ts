import { resolveProviderStructuredOutputDeliberationControls } from '../../src/services/llm/support/providerStructuredOutputDeliberation';

describe('providerStructuredOutputDeliberation', () => {
  it('disables thinking for Anthropic-family structured output even when the model name is opaque', () => {
    expect(
      resolveProviderStructuredOutputDeliberationControls({
        model: 'internal-proxy-model',
        providerFamily: 'anthropic',
      }),
    ).toEqual({
      reasoning_effort: 'none',
      thinking: {
        type: 'disabled',
      },
    });
  });

  it('uses Gemini 3 thinking levels from provider-family-aware structured output controls', () => {
    expect(
      resolveProviderStructuredOutputDeliberationControls({
        model: 'gemini-3.5-pro',
        providerFamily: 'gemini',
      }),
    ).toEqual({
      reasoning_effort: 'none',
      thinking: {
        thinkingLevel: 'LOW',
        includeThoughts: false,
      },
    });
  });

  it('uses Gemini 2.5 Pro thinking budgets from provider-family-aware structured output controls', () => {
    expect(
      resolveProviderStructuredOutputDeliberationControls({
        model: 'gemini-2.5-pro',
        providerFamily: 'gemini',
      }),
    ).toEqual({
      reasoning_effort: 'none',
      thinking: {
        thinkingBudget: 128,
        includeThoughts: false,
      },
    });
  });
});
