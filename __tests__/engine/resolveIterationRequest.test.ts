import { resolveModelTurnIterationRequest } from '../../src/engine/graph/modelTurn/resolveIterationRequest';
import type { LlmProviderConfig } from '../../src/types/provider';

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'key',
  model: 'claude-sonnet-5-5',
  enabled: true,
} as LlmProviderConfig;

function request(overrides: Partial<Parameters<typeof resolveModelTurnIterationRequest>[0]> = {}) {
  return resolveModelTurnIterationRequest({
    activeModel: 'claude-sonnet-5-5',
    activeProvider: provider,
    maxTokens: 32000,
    thinkingLevel: 'medium',
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    ...overrides,
  });
}

describe('a model step keeps the run thinking level', () => {
  // Traced on Sonnet 5.5 (Claw-Anything, 50 tasks): every agentic step was capped at
  // thinking "low", so Claude ran at effort low with the person's level at medium and
  // answered from the request or asked instead of looking in their connected apps.
  it("sends an actionable step at the person's level", () => {
    expect(request().iterationThinkingLevel).toBe('medium');
  });

  it("sends a persona's own level over the person's", () => {
    expect(request({ personaThinkingLevel: 'high' }).iterationThinkingLevel).toBe('high');
  });

  it('sends a forced final answer at the same level, with its larger budget', () => {
    const forced = request({
      maxTokens: 1024,
      turnDirectives: {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        requireWorkflowTool: false,
        maxTokensOverride: 4096,
        incompleteFinalTextRecoveryCount: 0,
      },
    });

    expect(forced).toMatchObject({
      iterationThinkingLevel: 'medium',
      requestMaxTokens: 4096,
      requestModel: 'claude-sonnet-5-5',
      effectiveForceTextThisTurn: true,
      effectiveForceTextReasonThisTurn: 'empty_delivery_recovery',
    });
  });
});
