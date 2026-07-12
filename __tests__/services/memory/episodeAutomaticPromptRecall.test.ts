jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
import { bindEpisodeAccessPolicy } from '../../../src/services/memory/episodes/accessPolicyStore';
import { ensureEpisodeAccessPolicySchema } from '../../../src/services/memory/episodes/accessPolicySchema';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import {
  EPISODE_QUERY_CANDIDATE_MAX,
  recallScopedEpisodesForQuery,
  type RecallEpisodesTiming,
} from '../../../src/services/memory/episodeRecall';
import { DEFAULT_MEMORY_PERSONA_ID } from '../../../src/services/memory/memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureEpisodeAccessPolicySchema(getMemoryDb(), 1);
});

afterEach(() => {
  closeMemoryDb();
});

function makeCompleteEpisode(
  suffix: string,
  overrides: Partial<Parameters<typeof recordThreadLocalEpisode>[0]> = {},
) {
  const messageIds = [`message-${suffix}-start`, `message-${suffix}-end`];
  const episode = recordThreadLocalEpisode({
    conversationId: 'root-conversation',
    threadId: `thread-${suffix}`,
    summary: `release continuity ${suffix}`,
    messageIds,
    sourceStartMessageId: `message-${suffix}-start`,
    sourceEndMessageId: `message-${suffix}-end`,
    startedAt: 90,
    endedAt: 100,
    sensitivityEvidence: {
      sourceMessages: [
        { id: messageIds[0]!, role: 'user', content: 'Please continue the release work.' },
        { id: messageIds[1]!, role: 'assistant', content: 'The release work continued.' },
      ],
      facts: [],
    },
    now: 100,
    ...overrides,
  });
  if (!episode) throw new Error('recordThreadLocalEpisode returned null');
  return episode;
}

function closedTurnEvidence(suffix: string, userContent: string) {
  return {
    sourceMessages: [
      { id: `message-${suffix}-start`, role: 'user' as const, content: userContent },
      {
        id: `message-${suffix}-end`,
        role: 'assistant' as const,
        content: 'I understood the request.',
      },
    ],
    facts: [],
  };
}

function bindCurrentEpisode(
  episode: ReturnType<typeof makeCompleteEpisode>,
  ownerId: string,
): void {
  bindEpisodeAccessPolicy(
    getMemoryDb(),
    {
      episodeId: episode.id,
      memoryOwnerId: ownerId,
      memoryConversationId: 'root-conversation',
      sourceThreadId: 'thread-current',
      personaId: DEFAULT_MEMORY_PERSONA_ID,
      taskId: null,
      shareability: 'thread_only',
      boundAt: episode.endedAt,
    },
    episode.endedAt,
  );
}

