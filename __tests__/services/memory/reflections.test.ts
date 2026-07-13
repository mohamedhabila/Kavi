jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { invalidateManagedMemoryFact } from '../../../src/services/memory/factExplicitOverrides';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  __resetOnDeviceGuardsForTests,
  acquireMainInferenceLease,
} from '../../../src/services/memory/onDeviceGuards';
import {
  buildReflectionContent,
  dayPeriodBounds,
  getApplicableLatestReflectionContent,
  getLatestReflection,
  refreshThreadReflection,
  upsertReflection,
} from '../../../src/services/memory/reflections';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
});

afterEach(() => {
  closeMemoryDb();
});

describe('memory reflections', () => {
  it('builds structural reflection content from episode and fact ids', () => {
    const content = buildReflectionContent({
      episodes: [
        {
          id: 'episode-1',
          conversationId: 'conv-1',
          threadId: 'conv-1',
          taskId: null,
          startedAt: 10,
          endedAt: 20,
          summary: 'Wrote projects/atlas/metadata.json',
          entities: [],
          messageIds: [],
          toolNames: ['write_file'],
          importance: 0.7,
          localSimilarity: null,
          createdAt: 20,
          deletedAt: null,
        },
      ],
      facts: [
        {
          id: 'fact-1',
          subjectId: 'entity-1',
          predicate: 'wrote_file',
          objectText: 'projects/atlas/metadata.json',
          objectEntityId: null,
          attributes: {},
          confidence: 1,
          sourceMessageId: null,
          sourceRunId: null,
          memoryOwnerId: 'owner-1',
          personaId: null,
          factClass: 'workflow',
          sourceAuthority: 'tool_observed',
          scope: 'conversation',
          originConversationId: 'conv-1',
          originThreadId: 'conv-1',
          originTaskId: null,
          sourceTurnId: null,
          sourceSummary: null,
          importance: 0.8,
          accessCount: 0,
          repeatedMentionCount: 0,
          lastRecalledAt: null,
          lastReinforcedAt: null,
          lastAccessedAt: null,
          decayPolicy: 'normal',
          expiresAt: null,
          contentHash: 'hash-1',
          localSimilarity: null,
          validAt: 20,
          invalidAt: null,
          createdAt: 20,
          updatedAt: 20,
          deletedAt: null,
          pinned: false,
          sourceActorId: null,
          taskId: null,
          retrievability: 1,
          stability: 0.5,
          decayRate: 0.03,
          lastPresentedAt: null,
          lastConfirmedAt: null,
          lastConflictedAt: null,
          reviewState: 'auto',
          sensitivity: 'normal',
          memoryKind: 'semantic',
        },
      ],
    });

    expect(content).toContain('episode:episode-1');
    expect(content).toContain('projects/atlas/metadata.json');
    expect(content).toContain('fact:fact-1');
  });

  it('upserts and reads the latest daily_focus reflection for a thread', () => {
    const now = 1_700_000_000_000;
    const { start, end } = dayPeriodBounds(now);
    const saved = upsertReflection({
      scope: 'thread',
      threadId: 'conv-reflection',
      periodStart: start,
      periodEnd: end,
      kind: 'daily_focus',
      content: 'episode:ep-1 Saved atlas metadata',
      sourceEpisodeIds: ['ep-1'],
      sourceFactIds: [],
      now,
    });

    expect(saved?.id).toBeTruthy();
    const latest = getLatestReflection({ threadId: 'conv-reflection', kind: 'daily_focus' });
    expect(latest?.content).toContain('episode:ep-1');
  });

  it('never rehydrates explicitly invalidated facts after a clock rollback', () => {
    const now = 1_700_000_000_000;
    const invalidatedAt = now + 1_000;
    const threadId = 'conv-invalidated-reflection';
    const entity = upsertEntity({ name: 'private project', type: 'artifact', now });
    const fact = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'private_status',
        objectText: 'must-not-return',
        scope: 'conversation',
        originConversationId: threadId,
        originThreadId: threadId,
        validAt: now,
        now,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    upsertReflection({
      scope: 'thread',
      threadId,
      periodStart: dayPeriodBounds(now).start,
      periodEnd: dayPeriodBounds(now).end,
      kind: 'daily_focus',
      content: `fact:${fact.id} private_status:must-not-return`,
      sourceEpisodeIds: [],
      sourceFactIds: [fact.id],
      now,
    });
    invalidateManagedMemoryFact({ factId: fact.id, now: invalidatedAt });

    expect(
      getApplicableLatestReflectionContent({
        currentScope: resolveLocalMemoryAccessScope({
          memoryConversationId: threadId,
          sourceThreadId: threadId,
          personaId: 'default',
          taskId: null,
        }),
        asOf: now,
      }),
    ).toBeNull();
  });

  it('rejects normalized aliases and malformed reflection lineage ids', () => {
    expect(() =>
      upsertReflection({
        scope: 'thread',
        threadId: 'conv-exact-reflection',
        periodStart: 0,
        periodEnd: 100,
        kind: 'daily_focus',
        content: 'content',
        sourceEpisodeIds: [],
        sourceFactIds: [' fact-with-leading-space'],
        now: 50,
      }),
    ).toThrow('memory_reflection_fact_sources_invalid');
    expect(() => getLatestReflection({ threadId: ' conv-exact-reflection' })).toThrow(
      'memory_reflection_thread_id_invalid',
    );
  });

  it('refreshes thread reflections from directly applicable facts', () => {
    const now = dayPeriodBounds(1_700_000_000_000).start + 3_600_000;
    const threadId = 'conv-refresh';

    const entity = upsertEntity({ name: 'workspace', type: 'artifact' });
    recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'wrote_file',
        objectText: 'configs/nebula/runtime.json',
        scope: 'conversation',
        originConversationId: threadId,
        validAt: now,
        now,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    );

    const reflection = refreshThreadReflection({ threadId, now });
    expect(reflection?.kind).toBe('daily_focus');
    expect(reflection?.content).toContain('configs/nebula/runtime.json');
  });

  it('buckets delayed refreshes by source day while recording the actual refresh time', () => {
    const sourceAt = dayPeriodBounds(1_700_000_000_000).start + 3_600_000;
    const refreshedAt = sourceAt + 2 * 86_400_000;
    const threadId = 'conv-delayed-reflection';
    const entity = upsertEntity({ name: 'delayed artifact', type: 'artifact' });
    recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'created_artifact',
        objectText: 'source-day-artifact',
        scope: 'conversation',
        originConversationId: threadId,
        validAt: sourceAt,
        now: sourceAt,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    );

    const reflection = refreshThreadReflection({
      threadId,
      periodAt: sourceAt,
      now: refreshedAt,
    });

    expect(reflection).toEqual(
      expect.objectContaining({
        periodStart: dayPeriodBounds(sourceAt).start,
        createdAt: refreshedAt,
        updatedAt: refreshedAt,
      }),
    );
    expect(reflection?.content).toContain('source-day-artifact');
  });

  it('materializes only directly applicable facts into a reflection', () => {
    const now = dayPeriodBounds(1_700_000_000_000).start + 3_600_000;
    const threadId = 'conv-reflection-authority';
    const entity = upsertEntity({ name: 'user', type: 'self' });
    const supported = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'prefers_editor',
        objectText: 'supported-user-stated-editor',
        scope: 'conversation',
        originConversationId: threadId,
        sourceMessageId: 'supported-user-message',
        validAt: now,
        now,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    const unsupported = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'prefers_theme',
        objectText: 'unsupported-assistant-inference',
        scope: 'conversation',
        originConversationId: threadId,
        sourceMessageId: 'unsupported-assistant-message',
        validAt: now,
        now: now + 1,
      },
      { factClass: 'subjective_user', sourceAuthority: 'assistant_inferred' },
    ).fact;

    const reflection = refreshThreadReflection({ threadId, now: now + 2 });

    expect(reflection?.sourceEpisodeIds).toEqual([]);
    expect(reflection?.sourceFactIds).toEqual([supported.id]);
    expect(reflection?.sourceFactIds).not.toContain(unsupported.id);
    expect(reflection?.content).toContain('supported-user-stated-editor');
    expect(reflection?.content).not.toContain('unsupported-assistant-inference');
  });

  it('applies authority and period bounds before the reflection candidate limit', () => {
    const start = dayPeriodBounds(1_700_000_000_000).start;
    const now = start + 20_000;
    const threadId = 'conv-reflection-saturation';
    const entity = upsertEntity({ name: 'reflection saturation', type: 'concept' });
    const supported = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'supported_current_state',
        objectText: 'supported-current-period-value',
        scope: 'conversation',
        originConversationId: threadId,
        importance: 0.1,
        supersedePrior: false,
        now: start + 100,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    for (let index = 0; index < 32; index += 1) {
      recordFactWithApplicability(
        {
          subjectId: entity.id,
          predicate: `unsupported_current_${index}`,
          objectText: `unsupported-current-value-${index}`,
          scope: 'conversation',
          originConversationId: threadId,
          importance: 1,
          supersedePrior: false,
          now: start + 200 + index,
        },
        { factClass: 'subjective_user', sourceAuthority: 'assistant_inferred' },
      );
      recordFactWithApplicability(
        {
          subjectId: entity.id,
          predicate: `eligible_previous_period_${index}`,
          objectText: `eligible-previous-period-value-${index}`,
          scope: 'conversation',
          originConversationId: threadId,
          importance: 1,
          supersedePrior: false,
          now: start - 1_000 - index,
        },
        { factClass: 'workflow', sourceAuthority: 'tool_observed' },
      );
    }

    const reflection = refreshThreadReflection({ threadId, now });

    expect(reflection?.sourceFactIds).toEqual([supported.id]);
    expect(reflection?.content).toContain('supported-current-period-value');
    expect(reflection?.content).not.toContain('unsupported-current-value');
    expect(reflection?.content).not.toContain('eligible-previous-period-value');
  });

  it('defers reflection refresh while main inference is active', () => {
    acquireMainInferenceLease('foreground:conv-deferred:request-1');
    const reflection = refreshThreadReflection({
      threadId: 'conv-deferred',
      now: dayPeriodBounds(1_700_000_000_000).start + 1_000,
    });
    expect(reflection).toBeNull();
  });
});
