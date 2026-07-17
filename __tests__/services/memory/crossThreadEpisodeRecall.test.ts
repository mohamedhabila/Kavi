jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureEpisodeAccessPolicySchema } from '../../../src/services/memory/episodes/accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  bindEpisodeAccessPolicy,
  getEpisodeAccessPolicy,
  revalidateAuthorizedCrossThreadEpisodeOrigin,
} from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  CROSS_THREAD_EPISODE_PROMPT_BUDGET_CHARS,
  CROSS_THREAD_EPISODE_SELECTION_LIMIT,
  CROSS_THREAD_EPISODE_THREAD_FANOUT,
  loadAuthorizedCrossThreadEpisodeCandidates,
  mergeCurrentAndCrossThreadEpisodes,
  selectBoundedCrossThreadEpisodes,
} from '../../../src/services/memory/episodes/crossThreadRecall';
import { loadAuthorizedCurrentThreadEpisodes } from '../../../src/services/memory/episodes/automaticPromptAccess';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { episodePromptLineCost } from '../../../src/services/memory/episodes/promptRendering';
import type { MemoryEpisode } from '../../../src/services/memory/episodes/types';
import { DEFAULT_MEMORY_PERSONA_ID } from '../../../src/services/memory/memoryScopeIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const SESSION_ID = 'session-root';
const CURRENT_THREAD_ID = 'thread-current';
const NOW = 10_000;

let ownerId = '';

function currentScope(
  overrides: Partial<{
    memoryOwnerId: string;
    memoryConversationId: string;
    sourceThreadId: string;
    personaId: string;
    taskId: string | null;
  }> = {},
) {
  return {
    memoryOwnerId: ownerId,
    memoryConversationId: SESSION_ID,
    sourceThreadId: CURRENT_THREAD_ID,
    personaId: DEFAULT_MEMORY_PERSONA_ID,
    taskId: null,
    ...overrides,
  };
}

function seedEpisode(input: {
  suffix: string;
  summary: string;
  threadId?: string;
  conversationId?: string;
  taskId?: string | null;
  personaId?: string;
  shareability?: 'thread_only' | 'session_threads';
  sensitivity?: 'normal' | 'private' | 'sensitive';
  expiresAt?: number | null;
  endedAt?: number;
  bindPolicy?: boolean;
  toolNames?: string[];
}): MemoryEpisode {
  const threadId = input.threadId ?? `thread-${input.suffix}`;
  const conversationId = input.conversationId ?? SESSION_ID;
  const endedAt = input.endedAt ?? 1_000;
  const declaredSensitivity =
    input.sensitivity === 'private'
      ? 'personal'
      : input.sensitivity === 'sensitive'
        ? 'sensitive'
        : 'normal';
  const episode = recordThreadLocalEpisode({
    conversationId,
    threadId,
    taskId: input.taskId ?? null,
    summary: input.summary,
    toolNames: input.toolNames ?? [],
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: `message-${input.suffix}-start`,
      sourceAssistantMessageId: `message-${input.suffix}-end`,
      userContent: `We discussed ${input.summary}.`,
      assistantContent: 'I understood the request.',
      declaredSensitivity,
    }),
    startedAt: endedAt - 10,
    endedAt,
    now: endedAt,
  });
  if (!episode) throw new Error('expected episode');
  if (input.bindPolicy !== false) {
    bindEpisodeAccessPolicy(
      getMemoryDb(),
      {
        episodeId: episode.id,
        memoryOwnerId: ownerId,
        memoryConversationId: conversationId,
        sourceThreadId: threadId,
        personaId: input.personaId ?? DEFAULT_MEMORY_PERSONA_ID,
        taskId: input.taskId ?? null,
        shareability: input.shareability ?? 'session_threads',
        expiresAt: input.expiresAt ?? null,
        boundAt: endedAt,
      },
      endedAt,
    );
  }
  return episode;
}

function insertTaskLocalCrossPolicy(episode: MemoryEpisode, personaId = DEFAULT_MEMORY_PERSONA_ID) {
  getMemoryDb().runSync(
    `INSERT INTO memory_episode_access_policies(
       episode_id, memory_owner_id, memory_conversation_id, source_thread_id,
       persona_id, task_id, shareability, sensitivity, expires_at,
       policy_version, bound_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'session_threads', 'normal', NULL, 1, ?)`,
    episode.id,
    ownerId,
    episode.conversationId,
    episode.threadId,
    personaId,
    episode.taskId,
    episode.endedAt,
  );
}