describe('recallScopedEpisodesForQuery', () => {
  it('keeps root and source thread distinct while current-first filling with authorized cross-thread continuity', () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const current = makeCompleteEpisode('current', {
      threadId: 'thread-current',
      summary: 'release current checkpoint',
    });
    makeCompleteEpisode('wrong-root', {
      conversationId: 'other-root',
      threadId: 'thread-current',
      summary: 'release forbidden root',
    });
    makeCompleteEpisode('task-local', {
      threadId: 'thread-current',
      taskId: 'task-private',
      summary: 'release forbidden task',
    });
    const cross = makeCompleteEpisode('cross', {
      threadId: 'thread-cross',
      summary: 'release cross continuity',
    });
    bindEpisodeAccessPolicy(
      db,
      {
        episodeId: current.id,
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
        shareability: 'thread_only',
        boundAt: 100,
      },
      100,
    );
    bindEpisodeAccessPolicy(
      db,
      {
        episodeId: cross.id,
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-cross',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
        shareability: 'session_threads',
        boundAt: 100,
      },
      100,
    );

    let timing: RecallEpisodesTiming | undefined;
    const result = recallScopedEpisodesForQuery('release continuity checkpoint', {
      currentScope: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 2,
      now: 200,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(result.selections).toHaveLength(2);
    expect(result.selections[0]).toMatchObject({
      lane: 'current_thread',
      episode: { id: current.id },
      authorizedOrigin: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
    });
    expect(result.selections[1]).toMatchObject({
      lane: 'cross_thread',
      episode: { id: cross.id },
      authorizedOrigin: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-cross',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
    });
    expect(result.selections.map((selection) => selection.episode.summary)).not.toEqual(
      expect.arrayContaining(['release forbidden root', 'release forbidden task']),
    );
    expect(timing).toMatchObject({
      candidateCount: 2,
      resultCount: 2,
      resultLimit: 2,
    });
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.fetchMs);
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.scoreMs);
    expect(timing!.totalMs).toBeGreaterThanOrEqual(timing!.sortMs);
    expect(result.diagnostics).toMatchObject({
      scannedCount: 1,
      eligibleCount: 1,
      selectedCount: 1,
    });
  });

  it('reports current-only candidates without inventing cross-thread work', () => {
    const current = makeCompleteEpisode('only-current', {
      threadId: 'thread-current',
      summary: 'release current only',
    });
    const db = getMemoryDb();
    bindEpisodeAccessPolicy(
      db,
      {
        episodeId: current.id,
        memoryOwnerId: getLocalMemoryVaultOwnerId(db),
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
        shareability: 'thread_only',
        boundAt: 100,
      },
      100,
    );
    let timing: RecallEpisodesTiming | undefined;

    const result = recallScopedEpisodesForQuery('release current', {
      currentScope: {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 2,
      now: 200,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(result.selections).toEqual([expect.objectContaining({ lane: 'current_thread' })]);
    expect(result.diagnostics).toMatchObject({ scannedCount: 0, eligibleCount: 0 });
    expect(timing).toMatchObject({ candidateCount: 1, resultCount: 1 });
  });

  it('fails closed for unbound, private, sensitive, and policy-mismatched current episodes', () => {
    const ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    const normal = makeCompleteEpisode('authorized-normal', {
      threadId: 'thread-current',
      summary: 'release current authorized normal',
    });
    bindCurrentEpisode(normal, ownerId);

    makeCompleteEpisode('unbound-normal', {
      threadId: 'thread-current',
      summary: 'release current unbound normal',
    });
    const privateEpisode = makeCompleteEpisode('private-current', {
      threadId: 'thread-current',
      summary: 'release current private episode',
      sensitivityEvidence: closedTurnEvidence('private-current', 'My city is Delft.'),
    });
    const sensitiveEpisode = makeCompleteEpisode('sensitive-current', {
      threadId: 'thread-current',
      summary: 'release current sensitive episode',
      sensitivityEvidence: closedTurnEvidence(
        'sensitive-current',
        'My passport number is P1234567.',
      ),
    });
    bindCurrentEpisode(privateEpisode, ownerId);
    bindCurrentEpisode(sensitiveEpisode, ownerId);

    const mismatchedPolicy = makeCompleteEpisode('mismatched-policy', {
      threadId: 'thread-current',
      summary: 'release current mismatched policy',
    });
    bindCurrentEpisode(mismatchedPolicy, ownerId);
    getMemoryDb().runSync(
      "UPDATE memory_episode_access_policies SET sensitivity = 'private' WHERE episode_id = ?",
      mismatchedPolicy.id,
    );

    const result = recallScopedEpisodesForQuery('release current', {
      currentScope: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 20,
      now: 200,
    });

    expect(result.selections.map((selection) => selection.episode.id)).toEqual([normal.id]);
    expect(result.selections[0]).toMatchObject({
      lane: 'current_thread',
      accessDecision: { authorized: true, reason: 'eligible' },
      authorizedOrigin: { sourceThreadId: 'thread-current', policyVersion: 1 },
    });
  });

  it('pre-filters inaccessible current-thread corpus rows before the candidate bound', () => {
    const ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    for (let index = 0; index < EPISODE_QUERY_CANDIDATE_MAX + 1; index += 1) {
      const suffix = `hidden-sensitive-${index}`;
      const episode = makeCompleteEpisode(suffix, {
        threadId: 'thread-current',
        summary: `release continuity hidden ${index}`,
        endedAt: 120 + index,
        now: 120 + index,
        sensitivityEvidence: closedTurnEvidence(suffix, 'My passport number is P1234567.'),
      });
      bindCurrentEpisode(episode, ownerId);
    }
    const target = makeCompleteEpisode('visible-target', {
      threadId: 'thread-current',
      summary: 'release continuity visible target',
      endedAt: 100,
      now: 100,
    });
    bindCurrentEpisode(target, ownerId);
    let timing: RecallEpisodesTiming | undefined;

    const result = recallScopedEpisodesForQuery('release continuity visible target', {
      currentScope: {
        memoryOwnerId: ownerId,
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      limit: 1,
      now: 300,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(result.selections.map((selection) => selection.episode.id)).toEqual([target.id]);
    expect(timing).toMatchObject({ candidateCount: 1, resultCount: 1 });
  });
});
