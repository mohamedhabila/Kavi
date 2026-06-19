// ---------------------------------------------------------------------------
// Tests — Memory lifecycle (always-on turn processor)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/llm/support/providerSupport', () => {
  const actual = jest.requireActual('../../../src/services/llm/support/providerSupport');
  return {
    ...actual,
    resolveProviderApiKey: jest.fn(async () => 'test-key'),
  };
});

const mockSendMessage = jest.fn();

jest.mock('../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { findEntityByName } from '../../../src/services/memory/entities';
import { getBlock } from '../../../src/services/memory/blocks';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import {
  drainIngestionQueue,
  __resetIngestionQueueForTests,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
  runMemoryBackgroundFlush,
  runMemoryMigrationTick,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  __resetMemoryLifecycleForTests();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  mockSendMessage.mockReset();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as any);
  useChatStore.setState({ conversations: [] } as any);
});

describe('runMemoryMigrationTick', () => {
  it('returns empty result when no consolidationProvider is configured', async () => {
    const result = await runMemoryMigrationTick({ force: true });
    expect(result.attempted).toBe(0);
    expect(result.completed).toBe(0);
  });

  it('returns empty result when disableLongTermMemory is true', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);
    const result = await runMemoryMigrationTick({ force: true });
    expect(result.attempted).toBe(0);
  });

  it('throttles repeat ticks within the cooldown window', async () => {
    const now = Date.now();
    await runMemoryMigrationTick({ now, force: true });
    const second = await runMemoryMigrationTick({ now: now + 100 });
    expect(second.attempted).toBe(0);
    expect(second.completed).toBe(0);
  });
});

