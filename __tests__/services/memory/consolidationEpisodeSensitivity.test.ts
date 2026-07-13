jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { applyConsolidatorResult } from '../../../src/services/memory/consolidation/persistence';
import { getEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type { ConsolidatorResult } from '../../../src/services/memory/consolidator';
import type { Message } from '../../../src/types/message';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../../src/services/memory/consolidation/factContributionIdentity';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const MESSAGES: Message[] = [
  { id: 'episode-user', role: 'user', content: 'Plan a museum visit.', timestamp: 10 },
  {
    id: 'episode-assistant',
    role: 'assistant',
    content: 'The museum opens at ten.',
    timestamp: 20,
  },
];

const NORMAL_RESULT: ConsolidatorResult = {
  episodeSummary: 'Planned a museum visit.',
  newFacts: [],
  activeFocus: null,
  openThreads: [],
  notable: [],
};

function persist(result: ConsolidatorResult, now: number) {
  return applyConsolidatorResult(result, {
    conversationId: 'episode-root',
    threadId: 'episode-thread',
    sourceUserMessageId: 'episode-user',
    sourceAssistantMessageId: 'episode-assistant',
    factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
    messages: MESSAGES,
    episodeAccess: { personaId: 'default', shareability: 'session_threads' },
    now,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('consolidation episode sensitivity persistence', () => {
  it('derives normal sensitivity and binds policy from the persisted episode', () => {
    const receipt = persist(NORMAL_RESULT, 30);
    const episode = listEpisodes({ threadId: 'episode-thread' })[0];

    expect(episode).toMatchObject({ id: receipt.episodeId, sensitivity: 'normal' });
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)?.sensitivity).toBe('normal');
  });

  it('raises episode and policy together on replay and never lowers them', () => {
    const first = persist(NORMAL_RESULT, 30);
    const raised = persist(
      {
        ...NORMAL_RESULT,
        episodeSummary: 'Discussed the user home address.',
      },
      40,
    );
    expect(raised.episodeId).toBe(first.episodeId);
    expect(listEpisodes({ threadId: 'episode-thread' })[0].sensitivity).toBe('sensitive');
    expect(getEpisodeAccessPolicy(getMemoryDb(), first.episodeId!)?.sensitivity).toBe('sensitive');

    persist(NORMAL_RESULT, 50);
    expect(listEpisodes({ threadId: 'episode-thread' })[0].sensitivity).toBe('sensitive');
    expect(getEpisodeAccessPolicy(getMemoryDb(), first.episodeId!)?.sensitivity).toBe('sensitive');
  });

  it('finds credentials in tool-call results even with an innocuous provider summary', () => {
    const messages: Message[] = [
      MESSAGES[0],
      {
        id: 'episode-tool-host',
        role: 'assistant',
        content: '',
        timestamp: 15,
        toolCalls: [
          {
            id: 'tool-call',
            name: 'remote_status',
            arguments: '{}',
            status: 'completed',
            result: 'API key sk-tool-result-only-12345 was invalid.',
          },
        ],
      },
      MESSAGES[1],
    ];
    applyConsolidatorResult(NORMAL_RESULT, {
      conversationId: 'tool-root',
      threadId: 'tool-thread',
      sourceUserMessageId: 'episode-user',
      sourceAssistantMessageId: 'episode-assistant',
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
      messages,
      episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      now: 30,
    });

    const episode = listEpisodes({ threadId: 'tool-thread' })[0];
    expect(episode.sensitivity).toBe('sensitive');
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)?.sensitivity).toBe('sensitive');
  });

  it('fails closed when a raw message field exceeds the bounded classifier input', () => {
    applyConsolidatorResult(NORMAL_RESULT, {
      conversationId: 'oversize-root',
      threadId: 'oversize-thread',
      sourceUserMessageId: 'episode-user',
      sourceAssistantMessageId: 'episode-assistant',
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
      messages: [{ ...MESSAGES[0], content: 'x'.repeat(16_001) }, MESSAGES[1]],
      episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      now: 30,
    });

    const episode = listEpisodes({ threadId: 'oversize-thread' })[0];
    expect(episode.sensitivity).toBe('sensitive');
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)?.sensitivity).toBe('sensitive');
  });
});
