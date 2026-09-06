// ---------------------------------------------------------------------------
// Tests — Model turn token calibration end-to-end wiring
// ---------------------------------------------------------------------------
// Drives a real model turn through executeAgentControlGraphModelTurnAttempt
// with the real (unmocked) prepareAgentTurnRequestBudget, so the pre-flight
// estimate and the recorded observation come from the actual production
// wiring rather than a stand-in. Only the LLM transport is faked.

import { executeAgentControlGraphModelTurnAttempt } from '../../src/engine/graph/modelTurnExecutionAttempt';
import { finalizeProviderConfig } from '../../src/constants/api';
import {
  estimateTokens,
  getObservedTokenCalibrationFactor,
  resetTokenCalibrationForTests,
} from '../../src/services/context/tokenCounter';
import type { Message } from '../../src/types/message';

async function* usageTurnStream(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
}) {
  yield { type: 'token' as const, content: 'Done.' };
  yield { type: 'usage' as const, usage };
  yield { type: 'done' as const, content: 'Done.' };
}

async function* noUsageTurnStream() {
  yield { type: 'token' as const, content: 'Done.' };
  yield { type: 'done' as const, content: 'Done.' };
}

const openAiProvider = finalizeProviderConfig({
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5.4',
  enabled: true,
});

function baseParams(overrides: Record<string, any> = {}) {
  return {
    activeProvider: openAiProvider,
    applyGraphEvents: jest.fn(),
    callbacks: {
      onStateChange: jest.fn(),
      onToken: jest.fn(),
      onAssistantStreamReset: jest.fn(),
    },
    compactionEngine: null,
    conversationId: 'conv-token-calibration',
    effectiveForceTextReasonThisTurn: undefined,
    hasPendingAsyncOperations: false,
    iteration: 1,
    livingMemory: null,
    onCompaction: undefined,
    preparedTurn: {
      enrichedSystemPrompt: 'Be concise.',
      enrichedSystemPromptSections: [{ text: 'Be concise.', cacheable: true }],
      pinnedToolNames: [],
      selectedToolTokenEstimate: 0,
      selectedTools: [],
      toolsForIteration: undefined,
    },
    recordPerformanceMetrics: jest.fn(),
    reportUsage: jest.fn(),
    requestMaxTokens: 256,
    requestModel: 'gpt-5.4',
    signal: undefined,
    temperature: 1,
    thinkingLevel: 'off' as const,
    warn: jest.fn(),
    workingMessages: [
      { id: 'u1', role: 'user', content: 'Say hi.', timestamp: Date.now() },
    ] as Message[],
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('executeAgentControlGraphModelTurnAttempt token calibration wiring', () => {
  beforeEach(() => {
    resetTokenCalibrationForTests();
  });

  it('fails without the wiring: pairs the pre-flight estimate with real usage and feeds the next estimate', async () => {
    // A tiny prompt keeps the real pre-flight estimate small; reporting a usage far larger
    // than any plausible estimate for it forces the observed ratio to clamp at its ceiling
    // regardless of the exact byte count budgetManager computes, keeping this test robust to
    // unrelated changes in prompt/tool scaffolding overhead.
    const streamMessage = jest.fn().mockImplementation(() =>
      usageTurnStream({
        inputTokens: 100_000,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 100_010,
      }),
    );

    expect(getObservedTokenCalibrationFactor('openai')).toBe(1);

    const result = await executeAgentControlGraphModelTurnAttempt(
      baseParams({ llm: { streamMessage, sendMessage: jest.fn() } }) as any,
    );

    expect(result.kind).toBe('success');
    const learnedFactor = getObservedTokenCalibrationFactor('openai');
    expect(learnedFactor).toBeGreaterThan(1);

    const text =
      'Compare the calibrated estimate against the uncalibrated baseline for this family.';
    expect(estimateTokens(text, 'openai')).toBeGreaterThan(estimateTokens(text));
  });

  it('does not calibrate when the request messages carry an image attachment', async () => {
    const streamMessage = jest
      .fn()
      .mockImplementation(() => usageTurnStream({ inputTokens: 100_000, outputTokens: 10 }));

    const result = await executeAgentControlGraphModelTurnAttempt(
      baseParams({
        llm: { streamMessage, sendMessage: jest.fn() },
        workingMessages: [
          {
            id: 'u1',
            role: 'user',
            content: 'What is in this photo?',
            timestamp: Date.now(),
            attachments: [
              {
                id: 'att1',
                type: 'image',
                uri: 'file:///tmp/photo.png',
                name: 'photo.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          },
        ] as Message[],
      }) as any,
    );

    expect(result.kind).toBe('success');
    expect(getObservedTokenCalibrationFactor('openai')).toBe(1);
  });

  it('does not calibrate when the provider never reports usage for the request', async () => {
    const streamMessage = jest.fn().mockImplementation(() => noUsageTurnStream());

    const result = await executeAgentControlGraphModelTurnAttempt(
      baseParams({ llm: { streamMessage, sendMessage: jest.fn() } }) as any,
    );

    expect(result.kind).toBe('success');
    expect(getObservedTokenCalibrationFactor('openai')).toBe(1);
  });
});
