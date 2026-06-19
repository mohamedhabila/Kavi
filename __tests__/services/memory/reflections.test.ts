jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  __resetOnDeviceGuardsForTests,
  setMainInferenceActive,
} from '../../../src/services/memory/onDeviceGuards';
import {
  buildReflectionContent,
  dayPeriodBounds,
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
          embedding: null,
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
          embedding: null,
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

  it('refreshes thread reflections from ingested episodes and facts', () => {
    const now = dayPeriodBounds(1_700_000_000_000).start + 3_600_000;
    const threadId = 'conv-refresh';

    recordEpisode({
      threadId,
      conversationId: threadId,
      summary: 'Created configs/nebula/runtime.json',
      endedAt: now,
      now,
    });
    const entity = upsertEntity({ name: 'workspace', type: 'artifact' });
    recordFact({
      subjectId: entity.id,
      predicate: 'wrote_file',
      objectText: 'configs/nebula/runtime.json',
      scope: 'conversation',
      originConversationId: threadId,
      validAt: now,
      now,
    });

    const reflection = refreshThreadReflection({ threadId, now });
    expect(reflection?.kind).toBe('daily_focus');
    expect(reflection?.content).toContain('configs/nebula/runtime.json');
  });

  it('defers reflection refresh while main inference is active', () => {
    setMainInferenceActive(true);
    const reflection = refreshThreadReflection({
      threadId: 'conv-deferred',
      now: dayPeriodBounds(1_700_000_000_000).start + 1_000,
    });
    expect(reflection).toBeNull();
  });
});
