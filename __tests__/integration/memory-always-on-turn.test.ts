jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/llm/support/providerSupport', () => {
  const actual = jest.requireActual('../../src/services/llm/support/providerSupport');
  return {
    ...actual,
    resolveProviderApiKey: jest.fn(async () => 'test-key'),
  };
});

const mockSendMessage = jest.fn();

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({ sendMessage: mockSendMessage })),
}));

import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { __resetIngestionQueueForTests } from '../../src/services/memory/ingestionQueue';
import { getWorkingBlock } from '../../src/services/memory/workingBlocks';
import { listEpisodes } from '../../src/services/memory/episodes/queries';
import { listFacts } from '../../src/services/memory/facts/queries';
import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';
import { waitForIngestionJobTerminal } from '../helpers/ingestionQueueHarness';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function makeClosedTurn(userContent: string, assistantContent: string): Message[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: userContent,
      timestamp: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: assistantContent,
      timestamp: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetIngestionQueueForTests();
  mockSendMessage.mockReset();
  useSettingsStore.setState({
    disableLongTermMemory: false,
    consolidationProvider: '',
    providers: [],
  } as never);
});

afterEach(() => {
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

describe('memory always-on turn integration', () => {
  it('records and asynchronously ingests chitchat and agentic turns', async () => {
    const chitchat = await recordCompletedTurnForMemory({
      threadId: 'conv-chit',
      messages: makeClosedTurn('hello', 'hi there'),
      sourceEndMessageId: 'assistant-1',
    });
    expect(chitchat.processed).toBe(true);
    expect(chitchat.enqueued).toBe(true);
    expect(chitchat.jobId).not.toBeNull();
    await expect(waitForIngestionJobTerminal(chitchat.jobId!)).resolves.toEqual(
      expect.objectContaining({ status: 'completed_structural' }),
    );

    const agentic = await recordCompletedTurnForMemory({
      threadId: 'conv-agent',
      messages: makeClosedTurn('search docs', 'Here are results [web_search]'),
      sourceEndMessageId: 'assistant-1',
    });
    expect(agentic.processed).toBe(true);
    expect(agentic.enqueued).toBe(true);
    expect(agentic.jobId).not.toBeNull();
    await expect(waitForIngestionJobTerminal(agentic.jobId!)).resolves.toEqual(
      expect.objectContaining({ status: 'completed_structural' }),
    );
  });

  it('does not synthesize semantic working memory before provider enrichment', async () => {
    const messages = makeClosedTurn('plan trip', 'Working on itinerary');
    const recorded = await recordCompletedTurnForMemory({
      threadId: 'conv-sync',
      threadTitle: 'Trip planning',
      messages,
      sourceEndMessageId: 'assistant-1',
    });

    expect(recorded.processed).toBe(true);
    expect(recorded.enqueued).toBe(true);

    const focus = getWorkingBlock('active_focus', {
      conversationId: 'conv-sync',
      threadId: 'conv-sync',
    });
    expect(focus).toBeNull();

    expect(recorded.jobId).not.toBeNull();
    await waitForIngestionJobTerminal(recorded.jobId!);
    const episodes = listEpisodes({ threadId: 'conv-sync' });
    expect(episodes.length).toBeGreaterThan(0);
    expect(JSON.parse(episodes[0].summary)).toMatchObject({ kind: 'structural_turn', version: 1 });
    expect(episodes[0].summary).not.toContain('plan trip');
    expect(episodes[0].summary).not.toContain('Trip planning');
  });

  it('grounds and recalls a natural chitchat memory request without a memory-write tool', async () => {
    const userContent =
      'Please remember that I usually keep weekly planning meetings to 25 minutes.';
    const messages = makeClosedTurn(userContent, 'I will keep that in mind.');
    expect(messages.every((message) => !message.toolCalls?.length)).toBe(true);
    useSettingsStore.setState({
      consolidationProvider: 'provider-memory',
      providers: [
        {
          id: 'provider-memory',
          name: 'Memory provider',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'memory-model',
          enabled: true,
        },
      ],
    } as never);
    mockSendMessage.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_facts: [
                {
                  version: 1,
                  subject_ref: { kind: 'self' },
                  predicate: 'usual_weekly_planning_meeting_duration',
                  value: '25 minutes',
                  scope: 'global',
                  importance: 0.8,
                  confidence: 0.95,
                  source_message_id: 'user-1',
                  operation: 'record',
                  assertion_class: 'current_direct',
                  evidence_quote: userContent,
                  sensitivity: 'personal',
                },
              ],
              episode_summary: null,
              active_focus: null,
              open_threads: [],
              notable: [],
            }),
          },
        },
      ],
    });

    const recorded = await recordCompletedTurnForMemory({
      threadId: 'conv-natural-remember',
      messages,
      sourceEndMessageId: 'assistant-1',
      now: 10,
    });
    expect(recorded.jobId).not.toBeNull();
    await expect(waitForIngestionJobTerminal(recorded.jobId!)).resolves.toEqual(
      expect.objectContaining({ status: 'completed_enriched' }),
    );

    const matchingFacts = listFacts({ limit: 20 }).filter(
      (fact) => fact.predicate === 'usual_weekly_planning_meeting_duration',
    );
    expect(matchingFacts).toHaveLength(1);
    expect(matchingFacts[0]).toMatchObject({
      objectText: '25 minutes',
      sourceMessageId: 'user-1',
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
    });

    const recall = await buildLivingMemorySections({
      conversationId: 'conv-natural-recall',
      sourceThreadId: 'conv-natural-recall',
      personaId: 'default',
      taskId: null,
      messages: [
        {
          id: 'user-recall',
          role: 'user',
          content: 'What is my usual weekly planning meeting duration?',
          timestamp: 20,
        },
      ],
      now: matchingFacts[0]!.createdAt + 1,
      recallLimit: 4,
    });
    expect(recall.recalledFactCount).toBeGreaterThan(0);
    expect(recall.sections.map((section) => section.text).join('\n')).toContain('25 minutes');
  });
});
