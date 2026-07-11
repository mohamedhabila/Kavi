jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import {
  decideCrossThreadEpisodeAccess,
  episodeAccessPolicyFromRow,
} from '../../../src/services/memory/episodes/accessPolicy';
import {
  clearEpisodeAccessPolicies,
  deleteEpisodeAccessPolicies,
  ensureEpisodeAccessPolicySchema,
} from '../../../src/services/memory/episodes/accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  bindEpisodeAccessPolicy,
  getEpisodeAccessPolicy,
} from '../../../src/services/memory/episodes/accessPolicyStore';
import type { EpisodeAccessPolicyRow } from '../../../src/services/memory/episodes/accessPolicyTypes';
import {
  recordEpisode,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import type { EpisodeRow } from '../../../src/services/memory/episodes/types';
import {
  DEFAULT_MEMORY_PERSONA_ID,
  requireMemoryAccessScopeIdentity,
  resolveCodeOwnedMemoryPersonaId,
} from '../../../src/services/memory/memoryScopeIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function rawEpisode(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 'episode-policy',
    conversation_id: 'session-root',
    thread_id: 'thread-origin',
    task_id: null,
    started_at: 10,
    ended_at: 20,
    summary: 'Reviewed the release checklist',
    entities_json: '[]',
    message_ids_json: '["message-start","message-end"]',
    tool_names_json: '["calendar"]',
    importance: 0.8,
    embedding: null,
    created_at: 20,
    deleted_at: null,
    source_start_message_id: 'message-start',
    source_end_message_id: 'message-end',
    ...overrides,
  };
}

function rawPolicy(overrides: Partial<EpisodeAccessPolicyRow> = {}): EpisodeAccessPolicyRow {
  return {
    episode_id: 'episode-policy',
    memory_owner_id: 'vault-owner',
    memory_conversation_id: 'session-root',
    source_thread_id: 'thread-origin',
    persona_id: DEFAULT_MEMORY_PERSONA_ID,
    task_id: null,
    shareability: 'session_threads',
    sensitivity: 'normal',
    expires_at: null,
    policy_version: 1,
    bound_at: 20,
    ...overrides,
  };
}

const CURRENT_SCOPE = {
  memoryOwnerId: 'vault-owner',
  memoryConversationId: 'session-root',
  sourceThreadId: 'thread-current',
  personaId: DEFAULT_MEMORY_PERSONA_ID,
  taskId: null,
};

