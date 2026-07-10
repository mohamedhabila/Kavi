jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import {
  invalidateFact,
  recordFact,
  setFactEmbedding,
  setFactPinned,
} from '../../../src/services/memory/facts/mutations';
import {
  listFactsForRecallCandidates,
  listFactsForRecallEligibleScan,
} from '../../../src/services/memory/facts/queries';
import type { RecallFactScopeIdentity } from '../../../src/services/memory/facts/queryFilter';
import type { MemoryFactScope } from '../../../src/services/memory/facts/types';
import {
  recallScoredFactsForQuery,
  type RecallFactsTiming,
} from '../../../src/services/memory/factRecall';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const ALL_SCOPES: MemoryFactScope[] = [
  'global',
  'project',
  'conversation',
  'session',
  'persona',
];
const ACTIVE_ROOT = 'root-active';
const ACTIVE_THREAD = 'thread-active';
const ACTIVE_TASK = 'task-shared';
const ACTIVE_IDENTITY: RecallFactScopeIdentity = {
  conversationId: ACTIVE_ROOT,
  threadId: ACTIVE_THREAD,
  taskId: ACTIVE_TASK,
};

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('fact recall SQL scope identity', () => {
  it('applies raw scope, identity, validity, expiry, and deletion before every bounded lane', () => {
    const subject = upsertEntity({ name: 'scope probe subject', type: 'concept' });
    const add = (input: {
      predicate: string;
      scope: MemoryFactScope;
      originConversationId?: string;
      originThreadId?: string;
      originTaskId?: string;
      expiresAt?: number;
    }) =>
      recordFact({
        subjectId: subject.id,
        predicate: input.predicate,
        objectText: `scope probe ${input.predicate}`,
        scope: input.scope,
        supersedePrior: false,
        now: 100,
        ...input,
      });

    const allowed = [
      add({ predicate: 'allowed_global', scope: 'global' }),
      // RET04 has no exact persona identity column; RET05 closes this branch.
      add({ predicate: 'allowed_persona_until_ret05', scope: 'persona' }),
      add({
        predicate: 'allowed_project',
        scope: 'project',
        originConversationId: ACTIVE_ROOT,
      }),
      add({
        predicate: 'allowed_root_conversation',
        scope: 'conversation',
        originConversationId: ACTIVE_ROOT,
        originThreadId: 'different-thread-is-still-root-visible',
      }),
      add({
        predicate: 'allowed_session',
        scope: 'session',
        originConversationId: ACTIVE_ROOT,
        originThreadId: ACTIVE_THREAD,
        originTaskId: ACTIVE_TASK,
      }),
    ];
    const blocked = [
      add({
        predicate: 'blocked_project_root',
        scope: 'project',
        originConversationId: 'root-other',
      }),
      add({
        predicate: 'blocked_conversation_root',
        scope: 'conversation',
        originConversationId: 'root-other',
        originThreadId: ACTIVE_THREAD,
      }),
      add({
        predicate: 'blocked_session_root',
        scope: 'session',
        originConversationId: 'root-other',
        originThreadId: ACTIVE_THREAD,
        originTaskId: ACTIVE_TASK,
      }),
      add({
        predicate: 'blocked_session_thread',
        scope: 'session',
        originConversationId: ACTIVE_ROOT,
        originThreadId: 'thread-other',
        originTaskId: ACTIVE_TASK,
      }),
      add({
        predicate: 'blocked_session_task',
        scope: 'session',
        originConversationId: ACTIVE_ROOT,
        originThreadId: ACTIVE_THREAD,
        originTaskId: 'task-other',
      }),
    ];
    const expired = add({
      predicate: 'blocked_expired',
      scope: 'conversation',
      originConversationId: ACTIVE_ROOT,
      expiresAt: 500,
    });
    const invalidated = add({
      predicate: 'blocked_invalidated',
      scope: 'conversation',
      originConversationId: ACTIVE_ROOT,
    });
    const deleted = add({
      predicate: 'blocked_deleted',
      scope: 'conversation',
      originConversationId: ACTIVE_ROOT,
    });
    const invalidRawScope = add({ predicate: 'blocked_invalid_raw_scope', scope: 'global' });
    invalidateFact(invalidated.fact.id, 500);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET deleted_at = ? WHERE id = ?',
      500,
      deleted.fact.id,
    );
    getMemoryDb().runSync(
      'UPDATE memory_facts SET scope = ? WHERE id = ?',
      'legacy_unknown_scope',
      invalidRawScope.fact.id,
    );
    for (const entry of [...blocked, expired, invalidated, deleted, invalidRawScope]) {
      setFactPinned(entry.fact.id, true);
    }

    const scan = listFactsForRecallEligibleScan({
      recallScopeIdentity: ACTIVE_IDENTITY,
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 5,
    });
    const candidates = listFactsForRecallCandidates({
      recallScopeIdentity: ACTIVE_IDENTITY,
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 32,
      selectedLexicalUnits: ['scope', 'probe'],
      anchorLexicalUnitSets: [['scope', 'probe']],
      scopedRecentConversationId: ACTIVE_ROOT,
      scopedRecentTaskId: ACTIVE_TASK,
      includeUnanchoredCandidates: true,
    });
    const allowedIds = allowed.map((entry) => entry.fact.id).sort();

    expect(scan.map((fact) => fact.id).sort()).toEqual(allowedIds);
    expect(candidates.map((fact) => fact.id).sort()).toEqual(allowedIds);
  });

  it('cannot be saturated by unrelated projects or reused task ids from another root', () => {
    const subject = upsertEntity({ name: 'saturation subject', type: 'concept' });
    const activeProject = recordFact({
      subjectId: subject.id,
      predicate: 'active_project_target',
      objectText: 'shared saturation probe',
      scope: 'project',
      originConversationId: ACTIVE_ROOT,
      supersedePrior: false,
      now: 1,
    });
    const activeSession = recordFact({
      subjectId: subject.id,
      predicate: 'active_session_target',
      objectText: 'shared saturation probe',
      scope: 'session',
      originConversationId: ACTIVE_ROOT,
      originThreadId: ACTIVE_THREAD,
      originTaskId: ACTIVE_TASK,
      supersedePrior: false,
      now: 2,
    });
    for (let index = 0; index < 257; index += 1) {
      recordFact({
        subjectId: subject.id,
        predicate: `unrelated_project_${index}`,
        objectText: `shared saturation probe project ${index}`,
        scope: 'project',
        originConversationId: 'root-other-project',
        supersedePrior: false,
        importance: 1,
        now: 100 + index,
      });
      recordFact({
        subjectId: subject.id,
        predicate: `reused_task_${index}`,
        objectText: `shared saturation probe task ${index}`,
        scope: 'session',
        originConversationId: 'root-other-task',
        originThreadId: ACTIVE_THREAD,
        originTaskId: ACTIVE_TASK,
        supersedePrior: false,
        importance: 1,
        now: 100 + index,
      });
    }

    const eligible = listFactsForRecallEligibleScan({
      recallScopeIdentity: ACTIVE_IDENTITY,
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 2,
    });
    const candidates = listFactsForRecallCandidates({
      recallScopeIdentity: ACTIVE_IDENTITY,
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 2,
      selectedLexicalUnits: ['shared', 'saturation', 'probe'],
      anchorLexicalUnitSets: [['shared', 'saturation', 'probe']],
      scopedRecentConversationId: ACTIVE_ROOT,
      scopedRecentTaskId: ACTIVE_TASK,
      includeUnanchoredCandidates: true,
    });
    const expectedIds = [activeProject.fact.id, activeSession.fact.id].sort();

    expect(eligible.map((fact) => fact.id).sort()).toEqual(expectedIds);
    expect(candidates.map((fact) => fact.id).sort()).toEqual(expectedIds);
  });

  it('keeps saturated private rows out of hybrid lanes and semantic selector input', async () => {
    const targetEntity = upsertEntity({
      name: 'Project Aurora',
      type: 'project',
      aliases: ['Northern Lights'],
    });
    const otherEntity = upsertEntity({ name: 'Other Project', type: 'project' });
    const target = recordFact({
      subjectId: targetEntity.id,
      predicate: 'opaque_status',
      objectText: 'green',
      scope: 'conversation',
      originConversationId: ACTIVE_ROOT,
      originThreadId: 'another-thread-in-the-same-root',
      now: 1,
    });
    setFactEmbedding(target.fact.id, [1, 0], 2);
    const blockedIds = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      const blocked = recordFact({
        subjectId: otherEntity.id,
        predicate: `selector_signal_${index}`,
        objectText: `Northern Lights selector signal ${index}`,
        scope: 'conversation',
        originConversationId: 'root-other',
        originThreadId: ACTIVE_THREAD,
        supersedePrior: false,
        importance: 1,
        now: 100 + index,
      });
      blockedIds.add(blocked.fact.id);
    }
    let entityTiming: RecallFactsTiming | undefined;
    let selectorCandidateIds: string[] = [];

    const entityRecall = await recallScoredFactsForQuery('Northern Lights selector signal', {
      candidateStrategy: 'hybrid',
      conversationId: ACTIVE_ROOT,
      threadId: ACTIVE_THREAD,
      candidatePoolLimit: 128,
      eligibleScanLimit: 256,
      limit: 1,
      now: 1_000,
      selector: async ({ candidates }) => {
        selectorCandidateIds = candidates.map((candidate) => candidate.fact.id);
        return { factIds: [target.fact.id] };
      },
      onTiming: (timing) => {
        entityTiming = timing;
      },
    });
    const semanticRecall = await recallScoredFactsForQuery('conceptually related memory', {
      candidateStrategy: 'hybrid',
      conversationId: ACTIVE_ROOT,
      threadId: ACTIVE_THREAD,
      localSemantic: { queryEmbedding: [1, 0], minimumSimilarity: 0.8 },
      candidatePoolLimit: 128,
      eligibleScanLimit: 256,
      limit: 1,
      now: 1_000,
    });

    expect(entityRecall.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(entityTiming?.candidateStages).toMatchObject({
      eligibleScanCount: 1,
      entityCount: 1,
    });
    expect(selectorCandidateIds).toContain(target.fact.id);
    expect(selectorCandidateIds.some((id) => blockedIds.has(id))).toBe(false);
    expect(semanticRecall.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(semanticRecall[0].candidateProvenance.reasons).toContain('local_semantic');
  });
});
