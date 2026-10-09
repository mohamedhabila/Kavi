// ---------------------------------------------------------------------------
// Tests — thinking level on models that declare their reasoning efforts
// ---------------------------------------------------------------------------

import { getThinkingParams } from '../../src/engine/thinking';
import type { ModelReasoningCapability } from '../../src/types/tool';

const GLM_FLASH: ModelReasoningCapability = {
  mandatory: true,
  supportedEfforts: ['max', 'high', 'low'],
};

describe('getThinkingParams with a declared reasoning capability', () => {
  it('asks for the least deliberation the model accepts when thinking is off', () => {
    // Regression: `off` sent nothing, so a model whose reasoning is mandatory ran at its
    // own default effort — its highest — on every turn.
    expect(
      getThinkingParams('off', 'z-ai/glm-5.3-flash', { reasoningCapability: GLM_FLASH }),
    ).toEqual({ reasoning_effort: 'low' });
  });

  it('maps a level to the nearest accepted effort instead of a temperature proxy', () => {
    expect(
      getThinkingParams('medium', 'z-ai/glm-5.3-flash', { reasoningCapability: GLM_FLASH }),
    ).toEqual({ reasoning_effort: 'high' });
  });

  it('turns reasoning off on a model that allows it', () => {
    expect(
      getThinkingParams('off', 'deepseek/deepseek-v4-flash', {
        reasoningCapability: { mandatory: false, supportedEfforts: ['xhigh', 'high'] },
      }),
    ).toEqual({ reasoning_effort: 'none' });
  });

  it('uses the declaration even when the model id names another hosted family', () => {
    expect(
      getThinkingParams('off', 'anthropic/claude-sonnet-5.5', {
        reasoningCapability: {
          mandatory: true,
          supportedEfforts: ['max', 'xhigh', 'high', 'medium', 'low'],
        },
      }),
    ).toEqual({ reasoning_effort: 'low' });
  });

  it('sends no control when the model declares no effort a request can carry', () => {
    expect(
      getThinkingParams('high', 'vendor/model', {
        reasoningCapability: { mandatory: true, supportedEfforts: ['max'] },
      }),
    ).toEqual({});
  });

  it('keeps the existing mapping when nothing is declared', () => {
    expect(getThinkingParams('off', 'z-ai/glm-5.3-flash')).toEqual({});
  });
});