function recordCompleteEpisode(suffix: string, taskId: string | null = null) {
  const episode = recordThreadLocalEpisode({
    conversationId: 'session-root',
    threadId: `thread-${suffix}`,
    taskId,
    summary: `Completed episode ${suffix}`,
    messageIds: [`message-${suffix}-start`, `message-${suffix}-end`],
    sourceStartMessageId: `message-${suffix}-start`,
    sourceEndMessageId: `message-${suffix}-end`,
    startedAt: 20,
    endedAt: 30,
    now: 40,
  });
  if (!episode) throw new Error('expected episode');
  return episode;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureEpisodeAccessPolicySchema(getMemoryDb(), 10);
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('episode cross-thread access decision', () => {
  it('authorizes only an exact, complete, normal, non-task origin', () => {
    expect(
      decideCrossThreadEpisodeAccess({
        episode: rawEpisode(),
        policyRow: rawPolicy(),
        currentScope: CURRENT_SCOPE,
        now: 100,
      }),
    ).toEqual(expect.objectContaining({ authorized: true, reason: 'eligible' }));
  });

  it('accepts exact opaque source ids beyond the narrower scope-id limit', () => {
    const sourceStart = `source-start-${'a'.repeat(180)}`;
    const sourceEnd = `source-end-${'b'.repeat(180)}`;
    expect(
      decideCrossThreadEpisodeAccess({
        episode: rawEpisode({
          message_ids_json: JSON.stringify([sourceStart, sourceEnd]),
          source_start_message_id: sourceStart,
          source_end_message_id: sourceEnd,
        }),
        policyRow: rawPolicy(),
        currentScope: CURRENT_SCOPE,
        now: 100,
      }),
    ).toEqual(expect.objectContaining({ authorized: true, reason: 'eligible' }));
  });

  it.each([
    ['owner_mismatch', {}, {}, { memoryOwnerId: 'other-owner' }, {}],
    ['session_mismatch', {}, {}, { memoryConversationId: 'other-session' }, {}],
    ['persona_mismatch', {}, {}, { personaId: 'other-persona' }, {}],
    ['current_thread', {}, {}, { sourceThreadId: 'thread-origin' }, {}],
    ['thread_only', {}, { shareability: 'thread_only' }, {}, {}],
    ['task_local', { task_id: 'task-private' }, { task_id: 'task-private' }, {}, {}],
    ['private_or_sensitive', {}, { sensitivity: 'private' }, {}, {}],
    ['deleted', { deleted_at: 80 }, {}, {}, {}],
    ['expired', {}, { expires_at: 90 }, {}, {}],
    ['policy_not_yet_bound', {}, { bound_at: 110, expires_at: 200 }, {}, {}],
    ['not_yet_complete', { ended_at: 110 }, {}, {}, {}],
    ['malformed_source', { message_ids_json: '{bad-json' }, {}, {}, {}],
    ['malformed_source', { tool_names_json: '{bad-json' }, {}, {}, {}],
    ['withdrawn', {}, {}, {}, { withdrawn: true }],
    ['origin_mismatch', {}, { source_thread_id: 'thread-other' }, {}, {}],
  ] as const)(
    'rejects %s cross-thread access',
    (reason, episodeOverrides, policyOverrides, scopeOverrides, flags) => {
      expect(
        decideCrossThreadEpisodeAccess({
          episode: rawEpisode(episodeOverrides),
          policyRow: rawPolicy(policyOverrides),
          currentScope: { ...CURRENT_SCOPE, ...scopeOverrides },
          now: 100,
          ...flags,
        }),
      ).toEqual({ authorized: false, reason });
    },
  );

  it('rejects corrupted or temporally inconsistent persisted policy rows', () => {
    expect(episodeAccessPolicyFromRow(rawPolicy({ task_id: '' }))).toBeNull();
    expect(episodeAccessPolicyFromRow(rawPolicy({ expires_at: 20 }))).toBeNull();
    expect(
      decideCrossThreadEpisodeAccess({
        episode: rawEpisode(),
        policyRow: rawPolicy({ policy_version: 2 }),
        currentScope: CURRENT_SCOPE,
        now: 100,
      }),
    ).toEqual({ authorized: false, reason: 'invalid_policy' });
  });
});

describe('episode access policy persistence', () => {
  it('creates one durable random vault owner and preserves it across policy clear', () => {
    const owner = getLocalMemoryVaultOwnerId(getMemoryDb());
    expect(owner).toMatch(/^vault_owner_[0-9a-f]{32}$/);

    clearEpisodeAccessPolicies(getMemoryDb());
    ensureEpisodeAccessPolicySchema(getMemoryDb(), 20);

    expect(getLocalMemoryVaultOwnerId(getMemoryDb())).toBe(owner);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_vault_identity',
      )?.count,
    ).toBe(1);
  });

  it('resolves one code-owned default persona and rejects malformed nonblank ids', () => {
    expect(resolveCodeOwnedMemoryPersonaId(undefined)).toBe(DEFAULT_MEMORY_PERSONA_ID);
    expect(resolveCodeOwnedMemoryPersonaId('coder')).toBe('coder');
    expect(() => resolveCodeOwnedMemoryPersonaId('')).toThrow('memory_scope_persona_id_invalid');
    expect(() => resolveCodeOwnedMemoryPersonaId('  ')).toThrow('memory_scope_persona_id_invalid');
    expect(() => resolveCodeOwnedMemoryPersonaId(' coder ')).toThrow(
      'memory_scope_persona_id_invalid',
    );
    expect(() =>
      requireMemoryAccessScopeIdentity({
        memoryOwnerId: 'vault-owner',
        memoryConversationId: 'session-root',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
      } as never),
    ).toThrow('memory_scope_task_id_invalid');
    expect(
      requireMemoryAccessScopeIdentity({
        memoryOwnerId: 'vault-owner',
        memoryConversationId: 'session-root',
        sourceThreadId: 'thread-current',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      }),
    ).toMatchObject({ personaId: DEFAULT_MEMORY_PERSONA_ID, taskId: null });
    expect(() =>
      requireMemoryAccessScopeIdentity({
        memoryOwnerId: 'vault-owner',
        memoryConversationId: 'session-root',
        sourceThreadId: 'thread-current',
        taskId: null,
      } as never),
    ).toThrow('memory_scope_persona_id_invalid');
  });

  it('binds an immutable exact policy and rejects identity escalation', () => {
    const episode = recordCompleteEpisode('bind');
    const owner = getLocalMemoryVaultOwnerId(getMemoryDb());
    const input = {
      episodeId: episode.id,
      memoryOwnerId: owner,
      memoryConversationId: 'session-root',
      sourceThreadId: 'thread-bind',
      personaId: DEFAULT_MEMORY_PERSONA_ID,
      taskId: null,
      shareability: 'session_threads' as const,
      sensitivity: 'normal' as const,
      boundAt: 40,
    };

    expect(bindEpisodeAccessPolicy(getMemoryDb(), input, 40)).toEqual(
      expect.objectContaining({ episodeId: episode.id, shareability: 'session_threads' }),
    );
    expect(bindEpisodeAccessPolicy(getMemoryDb(), input, 40)).toEqual(
      getEpisodeAccessPolicy(getMemoryDb(), episode.id),
    );
    expect(() =>
      bindEpisodeAccessPolicy(getMemoryDb(), { ...input, personaId: 'other-persona' }, 40),
    ).toThrow('episode_access_identity_conflict');
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode.id)?.scope.personaId).toBe(
      DEFAULT_MEMORY_PERSONA_ID,
    );
  });

  it('binds code-owned policy through the episode mutation in one atomic replay-safe write', () => {
    const input = {
      conversationId: 'session-root',
      threadId: 'thread-atomic-mutation',
      summary: 'Atomic policy episode',
      messageIds: ['message-atomic-start', 'message-atomic-end'],
      sourceStartMessageId: 'message-atomic-start',
      sourceEndMessageId: 'message-atomic-end',
      startedAt: 30,
      endedAt: 40,
      now: 50,
      accessPolicy: {
        memoryConversationId: 'session-root',
        sourceThreadId: 'thread-atomic-mutation',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
        shareability: 'session_threads' as const,
        sensitivity: 'normal' as const,
      },
    };

    const episode = recordEpisode(input);
    const replay = recordEpisode({ ...input, now: 60 });

    expect(episode).not.toBeNull();
    expect(replay?.id).toBe(episode?.id);
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode!.id)).toMatchObject({
      episodeId: episode!.id,
      scope: {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: 'session-root',
        sourceThreadId: 'thread-atomic-mutation',
        personaId: DEFAULT_MEMORY_PERSONA_ID,
        taskId: null,
      },
      shareability: 'session_threads',
      sensitivity: 'normal',
      boundAt: 50,
    });

    for (const conflictingLineage of [
      { sourceStartMessageId: 'message-other-start' },
      { messageIds: ['message-atomic-start', 'message-interior', 'message-atomic-end'] },
      { startedAt: 29 },
      { endedAt: 41 },
    ]) {
      expect(() => recordEpisode({ ...input, ...conflictingLineage, now: 70 })).toThrow(
        'episode_source_identity_conflict',
      );
    }
    expect(getEpisodeAccessPolicy(getMemoryDb(), episode!.id)).toMatchObject({
      episodeId: episode!.id,
      scope: { sourceThreadId: 'thread-atomic-mutation' },
    });

    expect(() =>
      recordEpisode({
        ...input,
        threadId: 'thread-invalid-task-share',
        sourceStartMessageId: 'message-invalid-start',
        sourceEndMessageId: 'message-invalid-end',
        messageIds: ['message-invalid-start', 'message-invalid-end'],
        taskId: 'task-private',
        accessPolicy: {
          ...input.accessPolicy,
          sourceThreadId: 'thread-invalid-task-share',
          taskId: 'task-private',
        },
      }),
    ).toThrow('episode_access_task_shareability_invalid');
    expect(
      getMemoryDb().getFirstSync(
        `SELECT id FROM memory_episodes
          WHERE thread_id = 'thread-invalid-task-share'
          LIMIT 1`,
      ),
    ).toBeNull();

    expect(() =>
      recordEpisode({
        conversationId: 'session-root',
        threadId: 'thread-missing-policy',
        summary: 'Missing product policy',
        now: 70,
      } as never),
    ).toThrow('episode_access_policy_required');
    expect(
      getMemoryDb().getFirstSync(
        `SELECT id FROM memory_episodes WHERE thread_id = 'thread-missing-policy' LIMIT 1`,
      ),
    ).toBeNull();
  });

  it('rejects task sharing, incomplete sources, and invalid binding time before insert', () => {
    const owner = getLocalMemoryVaultOwnerId(getMemoryDb());
    const taskEpisode = recordCompleteEpisode('task', 'task-1');
    expect(() =>
      bindEpisodeAccessPolicy(
        getMemoryDb(),
        {
          episodeId: taskEpisode.id,
          memoryOwnerId: owner,
          memoryConversationId: 'session-root',
          sourceThreadId: 'thread-task',
          personaId: DEFAULT_MEMORY_PERSONA_ID,
          taskId: 'task-1',
          shareability: 'session_threads',
          sensitivity: 'normal',
          boundAt: 40,
        },
        40,
      ),
    ).toThrow('episode_access_task_shareability_invalid');

    const incomplete = recordThreadLocalEpisode({
      conversationId: 'session-root',
      threadId: 'thread-incomplete',
      summary: 'Incomplete source episode',
      now: 40,
    });
    if (!incomplete) throw new Error('expected incomplete episode');
    expect(() =>
      bindEpisodeAccessPolicy(
        getMemoryDb(),
        {
          episodeId: incomplete.id,
          memoryOwnerId: owner,
          memoryConversationId: 'session-root',
          sourceThreadId: 'thread-incomplete',
          personaId: DEFAULT_MEMORY_PERSONA_ID,
          taskId: null,
          shareability: 'session_threads',
          sensitivity: 'normal',
          boundAt: 40,
        },
        40,
      ),
    ).toThrow('episode_access_source_incomplete');

    const timed = recordCompleteEpisode('timed');
    const timedInput = {
      episodeId: timed.id,
      memoryOwnerId: owner,
      memoryConversationId: 'session-root',
      sourceThreadId: 'thread-timed',
      personaId: DEFAULT_MEMORY_PERSONA_ID,
      taskId: null,
      shareability: 'session_threads' as const,
      sensitivity: 'normal' as const,
    };
    expect(() =>
      bindEpisodeAccessPolicy(getMemoryDb(), { ...timedInput, boundAt: 39 }, 50),
    ).toThrow('episode_access_bound_before_completion');
    expect(() =>
      bindEpisodeAccessPolicy(getMemoryDb(), { ...timedInput, boundAt: 60 }, 50),
    ).toThrow('episode_access_bound_at_future');
    expect(() =>
      bindEpisodeAccessPolicy(getMemoryDb(), { ...timedInput, boundAt: 40, expiresAt: 40 }, 50),
    ).toThrow('episode_access_expiry_not_future');
  });

  it('fails closed on a corrupted existing row instead of overwriting it', () => {
    const episode = recordCompleteEpisode('corrupt');
    const owner = getLocalMemoryVaultOwnerId(getMemoryDb());
    getMemoryDb().runSync(
      `INSERT INTO memory_episode_access_policies(
         episode_id, memory_owner_id, memory_conversation_id, source_thread_id,
         persona_id, task_id, shareability, sensitivity, expires_at,
         policy_version, bound_at
       ) VALUES (?, ?, 'session-root', 'thread-corrupt', 'default', '',
                 'session_threads', 'normal', NULL, 1, 40)`,
      episode.id,
      owner,
    );

    expect(() =>
      bindEpisodeAccessPolicy(
        getMemoryDb(),
        {
          episodeId: episode.id,
          memoryOwnerId: owner,
          memoryConversationId: 'session-root',
          sourceThreadId: 'thread-corrupt',
          personaId: DEFAULT_MEMORY_PERSONA_ID,
          taskId: null,
          shareability: 'session_threads',
          sensitivity: 'normal',
          boundAt: 40,
        },
        40,
      ),
    ).toThrow('episode_access_policy_corrupt');
    expect(
      getMemoryDb().getFirstSync<{ task_id: string }>(
        'SELECT task_id FROM memory_episode_access_policies WHERE episode_id = ?',
        episode.id,
      )?.task_id,
    ).toBe('');
  });

  it('rolls episode and policy creation back together and deletes policies exactly', () => {
    const owner = getLocalMemoryVaultOwnerId(getMemoryDb());
    let rolledBackEpisodeId = '';
    expect(() =>
      runMemoryTransaction(() => {
        const episode = recordCompleteEpisode('rollback');
        rolledBackEpisodeId = episode.id;
        bindEpisodeAccessPolicy(
          getMemoryDb(),
          {
            episodeId: episode.id,
            memoryOwnerId: owner,
            memoryConversationId: 'session-root',
            sourceThreadId: 'thread-rollback',
            personaId: DEFAULT_MEMORY_PERSONA_ID,
            taskId: null,
            shareability: 'session_threads',
            sensitivity: 'normal',
            boundAt: 40,
          },
          40,
        );
        throw new Error('force_atomic_rollback');
      }),
    ).toThrow('force_atomic_rollback');
    expect(
      getMemoryDb().getFirstSync(
        'SELECT id FROM memory_episodes WHERE id = ?',
        rolledBackEpisodeId,
      ),
    ).toBeNull();
    expect(getEpisodeAccessPolicy(getMemoryDb(), rolledBackEpisodeId)).toBeNull();

    const first = recordCompleteEpisode('delete-first');
    const second = recordCompleteEpisode('delete-second');
    for (const episode of [first, second]) {
      bindEpisodeAccessPolicy(
        getMemoryDb(),
        {
          episodeId: episode.id,
          memoryOwnerId: owner,
          memoryConversationId: 'session-root',
          sourceThreadId: episode.threadId!,
          personaId: DEFAULT_MEMORY_PERSONA_ID,
          taskId: null,
          shareability: 'session_threads',
          sensitivity: 'normal',
          boundAt: 40,
        },
        40,
      );
    }
    expect(deleteEpisodeAccessPolicies(getMemoryDb(), [first.id])).toBe(1);
    expect(getEpisodeAccessPolicy(getMemoryDb(), first.id)).toBeNull();
    expect(getEpisodeAccessPolicy(getMemoryDb(), second.id)).not.toBeNull();
    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_episodes WHERE id = ?', first.id),
    ).not.toBeNull();
  });
});
