jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import {
  invalidateFact,
  recordFactWithApplicability,
  setFactPinned,
} from '../../../src/services/memory/facts/mutations';
import {
  listFactsForRecallCandidates,
  listFactsForRecallEligibleScan,
} from '../../../src/services/memory/facts/queries';
import type { RecallFactScopeIdentity } from '../../../src/services/memory/facts/queryFilter';
import type { MemoryFactScope, RecordFactInput } from '../../../src/services/memory/facts/types';
import {
  recallScoredFactsForQuery,
  type RecallFactsTiming,
} from '../../../src/services/memory/factRecall';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const ALL_SCOPES: MemoryFactScope[] = ['global', 'project', 'conversation', 'session', 'persona'];
const ACTIVE_ROOT = 'root-active';
const ACTIVE_THREAD = 'thread-active';
const ACTIVE_TASK = 'task-shared';
const ACTIVE_PERSONA = 'persona-active';

function activeScope(taskId: string | null = ACTIVE_TASK) {
  return resolveLocalMemoryAccessScope({
    memoryConversationId: ACTIVE_ROOT,
    sourceThreadId: ACTIVE_THREAD,
    personaId: ACTIVE_PERSONA,
    taskId,
  });
}

function activeIdentity(taskId: string | null = ACTIVE_TASK): RecallFactScopeIdentity {
  return {
    ...activeScope(taskId),
    useIntent: 'automatic_prompt',
    candidateLane: 'direct_use',
  };
}

