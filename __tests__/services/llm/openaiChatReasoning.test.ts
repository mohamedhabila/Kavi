import { applyCompatibleReasoningControl } from '../../../src/services/llm/providers/openaiChat/reasoning';

describe('OpenAI-compatible reasoning controls', () => {
  it('uses OpenRouter unified reasoning controls independently of hosted model family', () => {
    const body: Record<string, unknown> = {};

    applyCompatibleReasoningControl({
      body,
      effort: 'none',
      isOpenAIReasoningModel: false,
      isOpenRouterProvider: true,
    });

    expect(body).toEqual({ reasoning: { effort: 'none' } });
  });

  it('uses OpenRouter effort levels when deliberation is enabled', () => {
    const body: Record<string, unknown> = {};

    applyCompatibleReasoningControl({
      body,
      effort: 'low',
      isOpenAIReasoningModel: false,
      isOpenRouterProvider: true,
    });

    expect(body).toEqual({ reasoning: { effort: 'low' } });
  });

  it('uses the OpenAI-compatible scalar for OpenAI reasoning models outside OpenRouter', () => {
    const body: Record<string, unknown> = {};

    applyCompatibleReasoningControl({
      body,
      effort: 'high',
      isOpenAIReasoningModel: true,
      isOpenRouterProvider: false,
    });

    expect(body).toEqual({ reasoning_effort: 'high' });
  });

  it('does not send unsupported reasoning controls to generic compatible providers', () => {
    const body: Record<string, unknown> = {};

    applyCompatibleReasoningControl({
      body,
      effort: 'none',
      isOpenAIReasoningModel: false,
      isOpenRouterProvider: false,
    });

    expect(body).toEqual({});
  });
});
