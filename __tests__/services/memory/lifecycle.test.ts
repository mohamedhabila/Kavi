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

import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { findEntityByName } from '../../../src/services/memory/entities';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { getEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  countPendingIngestionJobs,
  enqueueIngestionJob as enqueueStrictIngestionJob,
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
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import { drainRecordedTurn, messages } from '../../helpers/memoryLifecycle';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';
import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
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
  it('creates a content-free episode and code-owned focus when no semantic provider is available', async () => {
    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-live',
      threadTitle: 'Release hardening',
      messages,
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    expect(result.episodeId).toBeNull();
    expect(result.activeFocusUpdated).toBe(false);
    expect(result.enriched).toBe(false);

    await drainRecordedTurn();

    // Episode was created
    const episodes = listEpisodes({ threadId: 'conv-live' });
    expect(episodes.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(episodes[0].summary)).toMatchObject({
      kind: 'structural_turn',
      version: 1,
    });
    expect(episodes[0].summary).not.toContain('Android Release Build Validation');
    expect(episodes[0].summary).not.toContain('Release hardening');
    expect(getEpisodeAccessPolicy(getMemoryDb(), episodes[0].id)).toMatchObject({
      scope: { personaId: 'default', taskId: null },
      shareability: 'session_threads',
      sensitivity: 'normal',
    });

    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-live',
        threadId: 'conv-live',
      }),
    ).toMatchObject({
      content: 'Release hardening',
      promptEligibility: 'trusted_structural',
    });

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
      sourceEndMessageId: 'a-1',
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
          {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'app.tsx' }),
            id: 'tc-1',
            status: 'completed',
          },
        ],
      },
      { id: 'tool-1', role: 'tool', content: 'ok', timestamp: 3, toolCallId: 'tc-1' },
      {
        id: 'a-1',
        role: 'assistant',
        content: 'Created the file.',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-tools',
      messages: toolMessages,
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn();
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
      sourceEndMessageId: 'a-1',
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
    await drainRecordedTurn();

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
    const userMessageText = '主体🧑 label /workspace/release-checklist.md';
    const rememberArgs = memoryRememberArgs({
      userMessageText,
      subjectRef: { kind: 'self' },
      predicate: 'preferred label',
      value: '/workspace/release-checklist.md',
      scope: 'conversation',
      confidence: 0.95,
    });
    const childMessages: Message[] = [
      {
        id: 'u-shared-1',
        role: 'user',
        content: userMessageText,
        timestamp: 1,
      },
      {
        id: 'a-shared-tool-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
        toolCalls: [
          {
            id: 'tc-memory-1',
            name: 'memory_remember',
            arguments: JSON.stringify(rememberArgs),
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-shared-1',
        role: 'tool',
        content: 'Memory recorded.',
        timestamp: 3,
        toolCallId: 'tc-memory-1',
      },
      {
        id: 'a-shared-1',
        role: 'assistant',
        content: 'Recorded.',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];

    const toolWrite = executeMemoryRemember(
      rememberArgs,
      memoryRememberExecution({
        memoryConversationId: 'parent-conv-shared',
        sourceThreadId: 'child-conv-shared',
        userMessageId: 'u-shared-1',
        userMessageText,
      }),
    );
    expect(toolWrite.ok).toBe(true);

    const result = await recordCompletedTurnForMemory({
      threadId: 'child-conv-shared',
      memoryConversationId: 'parent-conv-shared',
      threadTitle: 'Shared release workspace',
      messages: childMessages,
      sourceEndMessageId: 'a-shared-1',
      providerEnrichment: false,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn();

    const parentFacts = listFacts({ originConversationId: 'parent-conv-shared', limit: 20 });
    const checklistFact = parentFacts.find((fact) => fact.predicate === 'preferred label');
    expect(checklistFact?.objectText).toBe('/workspace/release-checklist.md');
    expect(checklistFact?.originConversationId).toBe('parent-conv-shared');
    expect(checklistFact?.originThreadId).toBe('child-conv-shared');
    expect(parentFacts.filter((fact) => fact.predicate === 'preferred label')).toHaveLength(1);
    expect(
      listFacts({ originConversationId: 'child-conv-shared', limit: 20 }).some(
        (fact) => fact.predicate === 'preferred label',
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
    expect(memory.recalledFactCount).toBe(1);
    expect(memoryText).toContain('/workspace/release-checklist.md');
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
                  version: 1,
                  subject_ref: { kind: 'self' },
                  predicate: 'project_title',
                  value: 'Android Release Build Validation',
                  scope: 'conversation',
                  importance: 0.7,
                  confidence: 0.9,
                  source_message_id: 'u-1',
                  operation: 'record',
                  assertion_class: 'current_direct',
                  evidence_quote: 'My project title is Android Release Build Validation.',
                  sensitivity: 'personal',
                },
              ],
              episode_sensitivity: 'normal',
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
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn();
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
              episode_sensitivity: 'normal',
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
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn();
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
              episode_sensitivity: 'normal',
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
      sourceEndMessageId: 'a-1',
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await drainRecordedTurn();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatchObject({
      model: 'gemini-3.5-flash',
      maxTokens: 4096,
      temperature: 0,
      reasoning_effort: 'none',
      structuredOutput: {
        name: 'memory_consolidation',
        mimeType: 'application/json',
        strict: true,
        schema: expect.objectContaining({
          additionalProperties: false,
          required: [
            'new_facts',
            'episode_summary',
            'episode_sensitivity',
            'active_focus',
            'open_threads',
            'notable',
          ],
        }),
      },
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
              episode_sensitivity: 'normal',
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
      chatProviderId: 'provider-active-bg',
      chatModel: 'gpt-4o-mini',
      reason: 'turn_completed',
      providerEnrichment: true,
      sourceSnapshot: encodeIngestionSourceSnapshot({
        messages,
        priorUserMessageId: null,
        sourceStartMessageId: 'u-1',
        sourceEndMessageId: 'a-1',
      }),
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
      sourceEndMessageId: 'a-1',
      threadTitle: 'Structural acceptance flow',
      providerEnrichment: false,
    });
    await drainRecordedTurn();

    expect(result.enqueued).toBe(true);
    expect(getIngestionJob(result.jobId!)?.status).toBe('completed_structural');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(getConsolidationState('conv-structural-only')?.lastConsolidatedMessageId).toBe('a-1');
  });

});
