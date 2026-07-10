// ---------------------------------------------------------------------------
// Tests — Durable memory enrichment retries
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
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  getIngestionJob,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetMemoryLifecycleForTests,
  recordCompletedTurnForMemory,
} from '../../../src/services/memory/lifecycle';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
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

afterEach(() => {
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

async function waitForJobStatus(
  jobId: string,
  status: 'retrying' | 'completed_structural' | 'completed_enriched' | 'failed',
): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    if (getIngestionJob(jobId)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ingestion job ${jobId} to become ${status}`);
}

describe('durable memory enrichment retries', () => {
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

  it('keeps sync focus but leaves durable enrichment retryable when provider extraction fails', async () => {
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
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-provider-fail',
          title: 'Release hardening',
          messages,
          createdAt: 1,
          updatedAt: 2,
          agentRuns: [],
        },
      ],
    } as any);

    const result = await recordCompletedTurnForMemory({
      threadId: 'conv-provider-fail',
      threadTitle: 'Release hardening',
      messages,
      now: 10,
    });

    expect(result.processed).toBe(true);
    expect(result.enqueued).toBe(true);
    await waitForJobStatus(result.jobId!, 'retrying');
    expect(getIngestionJob(result.jobId!)).toEqual(
      expect.objectContaining({ status: 'retrying', outcomeCode: 'provider_request_failed' }),
    );
    expect(listEpisodes({ threadId: 'conv-provider-fail' })).toHaveLength(1);
    expect(getConsolidationState('conv-provider-fail')).toBeNull();
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-provider-fail',
        threadId: 'conv-provider-fail',
      })?.content,
    ).toContain('Release hardening');
  });

  it('enriches one structural episode and its evidence without duplicating retry writes', async () => {
    useSettingsStore.setState({
      consolidationProvider: 'provider-retry',
      providers: [
        {
          id: 'provider-retry',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);
    const retryMessages: Message[] = [
      {
        id: 'u-retry',
        role: 'user',
        content: 'Create and remember the release artifact.',
        timestamp: 1,
      },
      {
        id: 'a-retry',
        role: 'assistant',
        content: 'Created the release artifact.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        toolCalls: [
          {
            id: 'tool-retry',
            name: 'write_file',
            arguments: JSON.stringify({ path: '/workspace/release.aab' }),
          },
        ],
      },
    ];
    mockSendMessage.mockRejectedValueOnce(new Error('temporary timeout'));
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-provider-retry',
          title: 'Release artifact',
          messages: retryMessages,
          createdAt: 1,
          updatedAt: 2,
          agentRuns: [],
        },
      ],
    } as any);
    const recorded = await recordCompletedTurnForMemory({
      threadId: 'conv-provider-retry',
      messages: retryMessages,
      now: 100,
    });

    await waitForJobStatus(recorded.jobId!, 'retrying');
    const retryingJob = getIngestionJob(recorded.jobId!);
    const firstEpisode = listEpisodes({ threadId: 'conv-provider-retry' })[0]!;
    const firstFacts = listFacts({ originConversationId: 'conv-provider-retry', limit: 20 });
    const firstEvidenceCount = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_evidence',
    )!.count;

    expect(retryingJob?.status).toBe('retrying');
    expect(firstFacts.some((fact) => fact.predicate === 'file_operation')).toBe(true);

    mockSendMessage.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_facts: [
                {
                  subject: 'user',
                  predicate: 'release_target',
                  value: 'production mobile release',
                  scope: 'conversation',
                  confidence: 0.9,
                  evidence_message_ids: ['u-retry'],
                },
              ],
              episode_summary: 'Created the production mobile release artifact.',
              active_focus: null,
              open_threads: [],
              notable: [],
            }),
          },
        },
      ],
    });

    const secondDrain = await drainIngestionQueue({
      loadMessagesForThread: () => retryMessages,
      now: retryingJob!.nextAttemptAt!,
    });
    const episodes = listEpisodes({ threadId: 'conv-provider-retry' });
    const facts = listFacts({ originConversationId: 'conv-provider-retry', limit: 20 });
    const providerFacts = facts.filter((fact) => fact.predicate === 'release_target');
    const structuralFacts = facts.filter((fact) => fact.predicate === 'file_operation');
    const evidenceCount = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_evidence',
    )!.count;

    expect(secondDrain.completedEnriched).toBe(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      id: firstEpisode.id,
      sourceStartMessageId: 'u-retry',
      sourceEndMessageId: 'a-retry',
      summary: 'Created the production mobile release artifact.',
    });
    expect(structuralFacts).toHaveLength(1);
    expect(structuralFacts[0]?.repeatedMentionCount).toBe(0);
    expect(providerFacts).toHaveLength(1);
    expect(evidenceCount).toBe(firstEvidenceCount + 1);
    expect(getConsolidationState('conv-provider-retry')?.lastConsolidatedMessageId).toBe('a-retry');
  });
});
