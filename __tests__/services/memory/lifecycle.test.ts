// ---------------------------------------------------------------------------
// Tests — Memory lifecycle
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/llm/providerSupport', () => ({
  resolveProviderApiKey: jest.fn(async () => 'test-key'),
}));

const mockSendMessage = jest.fn();

jest.mock('../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  findEntityByName,
  ensureFactSchema,
  listFacts,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/factStore';
import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { getBlock } from '../../../src/services/memory/factStore';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { useChatStore } from '../../../src/store/useChatStore';
import {
  recordCompletedTurnForMemory,
  runMemoryMigrationTick,
  runMemoryBackgroundFlush,
  __resetMemoryLifecycleForTests,
} from '../../../src/services/memory/lifecycle';
import type { Message } from '../../../src/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
  __resetMemoryLifecycleForTests();
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

  it('no-ops when no provider is configured', async () => {
    await expect(runMemoryBackgroundFlush()).resolves.toBeUndefined();
  });
});

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

  it('marks completed turns dirty and updates heuristic focus when no provider exists', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-live',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.dirty.marked).toBe(true);
    expect(result.skipped).toBe('no_provider');
    expect(getConsolidationState('conv-live')?.turnsSinceLast).toBe(2);
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-live',
      threadId: 'conv-live',
    })?.content).toContain('Release hardening');
    expect(getWorkingBlock('open_threads', {
      conversationId: 'conv-live',
      threadId: 'conv-live',
    })?.content).toContain('validate the Android release build');
    const userEntity = findEntityByName('user');
    expect(
      listFacts({ subjectId: userEntity!.id }).some(
        (fact) => fact.predicate === 'asked_to_remember',
      ),
    ).toBe(true);
  });

  it('runs configured provider consolidation on the first completed live turn', async () => {
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

    expect(result.dirty.marked).toBe(true);
    expect(result.consolidation?.ran).toBe(true);
    expect(result.consolidation?.reason).toBe('turn_threshold');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatchObject({
      maxTokens: 1600,
      signal: expect.any(Object),
    });

    const userEntity = findEntityByName('user');
    const facts = listFacts({ subjectId: userEntity!.id, limit: 20 });
    expect(facts.some((fact) => fact.predicate === 'release_target')).toBe(true);
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-provider',
      threadId: 'conv-provider',
    })?.content).toBe('Validating the Android release build.');
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

    expect(result.dirty.marked).toBe(true);
    expect(result.consolidation?.ran).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps chat-safe heuristic memory and advances the cursor when provider extraction fails', async () => {
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

    expect(result.dirty.marked).toBe(true);
    expect(result.consolidation?.ran).toBe(true);
    expect(result.consolidation?.result?.newFacts).toEqual([]);
    expect(getConsolidationState('conv-provider-fail')?.lastConsolidatedMessageId).toBe('a-1');
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-provider-fail',
      threadId: 'conv-provider-fail',
    })?.content).toContain('Release hardening');
  });

  it('anchors heuristic focus to the completed final assistant turn when placeholders trail it', async () => {
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

    expect(result.dirty.anchorMessageId).toBe('a-final');
    const focus = getWorkingBlock('active_focus', {
      conversationId: 'conv-placeholder',
      threadId: 'conv-placeholder',
    })?.content;
    expect(focus).toContain('The launch checklist is captured');
    expect(focus).not.toContain('Waiting for background worker results');
  });

  it('creates no dirty state or block writes when long-term memory is disabled', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-disabled',
      messages,
      now: 10,
    });

    expect(result.dirty.marked).toBe(false);
    expect(result.skipped).toBe('opt_out');
    expect(getConsolidationState('conv-disabled')).toBeNull();
    expect(getBlock('active_focus')?.content).toBe('');
    expect(getWorkingBlock('active_focus', {
      conversationId: 'conv-disabled',
      threadId: 'conv-disabled',
    })).toBeNull();
  });
});
