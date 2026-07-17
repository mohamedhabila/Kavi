jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { createForegroundAssistantStreamController } from '../../src/engine/graph/foregroundRun/assistantStreamController';
import { executeAgentControlGraphModelTurnStreaming } from '../../src/engine/graph/modelTurnExecutionStreaming';
import {
  buildModelTurnMemoryPolicyBinding,
  MemoryPromptEpochExpiredError,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { getMemoryDb } from '../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { ToolCall } from '../../src/types/message';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('model turn projection authority publication', () => {
  it('coalesces token events into bounded projection publications', async () => {
    const onToken = jest.fn();
    const tokenCount = 100;
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const getFirstSync = jest.spyOn(getMemoryDb(), 'getFirstSync');

    try {
      const result = await executeAgentControlGraphModelTurnStreaming({
        allowQueuedToolCalls: true,
        applyGraphEvents: jest.fn(),
        budgetTools: [],
        callbacks: { onStateChange: jest.fn(), onToken },
        iteration: 1,
        llm: {
          streamMessage: () =>
            (async function* () {
              for (let index = 0; index < tokenCount; index += 1) {
                yield { type: 'token' as const, content: String(index % 10) };
              }
              yield { type: 'done' as const };
            })(),
        },
        memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
        recordPerformanceMetrics: jest.fn(),
        reportUsage: jest.fn(),
        requestMessages: [{ role: 'user', content: 'Continue' }],
        requestModel: 'gpt-5-mini',
        signal: undefined,
        streamOptions: {},
      });

      expect(result.fullContent).toHaveLength(tokenCount);
      expect(onToken.mock.calls.flatMap(([content]) => content.split('')).join('')).toBe(
        result.fullContent,
      );
      expect(onToken.mock.calls.length).toBeLessThan(10);
      expect(getFirstSync.mock.calls.length).toBeLessThan(tokenCount);
    } finally {
      getFirstSync.mockRestore();
    }
  });

  it('revokes a published draft through the bounded lease while the provider is stalled', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseProvider!: () => void;
    let markPublished!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const published = new Promise<void>((resolve) => {
      markPublished = resolve;
    });
    const onAssistantStreamReset = jest.fn();
    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: {
        onAssistantStreamReset,
        onStateChange: jest.fn(),
        onToken: jest.fn(() => markPublished()),
      },
      iteration: 1,
      llm: {
        streamMessage: () =>
          (async function* () {
            yield { type: 'token' as const, content: 'P'.repeat(800) };
            await providerGate;
            yield { type: 'done' as const };
          })(),
      },
      memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: undefined,
      streamOptions: {},
    });

    await published;
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );
    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    releaseProvider();

    expect(onAssistantStreamReset).toHaveBeenCalledTimes(1);
  });

  it('restores the exact foreground checkpoint when a throwing reset observes lease revocation', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releaseProvider!: () => void;
    let markToolPublished!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const toolPublished = new Promise<void>((resolve) => {
      markToolPublished = resolve;
    });
    const baseline = {
      content: 'CHECKPOINT_CONTENT',
      reasoning: 'CHECKPOINT_REASONING',
    };
    const persisted = { ...baseline };
    const drafts: Record<string, { content?: string; reasoning?: string; toolCalls?: ToolCall[] }> =
      {};
    const clearStreamingDraft = jest.fn((messageId: string) => {
      delete drafts[messageId];
    });
    const controller = createForegroundAssistantStreamController({
      actions: {
        clearStreamingDraft,
        mergeStreamingDraft: (messageId, patch) => {
          drafts[messageId] = { ...(drafts[messageId] ?? {}), ...patch };
        },
        startAssistantTurn: jest.fn(),
        updateMessage: (_messageId, content) => {
          persisted.content = content;
        },
        updateMessageReasoning: (_messageId, reasoning) => {
          persisted.reasoning = reasoning;
        },
      },
      checkpointIntervalMs: 240,
      createAssistantMessageId: () => 'assistant-unused',
      currentAssistantMessageId: 'assistant-current',
      getStreamingDraft: (messageId) => drafts[messageId],
      publishIntervalMs: 48,
      resumedAssistantDraft: {
        id: 'assistant-current',
        ...baseline,
      },
    });
    const onAssistantStreamReset = jest.fn(() => {
      controller.resetCurrentTurn();
      throw new Error('foreground_reset_observer_failed');
    });
    const onToolCallQueued = jest.fn((toolCall: ToolCall) => {
      drafts['assistant-current'] = {
        ...(drafts['assistant-current'] ?? {}),
        toolCalls: [toolCall],
      };
      markToolPublished();
    });

    const execution = executeAgentControlGraphModelTurnStreaming({
      allowQueuedToolCalls: true,
      applyGraphEvents: jest.fn(),
      budgetTools: [],
      callbacks: {
        onAssistantStreamReset,
        onStateChange: jest.fn(),
        onToken: (token) => {
          controller.appendToken(token);
          controller.commitBuffers(false);
        },
        onReasoning: (token) => {
          controller.appendReasoningToken(token);
          controller.commitBuffers(false);
        },
        onToolCallQueued,
      },
      iteration: 1,
      llm: {
        streamMessage: () =>
          (async function* () {
            yield { type: 'token' as const, content: '_PROVISIONAL' };
            yield { type: 'reasoning' as const, content: '_PRIVATE' };
            yield {
              type: 'tool_call' as const,
              toolCall: {
                id: 'stale-tool-call',
                name: 'calendar_create_event',
                arguments: '{"title":"private"}',
              },
            };
            await providerGate;
            yield { type: 'done' as const };
          })(),
      },
      memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      recordPerformanceMetrics: jest.fn(),
      reportUsage: jest.fn(),
      requestMessages: [{ role: 'user', content: 'Continue' }],
      requestModel: 'gpt-5-mini',
      signal: undefined,
      streamOptions: {},
    });

    await toolPublished;
    getMemoryDb().runSync(
      `UPDATE memory_vault_identity
          SET restrictive_authority_revision = restrictive_authority_revision + 1,
              projection_revision = projection_revision + 1
        WHERE singleton = 1`,
    );
    await expect(execution).rejects.toBeInstanceOf(MemoryPromptEpochExpiredError);
    releaseProvider();

    expect(onToolCallQueued).toHaveBeenCalledTimes(1);
    expect(onAssistantStreamReset).toHaveBeenCalledTimes(1);
    expect(clearStreamingDraft).toHaveBeenCalledWith('assistant-current');
    expect(drafts['assistant-current']).toBeUndefined();
    expect(persisted).toEqual(baseline);
    expect(controller.getVisibleAssistantContent()).toBe(baseline.content);
  });
});
