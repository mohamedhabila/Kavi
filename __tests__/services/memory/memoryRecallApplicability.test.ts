jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import * as factObservations from '../../../src/services/memory/facts/observations';
import { executeMemoryRecall } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const EXECUTION_SCOPE = {
  memoryConversationId: 'recall-root',
  sourceThreadId: 'recall-thread',
  personaId: 'default',
  taskId: null,
  now: 1_000,
} as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('agent-facing memory_recall applicability', () => {
  it('returns only exact-scope use and bounded resolution facts with binding policy', () => {
    const subject = upsertEntity({ name: 'recall subject', type: 'concept', now: 100 });
    const supported = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'supported_state',
        objectText: 'supported exact-scope value',
        scope: 'conversation',
        originConversationId: EXECUTION_SCOPE.memoryConversationId,
        originThreadId: EXECUTION_SCOPE.sourceThreadId,
        supersedePrior: false,
        now: 200,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    const inferred = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'possible_preference',
        objectText: 'assistant-inferred preference candidate',
        scope: 'conversation',
        originConversationId: EXECUTION_SCOPE.memoryConversationId,
        originThreadId: EXECUTION_SCOPE.sourceThreadId,
        supersedePrior: false,
        now: 201,
      },
      { factClass: 'subjective_user', sourceAuthority: 'assistant_inferred' },
    ).fact;
    const unknown = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'unknown_class',
        objectText: 'unknown class must stay silent',
        scope: 'conversation',
        originConversationId: EXECUTION_SCOPE.memoryConversationId,
        originThreadId: EXECUTION_SCOPE.sourceThreadId,
        supersedePrior: false,
        now: 202,
      },
      { factClass: 'unknown', sourceAuthority: 'assistant_inferred' },
    ).fact;
    const otherRoot = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'other_root',
        objectText: 'other root must stay private',
        scope: 'conversation',
        originConversationId: 'other-recall-root',
        originThreadId: EXECUTION_SCOPE.sourceThreadId,
        supersedePrior: false,
        now: 203,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;

    const result = executeMemoryRecall({ subject: 'recall subject' }, EXECUTION_SCOPE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.map((fact) => fact.id)).toEqual([inferred.id, supported.id]);
    expect(result.facts[0]?.policy).toEqual({
      action: 'ask',
      reason: 'subjective_authority_confirmation_required',
    });
    expect(result.facts[1]?.policy).toEqual({ action: 'use', reason: 'eligible' });
    expect(result.facts.map((fact) => fact.id)).not.toContain(unknown.id);
    expect(result.facts.map((fact) => fact.id)).not.toContain(otherRoot.id);
    expect(result.policyInstruction).toContain('policy is binding');
  });

  it('fails closed when persisted contradiction observations cannot be read', () => {
    const subject = upsertEntity({ name: 'read failure subject', type: 'concept', now: 100 });
    const fact = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'observed_workflow',
        objectText: 'do not use after observation read failure',
        scope: 'conversation',
        originConversationId: EXECUTION_SCOPE.memoryConversationId,
        originThreadId: EXECUTION_SCOPE.sourceThreadId,
        now: 200,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    jest
      .spyOn(factObservations, 'loadActiveMemoryFactConflictSignals')
      .mockImplementationOnce(() => {
        throw new Error('injected observation read failure');
      });

    const result = executeMemoryRecall({ subject: 'read failure subject' }, EXECUTION_SCOPE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degraded).toBe(true);
    expect(result.facts).toEqual([
      expect.objectContaining({
        id: fact.id,
        policy: { action: 'abstain', reason: 'conflict_observation_read_failed' },
      }),
    ]);
  });

  it('rejects raw-history arguments and normalized execution aliases', () => {
    expect(
      executeMemoryRecall({ all: true, includeHistory: true } as never, EXECUTION_SCOPE),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(
      executeMemoryRecall(
        { all: true },
        { ...EXECUTION_SCOPE, memoryConversationId: ' recall-root' },
      ),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
  });
});