describe('runMemoryBackgroundFlush', () => {
  it('no-ops when memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });

  it('no-ops when no conversations exist', async () => {
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });
});

async function drainRecordedTurn(threadId: string, messages: Message[]): Promise<void> {
  await drainIngestionQueue({
    loadMessagesForThread: (id) => (id === threadId ? messages : []),
  });
}

describe('recordCompletedTurnForMemory', () => {
  const messages: Message[] = [
    { id: 'u-1', role: 'user', content: 'Please remember the release follow-up.', timestamp: 1 },
    {
      id: 'a-1',
      role: 'assistant',
      content: 'Done. Next: validate the Android release build.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete' },
    },
  ];

  it('always processes turns and creates an episode even without a provider', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-live',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    expect(result.episodeId).toBeNull();
    expect(result.activeFocusUpdated).toBe(true);
    expect(result.enriched).toBe(false);

    await drainRecordedTurn('conv-live', messages);

    // Episode was created
    const episodes = listEpisodes({ threadId: 'conv-live' });
    expect(episodes.length).toBeGreaterThanOrEqual(1);

    // Focus block updated
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-live',
        threadId: 'conv-live',
      })?.content,
    ).toContain('Release hardening');

    // Cursor advanced
    expect(getConsolidationState('conv-live')?.lastConsolidatedMessageId).toBe('a-1');
  });

  it('creates structural facts from tool signals and file operations', async () => {
    const toolMessages: Message[] = [
      { id: 'u-1', role: 'user', content: 'Create app.tsx', timestamp: 1 },
      {
        id: 'a-1',
        role: 'assistant',
        content: 'Created the file.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        toolCalls: [
          { name: 'write_file', arguments: JSON.stringify({ path: 'app.tsx' }), id: 'tc-1' },
        ],
      },
    ];

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-tools',
      messages: toolMessages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('conv-tools', toolMessages);
    expect(listEpisodes({ threadId: 'conv-tools' }).length).toBeGreaterThanOrEqual(1);
    expect(listFacts({ limit: 20 }).length).toBeGreaterThanOrEqual(1);
  });

  it('enriches with provider when configured', async () => {
    useSettingsStore.setState({
      consolidationProvider: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);
    mockSendMessage.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_facts: [
                {
                  subject: 'user',
                  predicate: 'release_target',
                  value: 'Android release build validation',
                  scope: 'conversation',
                  confidence: 0.9,
                  importance: 0.7,
                  evidence_message_ids: ['u-1'],
                },
              ],
              active_focus: 'Validating the Android release build.',
              open_threads: ['Validate the Android release build'],
              notable: [],
            }),
          },
        },
      ],
    });

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-provider',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('conv-provider', messages);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    const userEntity = findEntityByName('user');
    const facts = listFacts({ subjectId: userEntity!.id, limit: 20 });
    expect(facts.some((fact) => fact.predicate === 'release_target')).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-provider',
        threadId: 'conv-provider',
      })?.content,
    ).toBe('Validating the Android release build.');
  });

  it('falls back to the active enabled provider when consolidationProvider is unset', async () => {
    useSettingsStore.setState({
      consolidationProvider: '',
      activeProviderId: 'provider-active',
      providers: [
        {
          id: 'provider-active',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);
    mockSendMessage.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_facts: [],
              active_focus: 'Validating the Android release build.',
              open_threads: ['Validate the Android release build'],
              notable: [],
            }),
          },
        },
      ],
    });

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-provider-fallback',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('conv-provider-fallback', messages);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('uses the active resolved model when the consolidation provider is the active provider', async () => {
    useSettingsStore.setState({
      consolidationProvider: '',
      activeProviderId: 'provider-gemini',
      activeModel: 'gemini-3.5-flash',
      providers: [
        {
          id: 'provider-gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: '',
          model: 'gemini-3.1-pro-preview',
          availableModels: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'],
          enabled: true,
        },
      ],
    } as any);
    mockSendMessage.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_facts: [],
              active_focus: 'Validating the Android release build.',
              open_threads: ['Validate the Android release build'],
              notable: [],
            }),
          },
        },
      ],
    });

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-gemini-provider-fallback',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('conv-gemini-provider-fallback', messages);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatchObject({
      model: 'gemini-3.5-flash',
      maxTokens: 1600,
    });
  });

  it('keeps structural memory and advances the cursor when provider extraction fails', async () => {
    useSettingsStore.setState({
      consolidationProvider: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);
    mockSendMessage.mockRejectedValue(new Error('timeout'));

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-provider-fail',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('conv-provider-fail', messages);
    expect(listEpisodes({ threadId: 'conv-provider-fail' }).length).toBeGreaterThanOrEqual(1);
    expect(getConsolidationState('conv-provider-fail')?.lastConsolidatedMessageId).toBe('a-1');
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-provider-fail',
        threadId: 'conv-provider-fail',
      })?.content,
    ).toContain('Release hardening');
  });

  it('anchors focus to the completed final assistant turn when placeholders trail it', async () => {
    const messagesWithTrailingPlaceholder: Message[] = [
      { id: 'u-1', role: 'user', content: 'Please remember the launch checklist.', timestamp: 1 },
      {
        id: 'a-final',
        role: 'assistant',
        content: 'The launch checklist is captured. Next: validate signing.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
      {
        id: 'a-placeholder',
        role: 'assistant',
        content: 'Waiting for background worker results.',
        timestamp: 3,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'yielded' },
      },
    ];

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-placeholder',
      threadTitle: 'Launch prep',
      messages: messagesWithTrailingPlaceholder,
      now: 10,
    });

    expect(result.processed).toBe(true);
    const focus = getWorkingBlock('active_focus', {
      conversationId: 'conv-placeholder',
      threadId: 'conv-placeholder',
    })?.content;
    expect(focus).toContain('Launch prep');
    await drainRecordedTurn('conv-placeholder', messagesWithTrailingPlaceholder);
    expect(getConsolidationState('conv-placeholder')?.lastConsolidatedMessageId).toBe('a-final');
  });

  it('anchors conversation focus to thread metadata even when no closed turn is available', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-title-only',
      threadTitle: 'longmem-delayed-thread',
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: 'Verify stored state later.',
          timestamp: 1,
        },
      ],
      now: 10,
    });

    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
    expect(result.activeFocusUpdated).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-title-only',
        threadId: 'conv-title-only',
      })?.content,
    ).toBe('longmem-delayed-thread');
  });

  it('keeps conversation focus separate from graph task-scoped turn memory', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-task-focus',
      threadTitle: 'thread-focus-anchor',
      taskId: 'goal-1',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.activeFocusUpdated).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task-focus',
        threadId: 'conv-task-focus',
      })?.content,
    ).toBe('thread-focus-anchor');
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task-focus',
        threadId: 'conv-task-focus',
        taskId: 'goal-1',
      }),
    ).toBeNull();
  });

  it('creates no state or block writes when long-term memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-disabled',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('opt_out');
    expect(getConsolidationState('conv-disabled')).toBeNull();
    expect(getBlock('active_focus')?.content).toBe('');
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-disabled',
        threadId: 'conv-disabled',
      }),
    ).toBeNull();
  });
});