function load(query: string) {
  return loadAuthorizedCrossThreadEpisodeCandidates({
    db: getMemoryDb(),
    currentScope: currentScope(),
    now: NOW,
    query,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureEpisodeAccessPolicySchema(getMemoryDb(), 1);
  ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('bounded authorized cross-thread episode recall', () => {
  it('recalls relevant continuity with exact origin and ranks relevance before recency', () => {
    const olderRelevant = seedEpisode({
      suffix: 'older-relevant',
      summary: 'Release checklist completed and verified',
      endedAt: 500,
    });
    seedEpisode({
      suffix: 'newer-weaker',
      summary: 'Release discussion continued',
      endedAt: 900,
    });

    const result = load('release checklist');

    expect(result.candidates.map((candidate) => candidate.episode.id)[0]).toBe(olderRelevant.id);
    expect(result.candidates[0]).toMatchObject({
      lane: 'cross_thread',
      accessDecision: { authorized: true, reason: 'eligible' },
      authorizedOrigin: {
        memoryOwnerId: ownerId,
        memoryConversationId: SESSION_ID,
        sourceThreadId: 'thread-older-relevant',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
      },
    });
    expect(result.candidates[0].relevanceScore).toBe(1);
  });

  it('filters unsafe rows before the bounded scan so older relevant continuity is not starved', () => {
    for (let index = 0; index < 30; index += 1) {
      seedEpisode({
        suffix: `private-${index}`,
        summary: 'release private distractor',
        sensitivity: 'private',
        endedAt: 2_000 + index,
      });
    }
    const relevant = seedEpisode({
      suffix: 'safe-older',
      summary: 'release continuity target',
      endedAt: 500,
    });

    const result = load('continuity target');

    expect(result.candidates.map((candidate) => candidate.episode.id)).toContain(relevant.id);
    expect(result.diagnostics.scannedCount).toBe(1);
  });

  it.each([79, 80, 81])(
    'finds relevant continuity behind %i safe newer distractors through the lexical index',
    (distractorCount) => {
      for (let index = 0; index < distractorCount; index += 1) {
        seedEpisode({
          suffix: `safe-distractor-${distractorCount}-${index}`,
          summary: `garden planting note ${index}`,
          endedAt: 2_000 + index,
        });
      }
      const relevant = seedEpisode({
        suffix: `safe-deep-relevant-${distractorCount}`,
        summary: 'release continuity target',
        endedAt: 500,
      });

      const result = load('release continuity');

      expect(result.diagnostics.scannedCount).toBe(1);
      expect(result.candidates.map((candidate) => candidate.episode.id)).toContain(relevant.id);
    },
  );

  it('never leaks cross-persona, cross-session, task, private, current-thread, or unbound rows', () => {
    const otherPersona = seedEpisode({
      suffix: 'other-persona',
      summary: 'continuity forbidden persona',
      personaId: 'coder',
    });
    const otherSession = seedEpisode({
      suffix: 'other-session',
      summary: 'continuity forbidden session',
      conversationId: 'session-other',
    });
    const privateEpisode = seedEpisode({
      suffix: 'private',
      summary: 'continuity forbidden private',
      sensitivity: 'private',
    });
    const currentThread = seedEpisode({
      suffix: 'current',
      summary: 'continuity current thread',
      threadId: CURRENT_THREAD_ID,
    });
    const unbound = seedEpisode({
      suffix: 'unbound',
      summary: 'continuity unbound legacy',
      bindPolicy: false,
    });
    const taskLocal = seedEpisode({
      suffix: 'task-local',
      summary: 'continuity forbidden task',
      taskId: 'task-private',
      bindPolicy: false,
    });
    insertTaskLocalCrossPolicy(taskLocal);

    const result = load('continuity');
    const ids = result.candidates.map((candidate) => candidate.episode.id);

    expect(getEpisodeAccessPolicy(getMemoryDb(), unbound.id)).toBeNull();

    for (const episode of [
      otherPersona,
      otherSession,
      privateEpisode,
      currentThread,
      unbound,
      taskLocal,
    ]) {
      expect(ids).not.toContain(episode.id);
      expect(JSON.stringify(result.diagnostics)).not.toContain(episode.id);
      expect(JSON.stringify(result.diagnostics)).not.toContain(episode.summary);
    }
  });

  it('suppresses empty and irrelevant cross-thread queries', () => {
    seedEpisode({ suffix: 'query', summary: 'release continuity target' });

    const empty = load('   ');
    expect(empty.candidates).toEqual([]);
    expect(empty.diagnostics).toEqual(
      expect.objectContaining({
        queryUnitCount: 0,
        emptyQuerySuppressed: true,
        scannedCount: 0,
      }),
    );

    const irrelevant = load('gardening recipes');
    expect(irrelevant.candidates).toEqual([]);
    expect(irrelevant.diagnostics).toEqual(
      expect.objectContaining({ scannedCount: 0, eligibleCount: 0, relevanceRejectedCount: 0 }),
    );
  });

  it('rejects malformed message and tool source data before prompt selection', () => {
    const malformedMessages = seedEpisode({
      suffix: 'malformed-messages',
      summary: 'release malformed messages',
    });
    const malformedTools = seedEpisode({
      suffix: 'malformed-tools',
      summary: 'release malformed tools',
    });
    getMemoryDb().runSync(
      `UPDATE memory_episodes SET message_ids_json = '{bad-json' WHERE id = ?`,
      malformedMessages.id,
    );
    getMemoryDb().runSync(
      `UPDATE memory_episodes SET tool_names_json = '{bad-json' WHERE id = ?`,
      malformedTools.id,
    );

    const result = load('release malformed');

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasonCounts).toEqual(
      expect.arrayContaining([{ reason: 'malformed_source', count: 2 }]),
    );
  });

  it('revalidates withdrawal tombstones before returning an origin', () => {
    const episode = seedEpisode({ suffix: 'withdrawn', summary: 'release withdrawn source' });
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-cross-recall',
      memoryConversationId: SESSION_ID,
      sourceThreadId: episode.threadId,
      sourceKind: 'message',
      sourceId: episode.sourceStartMessageId,
      retiredAt: 2_000,
    });

    const result = load('release withdrawn');

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasonCounts).toContainEqual({ reason: 'withdrawn', count: 1 });
  });

  it('rejects an episode when any bounded interior source message is withdrawn', () => {
    const episode = seedEpisode({
      suffix: 'withdrawn-interior',
      summary: 'release withdrawn interior source',
    });
    const interiorMessageId = 'message-withdrawn-interior-middle';
    getMemoryDb().runSync(
      'UPDATE memory_episodes SET message_ids_json = ? WHERE id = ?',
      JSON.stringify([episode.sourceStartMessageId, interiorMessageId, episode.sourceEndMessageId]),
      episode.id,
    );
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-interior',
      memoryConversationId: SESSION_ID,
      sourceThreadId: episode.threadId,
      sourceKind: 'message',
      sourceId: interiorMessageId,
      retiredAt: 2_000,
    });

    const result = load('release withdrawn interior');

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasonCounts).toContainEqual({ reason: 'withdrawn', count: 1 });
  });

  it('re-reads the exact policy, episode, and tombstone before authorizing selected origin reuse', () => {
    const policyRemoved = seedEpisode({
      suffix: 'revalidate-policy',
      summary: 'release revalidate policy',
    });
    const episodeDeleted = seedEpisode({
      suffix: 'revalidate-deleted',
      summary: 'release revalidate deleted',
    });
    const withdrawn = seedEpisode({
      suffix: 'revalidate-withdrawn',
      summary: 'release revalidate withdrawn',
    });
    const selected = load('release revalidate').candidates;
    const byId = new Map(selected.map((selection) => [selection.episode.id, selection]));
    const policySelection = byId.get(policyRemoved.id)!;
    const deletedSelection = byId.get(episodeDeleted.id)!;
    const withdrawnSelection = byId.get(withdrawn.id)!;
    const revalidate = (selection: (typeof selected)[number]) =>
      revalidateAuthorizedCrossThreadEpisodeOrigin({
        db: getMemoryDb(),
        currentScope: currentScope(),
        episodeId: selection.episode.id,
        authorizedOrigin: selection.authorizedOrigin,
        asOf: NOW,
      });

    expect(revalidate(policySelection)).toEqual(policySelection.authorizedOrigin);
    expect(
      revalidateAuthorizedCrossThreadEpisodeOrigin({
        db: getMemoryDb(),
        currentScope: currentScope(),
        episodeId: policySelection.episode.id,
        authorizedOrigin: {
          ...policySelection.authorizedOrigin,
          sourceThreadId: 'thread-stale-origin',
        },
        asOf: NOW,
      }),
    ).toBeNull();

    getMemoryDb().runSync(
      'DELETE FROM memory_episode_access_policies WHERE episode_id = ?',
      policyRemoved.id,
    );
    getMemoryDb().runSync(
      'UPDATE memory_episodes SET deleted_at = ? WHERE id = ?',
      2_000,
      episodeDeleted.id,
    );
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-revalidate',
      memoryConversationId: SESSION_ID,
      sourceThreadId: withdrawn.threadId,
      sourceKind: 'turn',
      sourceId: withdrawn.sourceEndMessageId,
      retiredAt: 2_000,
    });

    expect(revalidate(policySelection)).toBeNull();
    expect(revalidate(deletedSelection)).toBeNull();
    expect(revalidate(withdrawnSelection)).toBeNull();
  });

  it('bounds thread fanout, selection count, and actual rendered prompt cost', () => {
    for (let index = 0; index < 4; index += 1) {
      seedEpisode({
        suffix: `fanout-${index}`,
        threadId: `fanout-thread-${index}`,
        summary: `continuity ${'x'.repeat(900)}`,
        endedAt: 1_000 - index,
      });
    }

    const loaded = load('continuity');
    expect(new Set(loaded.candidates.map((candidate) => candidate.episode.threadId)).size).toBe(
      CROSS_THREAD_EPISODE_THREAD_FANOUT,
    );
    const selected = selectBoundedCrossThreadEpisodes(loaded);
    expect(selected.candidates).toHaveLength(CROSS_THREAD_EPISODE_SELECTION_LIMIT);
    expect(
      selected.candidates.reduce((total, candidate) => total + episodePromptLineCost(candidate), 0),
    ).toBeLessThanOrEqual(CROSS_THREAD_EPISODE_PROMPT_BUDGET_CHARS);
  });

  it('uses a repeated trajectory slot for its newest relevant state', () => {
    const threadId = 'thread-evolving-state';
    const semanticAnchor = seedEpisode({
      suffix: 'state-semantic-anchor',
      threadId,
      summary: 'release checklist target complete',
      endedAt: 500,
    });
    const secondNewestRelevant = seedEpisode({
      suffix: 'state-second-old',
      threadId,
      summary: 'release checklist followup',
      endedAt: 700,
    });
    const newestRelevant = seedEpisode({
      suffix: 'state-newest',
      threadId,
      summary: 'release state changed',
      endedAt: 900,
    });

    const loaded = load('release checklist target');
    expect(loaded.candidates[0]?.episode.id).toBe(semanticAnchor.id);
    expect(loaded.candidates[1]?.episode.id).toBe(newestRelevant.id);
    expect(loaded.candidates[2]?.episode.id).toBe(secondNewestRelevant.id);
    expect(
      selectBoundedCrossThreadEpisodes(loaded).candidates.map(({ episode }) => episode.id),
    ).toEqual([semanticAnchor.id, newestRelevant.id, secondNewestRelevant.id]);
  });

  it('preserves a distinct trajectory in the second relevance slot', () => {
    const semanticAnchor = seedEpisode({
      suffix: 'diverse-semantic-anchor',
      threadId: 'thread-diverse-a',
      summary: 'release checklist target complete',
      endedAt: 500,
    });
    const distinctSecond = seedEpisode({
      suffix: 'diverse-second',
      threadId: 'thread-diverse-b',
      summary: 'release checklist followup',
      endedAt: 700,
    });
    seedEpisode({
      suffix: 'diverse-newest',
      threadId: 'thread-diverse-a',
      summary: 'release state changed',
      endedAt: 900,
    });

    const selected = selectBoundedCrossThreadEpisodes(load('release checklist target')).candidates;
    expect(selected.slice(0, 2).map(({ episode }) => episode.id)).toEqual([
      semanticAnchor.id,
      distinctSecond.id,
    ]);
  });

  it('keeps current-thread candidates first and only fills unused capacity cross-thread', () => {
    const current = seedEpisode({
      suffix: 'priority-current',
      threadId: CURRENT_THREAD_ID,
      summary: 'release current priority',
    });
    const cross = load('release');
    if (cross.candidates.length === 0) {
      seedEpisode({ suffix: 'priority-cross', summary: 'release cross continuity' });
    }
    const loaded = load('release');

    const currentSelection = loadAuthorizedCurrentThreadEpisodes({
      db: getMemoryDb(),
      currentScope: currentScope(),
      now: NOW,
      query: 'release current',
      resultLimit: 1,
    }).selections;
    expect(currentSelection[0]?.episode.id).toBe(current.id);
    const one = mergeCurrentAndCrossThreadEpisodes(currentSelection, loaded, 1);
    expect(one.selections).toEqual([
      expect.objectContaining({
        lane: 'current_thread',
        episode: expect.objectContaining({ id: current.id }),
      }),
    ]);
    const two = mergeCurrentAndCrossThreadEpisodes(currentSelection, loaded, 2);
    expect(two.selections[0]).toEqual(
      expect.objectContaining({
        lane: 'current_thread',
        episode: expect.objectContaining({ id: current.id }),
      }),
    );
    expect(two.selections[1]).toEqual(expect.objectContaining({ lane: 'cross_thread' }));
  });

  it('rejects non-finite selection and result limits', () => {
    const loaded = load('release');
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => selectBoundedCrossThreadEpisodes(loaded, value)).toThrow(
        'cross_thread_episode_selection_limit_invalid',
      );
      expect(() => mergeCurrentAndCrossThreadEpisodes([], loaded, value)).toThrow(
        'episode_recall_result_limit_invalid',
      );
    }
  });
});
