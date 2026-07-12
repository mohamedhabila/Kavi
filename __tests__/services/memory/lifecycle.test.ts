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
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { getEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  countPendingIngestionJobs,
  enqueueIngestionJob,
  getIngestionJob,
  __resetIngestionQueueForTests,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
  runMemoryBackgroundFlush,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';
import { drainRecordedTurn, messages } from './lifecycleTestSupport';

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

describe('recordCompletedTurnForMemory', () => {
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
    expect(getEpisodeAccessPolicy(getMemoryDb(), episodes[0].id)).toMatchObject({
      scope: { personaId: 'default', taskId: null },
      shareability: 'thread_only',
      sensitivity: 'normal',
    });

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

  it.each([
    ['current user', [messages[0]!, { ...messages[0]!, content: 'Duplicate' }, messages[1]!]],
    ['source end', [...messages, { ...messages[1]!, content: 'Duplicate' }]],
  ])('does not enqueue a turn with a duplicate %s identity', async (_label, duplicateMessages) => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-duplicate-source',
      threadTitle: 'Must not be persisted',
      messages: duplicateMessages,
      now: 10,
    });

    expect(result).toMatchObject({
      processed: false,
      enqueued: false,
      skipped: 'source_identity_invalid',
      jobId: null,
    });
    expect(countPendingIngestionJobs()).toBe(0);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-duplicate-source',
        threadId: 'conv-duplicate-source',
      }),
    ).toBeNull();
  });

  it('creates structural facts from tool signals and file operations', async () => {
    const toolMessages: Message[] = [
      { id: 'u-1', role: 'user', content: 'Create app.tsx', timestamp: 1 },
      {
        id: 'a-tool-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
        toolCalls: [
          { name: 'write_file', arguments: JSON.stringify({ path: 'app.tsx' }), id: 'tc-1' },
        ],
      },
      { id: 'tool-1', role: 'tool', content: 'ok', timestamp: 3, toolCallId: 'tc-1' },
      {
        id: 'a-1',
        role: 'assistant',
        content: 'Created the file.',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
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

  it('binds task episodes thread-only and seals the enqueue-time conversation persona', async () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-sealed-persona',
          title: 'Scoped task',
          personaId: 'coder',
          messages,
        },
      ],
    } as any);
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-sealed-persona',
      messages,
      taskId: 'task-private',
      now: 10,
    });
    expect(getIngestionJob(result.jobId!)?.personaId).toBe('coder');

    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === 'conv-sealed-persona'
          ? { ...conversation, personaId: 'writer' }
          : conversation,
      ),
    }));
    await drainRecordedTurn('conv-sealed-persona', messages);

    const episode = listEpisodes({ threadId: 'conv-sealed-persona' })[0];
    expect(episode).toBeDefined();
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)).toMatchObject({
      scope: {
        memoryConversationId: 'conv-sealed-persona',
        sourceThreadId: 'conv-sealed-persona',
        personaId: 'coder',
        taskId: 'task-private',
      },
      shareability: 'thread_only',
      sensitivity: 'normal',
    });
  });

  it('keeps the tool-owned child write in the parent namespace without post-turn duplication', async () => {
    const childMessages: Message[] = [
      {
        id: 'u-shared-1',
        role: 'user',
        content: 'Persist the current release artifact path.',
        timestamp: 1,
      },
      {
        id: 'a-shared-1',
        role: 'assistant',
        content: 'Recorded.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        toolCalls: [
          {
            id: 'tc-memory-1',
            name: 'memory_remember',
            arguments: JSON.stringify({
              subject: 'user',
              predicate: 'checklist_path',
              value: '/workspace/release-checklist.md',
              scope: 'conversation',
              confidence: 0.95,
            }),
          },
        ],
      },
    ];

    const toolWrite = executeMemoryRemember({
      subject: 'user',
      subjectType: 'self',
      predicate: 'checklist_path',
      value: '/workspace/release-checklist.md',
      scope: 'conversation',
      confidence: 0.95,
      originConversationId: 'parent-conv-shared',
      originThreadId: 'child-conv-shared',
      sourceMessageId: 'a-shared-1',
    });
    expect(toolWrite.ok).toBe(true);

    const result = await recordCompletedTurnForMemory({
      threadId: 'child-conv-shared',
      memoryConversationId: 'parent-conv-shared',
      threadTitle: 'Shared release workspace',
      messages: childMessages,
      providerEnrichment: false,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn('child-conv-shared', childMessages);

    const parentFacts = listFacts({ originConversationId: 'parent-conv-shared', limit: 20 });
    const checklistFact = parentFacts.find((fact) => fact.predicate === 'checklist_path');
    expect(checklistFact?.objectText).toBe('/workspace/release-checklist.md');
    expect(checklistFact?.originConversationId).toBe('parent-conv-shared');
    expect(checklistFact?.originThreadId).toBe('child-conv-shared');
    expect(parentFacts.filter((fact) => fact.predicate === 'checklist_path')).toHaveLength(1);
    expect(
      listFacts({ originConversationId: 'child-conv-shared', limit: 20 }).some(
        (fact) => fact.predicate === 'checklist_path',
      ),
    ).toBe(false);
    expect(listEpisodes({ conversationId: 'parent-conv-shared' })[0]).toMatchObject({
      conversationId: 'parent-conv-shared',
      threadId: 'child-conv-shared',
    });

    const memory = await buildLivingMemorySections({
      conversationId: 'parent-conv-shared',
      sourceThreadId: 'child-conv-shared',
      personaId: 'default',
      taskId: null,
      messages: [
        {
          id: 'u-query-shared',
          role: 'user',
          content: 'Find user checklist_path.',
          timestamp: 20,
        },
      ],
      now: toolWrite.fact.createdAt + 10,
      recallLimit: 4,
    });
    const memoryText = memory.sections.map((section) => section.text).join('\n\n');
    expect(memory.recalledFactCount).toBe(0);
    expect(memoryText).not.toContain('/workspace/release-checklist.md');
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
                  predicate: 'project_title',
                  value: 'Android Release Build Validation',
                  scope: 'conversation',
                  confidence: 0.9,
                  importance: 0.7,
                  evidence_message_ids: ['u-1'],
                },
              ],
              episode_summary: null,
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
    expect(facts.some((fact) => fact.predicate === 'project_title')).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-provider',
        threadId: 'conv-provider',
      })?.content,
    ).toContain('Release hardening');
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
              episode_summary: null,
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
              episode_summary: null,
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
      maxTokens: 32000,
    });
  });

  it('uses the active provider while flushing queued memory jobs in the background', async () => {
    useSettingsStore.setState({
      activeProviderId: 'provider-active-bg',
      providers: [
        {
          id: 'provider-active-bg',
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
              episode_summary: null,
              active_focus: 'Background flush focus.',
              open_threads: [],
              notable: [],
            }),
          },
        },
      ],
    });
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-background-provider',
          title: 'Background provider flow',
          messages,
        },
      ],
    } as any);
    enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-background-provider',
      threadTitle: null,
      memoryConversationId: 'conv-background-provider',
      taskId: null,
      sourceStartMessageId: 'u-1',
      sourceEndMessageId: 'a-1',
      sourceRunId: null,
      sourceAt: 2,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
    });

    await runMemoryBackgroundFlush();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(getConsolidationState('conv-background-provider')?.lastConsolidatedMessageId).toBe(
      'a-1',
    );
  });

  it('allows structural callers to opt out of active provider resolution', async () => {
    useSettingsStore.setState({
      activeProviderId: 'provider-active-chat',
      providers: [
        {
          id: 'provider-active-chat',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-structural-only',
      messages,
      threadTitle: 'Structural acceptance flow',
      providerEnrichment: false,
    });
    await drainRecordedTurn('conv-structural-only', messages);

    expect(result.enqueued).toBe(true);
    expect(getIngestionJob(result.jobId!)?.status).toBe('completed_structural');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(getConsolidationState('conv-structural-only')?.lastConsolidatedMessageId).toBe('a-1');
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
