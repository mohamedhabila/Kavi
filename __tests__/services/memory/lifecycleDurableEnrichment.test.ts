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

import { getConsolidationState } from '../../../src/services/memory/consolidatorScheduler';
import { upsertEntity } from '../../../src/services/memory/entities';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
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
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { persistMemoryRemember } from '../../../src/services/memory/memoryRememberPersistence';
import { bindMemoryRememberSemanticEvidence } from '../../../src/services/memory/memoryRememberSemanticEvidence';
import { useChatStore } from '../../../src/store/useChatStore';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
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
      sourceEndMessageId: 'a-1',
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
        content:
          'release title is Production Mobile Release. Create and remember the release artifact.',
        timestamp: 1,
      },
      {
        id: 'a-retry-tool-request',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tool-retry',
            name: 'write_file',
            arguments: JSON.stringify({ path: '/workspace/release.aab' }),
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-retry-result',
        role: 'tool',
        toolCallId: 'tool-retry',
        content: JSON.stringify({ ok: true, path: '/workspace/release.aab' }),
        timestamp: 2,
      },
      {
        id: 'a-retry',
        role: 'assistant',
        content: 'Created the release artifact.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
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
      sourceEndMessageId: 'a-retry',
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
                  version: 1,
                  subject_ref: { kind: 'named', label: 'release' },
                  predicate: 'release_title',
                  value: 'Production Mobile Release',
                  scope: 'conversation',
                  importance: 0.7,
                  confidence: 0.9,
                  source_message_id: 'u-retry',
                  operation: 'record',
                  assertion_class: 'current_direct',
                  evidence_quote: 'release title is Production Mobile Release',
                  sensitivity: 'normal',
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
      now: retryingJob!.nextAttemptAt!,
    });
    const episodes = listEpisodes({ threadId: 'conv-provider-retry' });
    const facts = listFacts({ originConversationId: 'conv-provider-retry', limit: 20 });
    const providerFacts = facts.filter((fact) => fact.predicate === 'release_title');
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

  it('does not let prior enrichment resurrect a value superseded by a checkpointed successor', async () => {
    useSettingsStore.setState({
      consolidationProvider: 'provider-causal',
      providers: [
        {
          id: 'provider-causal',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          enabled: true,
        },
      ],
    } as any);
    const threadId = 'conv-provider-causal';
    const user = upsertEntity({ name: 'user', type: 'self', now: 50 });
    recordFactWithApplicability(
      {
        subjectId: user.id,
        predicate: 'preferred_channel',
        objectText: 'Email',
        scope: 'conversation',
        originConversationId: threadId,
        originThreadId: threadId,
        sourceMessageId: 'u-causal-seed',
        now: 50,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
    const history: Message[] = [
      {
        id: 'u-causal-prior',
        role: 'user',
        content: 'My preferred channel is Signal.',
        timestamp: 1,
      },
      {
        id: 'a-causal-prior',
        role: 'assistant',
        content: 'I will remember it.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
      {
        id: 'u-causal-successor',
        role: 'user',
        content: 'My preferred channel is WhatsApp.',
        timestamp: 3,
      },
      {
        id: 'a-causal-successor',
        role: 'assistant',
        content: 'I will remember that too.',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
    ];
    const prior = enqueueIngestionJob({
      personaId: 'default',
      threadId,
      threadTitle: null,
      memoryConversationId: threadId,
      taskId: null,
      sourceStartMessageId: 'u-causal-prior',
      sourceEndMessageId: 'a-causal-prior',
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
      sourceSnapshot: encodeIngestionSourceSnapshot({
        messages: history,
        priorUserMessageId: null,
        sourceStartMessageId: 'u-causal-prior',
        sourceEndMessageId: 'a-causal-prior',
      }),
    })!;
    mockSendMessage.mockRejectedValueOnce(new Error('temporary timeout'));

    await drainIngestionQueue({ now: 100 });
    const priorRetry = getIngestionJob(prior.id)!;
    expect(priorRetry).toEqual(
      expect.objectContaining({ status: 'retrying', structuralCompletedAt: 100 }),
    );
    const successor = enqueueIngestionJob({
      personaId: 'default',
      threadId,
      threadTitle: null,
      memoryConversationId: threadId,
      taskId: null,
      priorUserMessageId: 'u-causal-prior',
      sourceStartMessageId: 'u-causal-successor',
      sourceEndMessageId: 'a-causal-successor',
      sourceRunId: null,
      sourceAt: 101,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 101,
      sourceSnapshot: encodeIngestionSourceSnapshot({
        messages: history,
        priorUserMessageId: 'u-causal-prior',
        sourceStartMessageId: 'u-causal-successor',
        sourceEndMessageId: 'a-causal-successor',
      }),
    })!;
    mockSendMessage
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                new_facts: [
                  {
                    version: 1,
                    subject_ref: { kind: 'self' },
                    predicate: 'preferred_channel',
                    value: 'Signal',
                    scope: 'conversation',
                    importance: 0.8,
                    confidence: 0.95,
                    source_message_id: 'u-causal-prior',
                    operation: 'replace_current',
                    assertion_class: 'current_direct',
                    evidence_quote: 'My preferred channel is Signal',
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
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                new_facts: [
                  {
                    version: 1,
                    subject_ref: { kind: 'self' },
                    predicate: 'preferred_channel',
                    value: 'WhatsApp',
                    scope: 'conversation',
                    importance: 0.8,
                    confidence: 0.95,
                    source_message_id: 'u-causal-successor',
                    operation: 'replace_current',
                    assertion_class: 'current_direct',
                    evidence_quote: 'My preferred channel is WhatsApp',
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

    await drainIngestionQueue({ maxJobs: 1, now: 101 });

    expect(getIngestionJob(successor.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        attemptCount: 0,
        providerOutcome: 'structural_only',
        structuralCompletedAt: 101,
      }),
    );
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(getConsolidationState(threadId)).toBeNull();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(101);
    const correctionText = 'My preferred channel is WhatsApp.';
    const correctionContext = memoryRememberExecution({
      memoryConversationId: threadId,
      sourceThreadId: threadId,
      userMessageId: 'u-causal-successor',
      userMessageText: correctionText,
      claimedAt: 101,
    });
    const correctionArgs = memoryRememberArgs({
      userMessageId: 'u-causal-successor',
      userMessageText: correctionText,
      subjectRef: { kind: 'self' },
      predicate: 'preferred_channel',
      value: 'WhatsApp',
      scope: 'conversation',
      operation: 'replace_current',
      pinned: false,
    });
    const semanticEvidence = bindMemoryRememberSemanticEvidence(
      correctionArgs.semanticEvidence,
      correctionContext.requestEvidence,
    );
    if (!semanticEvidence.valid) throw new Error(semanticEvidence.code);
    const successorCorrection = persistMemoryRemember(
      {
        semanticEvidence: semanticEvidence.evidence,
        pinned: false,
      },
      correctionContext,
    );
    dateNow.mockRestore();
    expect(successorCorrection).toMatchObject({
      status: 'persisted',
      grounded: true,
      result: { fact: { objectText: 'WhatsApp', validAt: 101 } },
    });

    await drainIngestionQueue({
      maxJobs: 1,
      now: priorRetry.nextAttemptAt!,
    });
    expect(getIngestionJob(prior.id)?.status).toBe('completed_enriched');
    expect(getIngestionJob(successor.id)?.status).toBe('retrying');
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(getConsolidationState(threadId)?.lastConsolidatedMessageId).toBe('a-causal-prior');
    expect(listFacts({ predicate: 'preferred_channel', originConversationId: threadId })).toEqual([
      expect.objectContaining({ objectText: 'WhatsApp', validAt: 101, invalidAt: null }),
    ]);
    expect(
      listFacts({
        predicate: 'preferred_channel',
        originConversationId: threadId,
        includeInvalidated: true,
      }).some((fact) => fact.objectText === 'Signal'),
    ).toBe(false);

    await drainIngestionQueue({
      maxJobs: 1,
      now: priorRetry.nextAttemptAt!,
    });
    expect(getIngestionJob(successor.id)).toEqual(
      expect.objectContaining({ status: 'completed_enriched', attemptCount: 1 }),
    );
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    expect(getConsolidationState(threadId)?.lastConsolidatedMessageId).toBe('a-causal-successor');
    expect(listFacts({ predicate: 'preferred_channel', originConversationId: threadId })).toEqual([
      expect.objectContaining({ objectText: 'WhatsApp', invalidAt: null }),
    ]);
  });
});