function recordFact(input: RecordFactInput) {
  return recordFactWithApplicability(input, {
    factClass: 'workflow',
    sourceAuthority: 'tool_observed',
    ...(input.scope === 'persona' ? { personaId: ACTIVE_PERSONA } : {}),
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
});

describe('fact recall SQL scope identity', () => {
  it('enforces the authority matrix in SQL and bounds resolution candidates separately', () => {
    const subject = upsertEntity({ name: 'authority matrix', type: 'concept' });
    const persist = (
      suffix: string,
      factClass: 'subjective_user' | 'objective' | 'workflow',
      sourceAuthority: 'grounded_user' | 'tool_observed' | 'external_source' | 'assistant_inferred',
      reviewState: 'auto' | 'verified' = 'auto',
    ) =>
      recordFactWithApplicability(
        {
          subjectId: subject.id,
          predicate: `authority_${suffix}`,
          objectText: `authority matrix ${suffix}`,
          scope: 'global',
          reviewState,
          supersedePrior: false,
          now: 100,
        },
        { factClass, sourceAuthority },
      ).fact.id;

    const directIds = [
      persist('subjective_grounded', 'subjective_user', 'grounded_user'),
      persist('objective_tool', 'objective', 'tool_observed'),
      persist('workflow_external', 'workflow', 'external_source'),
      persist('workflow_verified_inference', 'workflow', 'assistant_inferred', 'verified'),
    ];
    const resolutionIds = [
      persist('subjective_tool', 'subjective_user', 'tool_observed'),
      persist('subjective_external', 'subjective_user', 'external_source'),
      persist('subjective_inference', 'subjective_user', 'assistant_inferred'),
      persist('objective_inference', 'objective', 'assistant_inferred'),
      persist('workflow_inference', 'workflow', 'assistant_inferred'),
    ];

    const direct = listFactsForRecallEligibleScan({
      recallScopeIdentity: activeIdentity(null),
      asOf: 200,
      limit: 32,
    }).map((fact) => fact.id);
    const resolution = listFactsForRecallEligibleScan({
      recallScopeIdentity: {
        ...activeIdentity(null),
        candidateLane: 'resolution',
      },
      asOf: 200,
      limit: 2,
    }).map((fact) => fact.id);

    expect(direct).toEqual(expect.arrayContaining(directIds));
    expect(direct.some((id) => resolutionIds.includes(id))).toBe(false);
    expect(resolution).toHaveLength(2);
    expect(resolution.every((id) => resolutionIds.includes(id))).toBe(true);
  });

  it('does not let authority-ineligible rows consume the direct-use SQL limit', () => {
    const subject = upsertEntity({ name: 'authority saturation', type: 'concept' });
    for (let index = 0; index < 96; index += 1) {
      recordFactWithApplicability(
        {
          subjectId: subject.id,
          predicate: `authority_saturation_${index}`,
          objectText: 'authority saturation target',
          scope: 'global',
          importance: 1,
          supersedePrior: false,
          now: 200 + index,
        },
        { factClass: 'objective', sourceAuthority: 'assistant_inferred' },
      );
    }
    const eligible = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'authority_saturation_eligible',
        objectText: 'authority saturation target',
        scope: 'global',
        importance: 0.1,
        supersedePrior: false,
        now: 100,
      },
      { factClass: 'objective', sourceAuthority: 'external_source' },
    );

    expect(
      listFactsForRecallCandidates({
        recallScopeIdentity: activeIdentity(null),
        selectedLexicalUnits: ['authority', 'saturation', 'target'],
        asOf: 400,
        limit: 1,
      }).map((fact) => fact.id),
    ).toEqual([eligible.fact.id]);
  });

  it('applies raw scope, identity, validity, expiry, and deletion before every bounded lane', () => {
    const subject = upsertEntity({ name: 'scope probe subject', type: 'concept' });
    const add = (input: {
      predicate: string;
      scope: MemoryFactScope;
      originConversationId?: string;
      originThreadId?: string;
      originTaskId?: string;
      expiresAt?: number;
      reviewState?: RecordFactInput['reviewState'];
      sensitivity?: RecordFactInput['sensitivity'];
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
      add({ predicate: 'allowed_persona', scope: 'persona' }),
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
      recordFactWithApplicability(
        {
          subjectId: subject.id,
          predicate: 'blocked_other_persona',
          objectText: 'scope probe blocked other persona',
          scope: 'persona',
          supersedePrior: false,
          now: 100,
        },
        {
          factClass: 'workflow',
          sourceAuthority: 'tool_observed',
          personaId: 'persona-other',
        },
      ),
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
    const wrongOwner = add({ predicate: 'blocked_wrong_owner', scope: 'global' });
    const unknownClass = add({ predicate: 'blocked_unknown_class', scope: 'global' });
    const unknownAuthority = add({ predicate: 'blocked_unknown_authority', scope: 'global' });
    const rejected = add({
      predicate: 'blocked_rejected',
      scope: 'global',
      reviewState: 'rejected',
    });
    const sensitive = add({
      predicate: 'blocked_medical_status',
      scope: 'global',
    });
    const unsafeExpiry = add({ predicate: 'blocked_unsafe_expiry', scope: 'global' });
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
    getMemoryDb().runSync(
      "UPDATE memory_facts SET memory_owner_id = 'owner-other' WHERE id = ?",
      wrongOwner.fact.id,
    );
    getMemoryDb().runSync(
      "UPDATE memory_facts SET fact_class = 'unknown' WHERE id = ?",
      unknownClass.fact.id,
    );
    getMemoryDb().runSync(
      "UPDATE memory_facts SET source_authority = 'unknown' WHERE id = ?",
      unknownAuthority.fact.id,
    );
    getMemoryDb().runSync(
      'UPDATE memory_facts SET expires_at = ? WHERE id = ?',
      Number.MAX_SAFE_INTEGER + 1,
      unsafeExpiry.fact.id,
    );
    for (const entry of [
      ...blocked,
      expired,
      invalidated,
      deleted,
      invalidRawScope,
      wrongOwner,
      unknownClass,
      unknownAuthority,
      rejected,
      sensitive,
      unsafeExpiry,
    ]) {
      setFactPinned(entry.fact.id, true);
    }

    const scan = listFactsForRecallEligibleScan({
      recallScopeIdentity: activeIdentity(),
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 5,
    });
    const candidates = listFactsForRecallCandidates({
      recallScopeIdentity: activeIdentity(),
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
      recallScopeIdentity: activeIdentity(),
      scope: ALL_SCOPES,
      asOf: 1_000,
      limit: 2,
    });
    const candidates = listFactsForRecallCandidates({
      recallScopeIdentity: activeIdentity(),
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

  it('keeps saturated private rows out of local-similarity lanes and semantic selector input', async () => {
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
      memoryScope: activeScope(),
      useIntent: 'automatic_prompt',
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
    const localSimilarityRecall = await recallScoredFactsForQuery('conceptually related memory', {
      candidateStrategy: 'hybrid',
      memoryScope: activeScope(),
      useIntent: 'automatic_prompt',
      localSimilarity: { queryVector: target.fact.localSimilarity!, minimumSimilarity: 0.99 },
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
    expect(localSimilarityRecall.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(localSimilarityRecall[0].candidateProvenance.reasons).toContain('local_similarity');
  });

  it('keeps task-null closed, permits explicit sensitive access, and honors past as-of', () => {
    const subject = upsertEntity({ name: 'access controls', type: 'concept' });
    const global = recordFact({
      subjectId: subject.id,
      predicate: 'global_control',
      objectText: 'global control value',
      scope: 'global',
      now: 100,
    });
    const session = recordFact({
      subjectId: subject.id,
      predicate: 'session_control',
      objectText: 'session control value',
      scope: 'session',
      originConversationId: ACTIVE_ROOT,
      originThreadId: ACTIVE_THREAD,
      originTaskId: ACTIVE_TASK,
      now: 100,
    });
    const sensitive = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'medical_control',
        objectText: 'sensitive control value',
        scope: 'global',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
    const historical = recordFact({
      subjectId: subject.id,
      predicate: 'historical_control',
      objectText: 'historical control value',
      scope: 'global',
      now: 100,
    });
    invalidateFact(historical.fact.id, 500);

    const taskless = listFactsForRecallEligibleScan({
      recallScopeIdentity: activeIdentity(null),
      asOf: 200,
      limit: 16,
    });
    expect(taskless.map((fact) => fact.id)).toContain(global.fact.id);
    expect(taskless.map((fact) => fact.id)).not.toContain(session.fact.id);
    expect(taskless.map((fact) => fact.id)).not.toContain(sensitive.fact.id);
    expect(taskless.map((fact) => fact.id)).toContain(historical.fact.id);

    const explicit = listFactsForRecallEligibleScan({
      recallScopeIdentity: {
        ...activeScope(null),
        useIntent: 'explicit_user_request',
        candidateLane: 'direct_use',
      },
      asOf: 200,
      limit: 16,
    });
    expect(explicit.map((fact) => fact.id)).toContain(sensitive.fact.id);
    expect(explicit.map((fact) => fact.id)).not.toContain(session.fact.id);
  });

  it('keeps long-query selection invariant under inaccessible corpus mutations', async () => {
    const queryUnits = Array.from({ length: 30 }, (_, index) => `invariant${index}`);
    const query = queryUnits.join(' ');
    const visible = upsertEntity({ name: 'visible invariant facts', type: 'concept' });
    for (const index of [0, 15, 29]) {
      recordFact({
        subjectId: visible.id,
        predicate: `invariant${index}`,
        objectText: `authorized invariant${index}`,
        scope: 'conversation',
        originConversationId: ACTIVE_ROOT,
        originThreadId: ACTIVE_THREAD,
        now: 100 + index,
      });
    }
    const recall = () =>
      recallScoredFactsForQuery(query, {
        candidateStrategy: 'lexical',
        memoryScope: activeScope(),
        useIntent: 'automatic_prompt',
        candidatePoolLimit: 64,
        eligibleScanLimit: 64,
        limit: 12,
        now: 1_000,
      });
    const before = await recall();

    const hidden = upsertEntity({ name: 'hidden invariant facts', type: 'concept' });
    const hiddenIds: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const recorded = recordFact({
        subjectId: hidden.id,
        predicate: `invariant${index % queryUnits.length}`,
        objectText: `${queryUnits.join(' ')} hidden ${index}`,
        scope: 'conversation',
        originConversationId: 'root-inaccessible',
        originThreadId: ACTIVE_THREAD,
        now: 200 + index,
      });
      hiddenIds.push(recorded.fact.id);
    }
    const sensitive = recordFactWithApplicability(
      {
        subjectId: hidden.id,
        predicate: 'medical_invariant15',
        objectText: query,
        scope: 'global',
        now: 400,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
    hiddenIds.push(sensitive.fact.id);

    const after = await recall();
    expect(after.map((entry) => entry.fact.id)).toEqual(before.map((entry) => entry.fact.id));
    expect(after.some((entry) => hiddenIds.includes(entry.fact.id))).toBe(false);
  });

  it('rejects malformed direct query scope and timestamp inputs', () => {
    expect(() =>
      listFactsForRecallEligibleScan({
        recallScopeIdentity: activeIdentity(),
        scope: ['global', 'malformed' as never],
        asOf: 100,
        limit: 1,
      }),
    ).toThrow('memory_fact_query_scope_invalid');
    expect(() =>
      listFactsForRecallEligibleScan({
        recallScopeIdentity: activeIdentity(),
        asOf: Number.NaN,
        limit: 1,
      }),
    ).toThrow('memory_fact_query_timestamp_invalid');
  });
});
