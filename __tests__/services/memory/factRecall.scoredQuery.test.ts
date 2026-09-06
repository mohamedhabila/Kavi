jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { setManagedMemoryFactPinned } from '../../../src/services/memory/factExplicitOverrides';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type {
  MemoryFactKind,
  MemoryFactScope,
  RecordFactInput,
} from '../../../src/services/memory/facts/types';
import { recallScoredFactsForQuery as recallScoredFactsForQueryImpl } from '../../../src/services/memory/factRecall';
import type { RecallFactsOptions } from '../../../src/services/memory/factRecallTypes';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const WORKFLOW_KINDS = new Set<MemoryFactKind>([
  'agent_run',
  'artifact',
  'decision',
  'evidence_span',
  'goal',
  'gotcha',
  'risk',
  'source',
  'summary',
  'tool_result',
]);

type TestRecordFactInput = Omit<RecordFactInput, 'scope'> & { scope?: MemoryFactScope };
type TestRecallOptions = Omit<RecallFactsOptions, 'memoryScope' | 'useIntent'> & {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
};

function recordFact(input: TestRecordFactInput) {
  const scope = input.scope ?? 'global';
  const memoryKind = input.memoryKind ?? 'semantic_fact';
  return recordFactWithApplicability(
    { ...input, scope },
    WORKFLOW_KINDS.has(memoryKind)
      ? { factClass: 'workflow', sourceAuthority: 'tool_observed' }
      : { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
}

function withRecallAccess(options: TestRecallOptions = {}): RecallFactsOptions {
  const { conversationId = 'fact-recall-root', threadId, taskId, ...recallOptions } = options;
  return {
    ...recallOptions,
    memoryScope: resolveLocalMemoryAccessScope({
      memoryConversationId: conversationId,
      sourceThreadId: threadId ?? conversationId,
      personaId: 'default',
      taskId: taskId ?? null,
    }),
    useIntent: 'automatic_prompt',
  };
}

function recallScoredFactsForQuery(query: string, options: TestRecallOptions = {}) {
  return recallScoredFactsForQueryImpl(query, withRecallAccess(options));
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

describe('recallScoredFactsForQuery', () => {
  it('returns scoring breakdown alongside selected facts', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: user.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
    });
    setManagedMemoryFactPinned({ factId: fact.fact.id, pinned: true });

    const scored = await recallScoredFactsForQuery('user lives Berlin');

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(fact.fact.id);
    expect(scored[0].pinnedBoost).toBeGreaterThan(0);
    expect(scored[0].textScore).toBeGreaterThan(0);
    // Combined score includes weighted text, confidence/decay, pinned,
    // importance, and reinforcement components.
    expect(scored[0].score).toBeGreaterThan(scored[0].pinnedBoost);
    expect(scored[0].importanceScore).toBeGreaterThan(0);
    expect(scored[0].decayMultiplier).toBeGreaterThan(0);
  });

  it('uses a semantic selector as the authoritative evidence selection', async () => {
    const project = upsertEntity({ name: 'alpha release', type: 'project' });
    const first = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'alpha release backend uses remote execution by default',
      importance: 0.9,
    });
    const selected = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'alpha release backend uses local execution after verified migration evidence',
      importance: 0.1,
      supersedePrior: false,
    });
    let observedCandidateIds: string[] = [];

    const scored = await recallScoredFactsForQuery('alpha release backend execution', {
      limit: 2,
      selector: async ({ candidates }) => {
        observedCandidateIds = candidates.map((candidate) => candidate.fact.id);
        return { factIds: [selected.fact.id] };
      },
    });

    expect(observedCandidateIds).toEqual(expect.arrayContaining([first.fact.id, selected.fact.id]));
    expect(scored.map((entry) => entry.fact.id)).toEqual([selected.fact.id]);
  });

  it('shows high-information query evidence to the semantic selector beyond the top prefix', async () => {
    const project = upsertEntity({ name: 'delta release', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'observation',
      objectText: 'zqxj-confirmed evidence appears in the final tool observation',
      importance: 0.1,
      retrievability: 0.1,
    });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: project.id,
        predicate: 'observation',
        objectText: `delta release project planning evidence ${index}`,
        importance: 0.9,
        supersedePrior: false,
      });
    }
    let observedCandidateIds: string[] = [];

    const scored = await recallScoredFactsForQuery('delta release project zqxj-confirmed', {
      limit: 1,
      selectorCandidateLimit: 4,
      selector: async ({ candidates }) => {
        observedCandidateIds = candidates.map((candidate) => candidate.fact.id);
        return { factIds: [target.fact.id] };
      },
    });

    expect(observedCandidateIds).toContain(target.fact.id);
    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
  });

  it('keeps pinned evidence protected when semantic selection is available', async () => {
    const project = upsertEntity({ name: 'gamma release', type: 'project' });
    const pinned = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'gamma release must always include verified compliance notes',
      importance: 0.9,
    });
    setManagedMemoryFactPinned({ factId: pinned.fact.id, pinned: true });
    const selected = recordFact({
      subjectId: project.id,
      predicate: 'risk',
      objectText: 'gamma release has an unresolved migration risk',
      importance: 0.1,
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery('gamma release backend execution', {
      limit: 2,
      threshold: 0.2,
      selector: async () => ({ factIds: [selected.fact.id] }),
    });

    expect(scored.map((entry) => entry.fact.id)).toEqual([pinned.fact.id, selected.fact.id]);
  });

  it('keeps one relevant direct semantic fact when structural evidence crowds the selector', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const currentPreference = recordFact({
      subjectId: user.id,
      predicate: 'design review duration',
      objectText: '45 minutes',
      importance: 0.9,
      memoryKind: 'semantic_fact',
    });
    const recentRun = recordFact({
      subjectId: user.id,
      predicate: 'agent_run',
      objectText: 'design review calendar event titled Organic design review was created',
      importance: 0.9,
      memoryKind: 'agent_run',
      sourceRunId: 'run-calendar',
      supersedePrior: false,
    });
    const recentEvidence = recordFact({
      subjectId: user.id,
      predicate: 'evidence_span',
      objectText: 'verified calendar event title Organic design review',
      importance: 0.9,
      memoryKind: 'evidence_span',
      sourceRunId: 'run-calendar',
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery(
      'recap my current design review duration and calendar event title',
      {
        limit: 4,
        selector: async () => ({
          factIds: [recentRun.fact.id, recentEvidence.fact.id],
        }),
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual(
      expect.arrayContaining([
        currentPreference.fact.id,
        recentRun.fact.id,
        recentEvidence.fact.id,
      ]),
    );
  });

  it('admits a selected semantic fact before earlier structural results exhaust the limit', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const currentPreference = recordFact({
      subjectId: user.id,
      predicate: 'design review duration',
      objectText: '45 minutes',
      importance: 0.9,
      memoryKind: 'semantic_fact',
    });
    const structural = Array.from({ length: 4 }, (_, index) =>
      recordFact({
        subjectId: user.id,
        predicate: 'evidence_span',
        objectText: `design review calendar evidence ${index}`,
        importance: 0.9,
        memoryKind: 'evidence_span',
        sourceRunId: `run-calendar-${index}`,
        supersedePrior: false,
      }),
    );

    const scored = await recallScoredFactsForQuery(
      'recap my current design review duration and calendar evidence',
      {
        limit: 4,
        selector: async () => ({
          factIds: [...structural.map((entry) => entry.fact.id), currentPreference.fact.id],
        }),
      },
    );

    expect(scored).toHaveLength(4);
    expect(scored.map((entry) => entry.fact.id)).toContain(currentPreference.fact.id);
  });

  it('does not let workflow records satisfy the answer-semantic anchor', async () => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const currentPreference = recordFact({
      subjectId: user.id,
      predicate: 'design review duration',
      objectText: '45 minutes',
      importance: 0.9,
      memoryKind: 'semantic_fact',
    });
    const workflowRecords = Array.from({ length: 3 }, (_, index) =>
      recordFactWithApplicability(
        {
          subjectId: user.id,
          predicate: 'file_operation',
          objectText: `read_file workflow-${index}.txt`,
          importance: 0.9,
          memoryKind: 'semantic_fact',
          scope: 'conversation',
          originConversationId: 'fact-recall-root',
          originThreadId: 'fact-recall-root',
          supersedePrior: false,
        },
        { factClass: 'workflow', sourceAuthority: 'tool_observed' },
      ),
    );
    const evidence = recordFact({
      subjectId: user.id,
      predicate: 'evidence_span',
      objectText: 'verified design review calendar event',
      importance: 0.9,
      memoryKind: 'evidence_span',
      sourceRunId: 'run-calendar-workflow-anchor',
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery(
      'recap my current design review duration and verified calendar event',
      {
        limit: 4,
        selector: async () => ({
          factIds: [...workflowRecords.map((entry) => entry.fact.id), evidence.fact.id],
        }),
      },
    );

    expect(scored).toHaveLength(4);
    expect(scored.map((entry) => entry.fact.id)).toContain(currentPreference.fact.id);
  });

  it('falls back to the local ranking when the semantic selector returns no usable ids', async () => {
    const project = upsertEntity({ name: 'beta release', type: 'project' });
    const expected = recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'beta release backend uses local execution',
      importance: 0.9,
    });
    recordFact({
      subjectId: project.id,
      predicate: 'decision',
      objectText: 'beta release backend uses remote execution',
      importance: 0.1,
      supersedePrior: false,
    });

    const scored = await recallScoredFactsForQuery('beta release backend local execution', {
      limit: 1,
      selector: async () => ({ factIds: ['not-a-candidate'] }),
    });

    expect(scored).toHaveLength(1);
    expect(scored[0].fact.id).toBe(expected.fact.id);
  });
});
