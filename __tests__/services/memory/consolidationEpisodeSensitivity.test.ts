jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { applyConsolidatorResult } from '../../../src/services/memory/consolidation/persistence';
import { getEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import { listEpisodes } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type { ConsolidatorResult } from '../../../src/services/memory/consolidator';
import type { Message } from '../../../src/types/message';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../../src/services/memory/consolidation/factContributionIdentity';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const CODE_OWNED_NORMAL_SENSITIVITY = {
  version: 1,
  source: 'code_owned',
  sensitivity: 'normal',
} as const;
const PROVIDER_SENSITIVE_SENSITIVITY = {
  version: 1,
  source: 'provider',
  sensitivity: 'sensitive',
} as const;
const PROVIDER_RESTRICTED_SENSITIVITY = {
  version: 1,
  source: 'provider',
  sensitivity: 'restricted',
} as const;

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
  episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
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

  it('uses the typed episode declaration as a monotonic floor across replay', () => {
    const first = persist(NORMAL_RESULT, 30);
    const raised = persist(
      {
        ...NORMAL_RESULT,
        episodeSummary: '任意の要約',
        episodeSensitivityDeclaration: PROVIDER_SENSITIVE_SENSITIVITY,
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

  it('raises both fact and episode from a typed fact declaration', () => {
    const receipt = persist(
      {
        ...NORMAL_RESULT,
        newFacts: [
          {
            subject: '対象',
            predicate: '属性',
            value: '任意値',
            scope: 'conversation',
            sensitivityDeclaration: PROVIDER_SENSITIVE_SENSITIVITY,
          },
        ],
      },
      30,
    );

    expect(receipt.recordedFacts).toHaveLength(1);
    expect(listFacts({ originConversationId: 'episode-root' })[0]?.sensitivity).toBe('sensitive');
    const episode = listEpisodes({ threadId: 'episode-thread' })[0];
    expect(episode.sensitivity).toBe('sensitive');
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)?.sensitivity).toBe('sensitive');
  });

  it('does not persist an episode with a restricted provider declaration', () => {
    const receipt = persist(
      {
        ...NORMAL_RESULT,
        episodeSummary: 'opaque-summary',
        episodeSensitivityDeclaration: PROVIDER_RESTRICTED_SENSITIVITY,
      },
      30,
    );

    expect(receipt.episodeId).toBeNull();
    expect(listEpisodes({ threadId: 'episode-thread' })).toEqual([]);
  });

  it('structurally raises a normal declaration to restricted without language labels', () => {
    const syntheticStructuredSecret = `${'sk'}-${'proj'}-${'abcdefghijkl'}${'mnopqrstuvwx'}`;
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
            result: syntheticStructuredSecret,
          },
        ],
      },
      MESSAGES[1],
    ];
    const receipt = applyConsolidatorResult(NORMAL_RESULT, {
      conversationId: 'tool-root',
      threadId: 'tool-thread',
      sourceUserMessageId: 'episode-user',
      sourceAssistantMessageId: 'episode-assistant',
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
      messages,
      episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      now: 30,
    });

    expect(receipt.episodeId).toBeNull();
    expect(listEpisodes({ threadId: 'tool-thread' })).toEqual([]);
  });

  it('fails closed when a raw message field exceeds the bounded classifier input', () => {
    const receipt = applyConsolidatorResult(NORMAL_RESULT, {
      conversationId: 'oversize-root',
      threadId: 'oversize-thread',
      sourceUserMessageId: 'episode-user',
      sourceAssistantMessageId: 'episode-assistant',
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn,
      messages: [{ ...MESSAGES[0], content: 'x'.repeat(16_001) }, MESSAGES[1]],
      episodeAccess: { personaId: 'default', shareability: 'session_threads' },
      now: 30,
    });

    expect(receipt.episodeId).toBeNull();
    expect(listEpisodes({ threadId: 'oversize-thread' })).toEqual([]);
  });
});
