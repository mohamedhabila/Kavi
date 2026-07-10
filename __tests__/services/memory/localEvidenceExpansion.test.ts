jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { addFactEvidence, recordEpisode } from '../../../src/services/memory/episodes/mutations';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import type { MemoryFactKind, RecordFactInput } from '../../../src/services/memory/facts/types';
import { expandLocalEvidence } from '../../../src/services/memory/localEvidenceExpansion';
import { LOCAL_EVIDENCE_EXPANSION_LIMITS } from '../../../src/services/memory/localEvidenceExpansionTypes';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const SCOPE = {
  memoryConversationId: 'memory-conversation-1',
  sourceThreadId: 'source-thread-1',
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

function makeFact(
  objectText: string,
  overrides: Partial<RecordFactInput> = {},
): ReturnType<typeof recordFact>['fact'] {
  return recordFact({
    subjectId: `subject-${objectText}`,
    predicate: 'remembers',
    objectText,
    scope: 'conversation',
    originConversationId: SCOPE.memoryConversationId,
    originThreadId: SCOPE.sourceThreadId,
    now: 10,
    ...overrides,
  }).fact;
}

function makeEpisode(summary: string, threadId = SCOPE.sourceThreadId) {
  const episode = recordEpisode({
    conversationId: SCOPE.memoryConversationId,
    threadId,
    summary,
    startedAt: 10,
    endedAt: 20,
    sourceEndMessageId: `${threadId}-${summary}`,
    now: 20,
  });
  if (!episode) throw new Error('recordEpisode returned null');
  return episode;
}

function insertEvidence(input: {
  id: string;
  factId: string;
  episodeId?: string | null;
  messageId?: string | null;
  quote?: string | null;
  createdAt?: number;
}): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_fact_evidence
       (id, fact_id, episode_id, message_id, role, quote, created_at)
     VALUES (?, ?, ?, ?, 'user', ?, ?)`,
    input.id,
    input.factId,
    input.episodeId ?? null,
    input.messageId ?? null,
    input.quote ?? null,
    input.createdAt ?? 30,
  );
}

describe('expandLocalEvidence', () => {
  it('expands a fact through only directly linked episodes in its exact source thread', () => {
    const fact = makeFact('User prefers the compact layout.', {
      sourceActorId: 'actor-user-1',
    });
    const localEpisode = makeEpisode('The user selected compact layout.');
    const unrelatedEpisode = makeEpisode('Private work from another thread.', 'source-thread-2');
    const deletedEpisode = makeEpisode('Deleted local episode.');
    const futureEpisode = recordEpisode({
      conversationId: SCOPE.memoryConversationId,
      threadId: SCOPE.sourceThreadId,
      summary: 'Future local episode.',
      sourceEndMessageId: 'future-message',
      now: 120,
    });
    if (!futureEpisode) throw new Error('recordEpisode returned null');
    addFactEvidence({
      factId: fact.id,
      episodeId: localEpisode.id,
      messageId: 'message-local',
      role: 'user',
      quote: 'Please keep the layout compact.',
      now: 30,
    });
    addFactEvidence({
      factId: fact.id,
      episodeId: unrelatedEpisode.id,
      messageId: 'message-other-thread',
      quote: 'Do not leak this unrelated episode.',
      now: 40,
    });
    addFactEvidence({
      factId: fact.id,
      episodeId: deletedEpisode.id,
      messageId: 'message-deleted',
      quote: 'Do not emit deleted episode evidence.',
      now: 41,
    });
    addFactEvidence({
      factId: fact.id,
      episodeId: futureEpisode.id,
      messageId: 'message-future',
      quote: 'Do not emit future episode evidence.',
      now: 120,
    });
    getMemoryDb().runSync(
      'UPDATE memory_episodes SET deleted_at = ? WHERE id = ?',
      50,
      deletedEpisode.id,
    );
    getMemoryDb().runSync(
      'UPDATE memory_facts SET last_conflicted_at = ? WHERE id = ?',
      25,
      fact.id,
    );

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [{ kind: 'fact', factId: fact.id }],
      asOf: 100,
    });

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'fact_evidence',
        source: { kind: 'fact', id: fact.id },
        order: expect.objectContaining({ source: 0, neighborhood: 0, observedAt: 30 }),
        provenance: expect.objectContaining({
          factId: fact.id,
          episodeId: localEpisode.id,
          messageId: 'message-local',
          actor: { role: 'user', sourceActorId: 'actor-user-1' },
        }),
        quote: 'Please keep the layout compact.',
        episodeSummary: 'The user selected compact layout.',
        conflict: { state: 'observed', lastConflictedAt: 25 },
      }),
    ]);
    expect(result.promptPayload).not.toContain('Do not leak');
    expect(result.promptPayload).not.toContain('deleted episode evidence');
    expect(result.promptPayload).not.toContain('future episode evidence');
    expect(result.diagnostics).toMatchObject({
      sourceWithEvidenceCount: 1,
      emittedEvidenceCount: 1,
      queryCount: 1,
    });
  });

  it('expands an episode only through current facts in the same scope', () => {
    const episode = makeEpisode('A grounded preference update.');
    const current = makeFact('Current scoped fact.');
    const invalid = makeFact('Invalidated fact.');
    const deleted = makeFact('Deleted fact.');
    const wrongThread = makeFact('Wrong-thread fact.', {
      originThreadId: 'source-thread-2',
    });
    for (const [index, fact] of [current, invalid, deleted, wrongThread].entries()) {
      addFactEvidence({
        factId: fact.id,
        episodeId: episode.id,
        messageId: `episode-message-${index}`,
        quote: `quote-${index}`,
        now: 30 + index,
      });
    }
    getMemoryDb().runSync('UPDATE memory_facts SET invalid_at = ? WHERE id = ?', 50, invalid.id);
    getMemoryDb().runSync('UPDATE memory_facts SET deleted_at = ? WHERE id = ?', 50, deleted.id);

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [{ kind: 'episode', episodeId: episode.id }],
      asOf: 100,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      kind: 'episode_fact',
      statement: 'Current scoped fact.',
      quote: 'quote-0',
      provenance: { factId: current.id, episodeId: episode.id },
    });
    expect(result.promptPayload).not.toContain('Invalidated fact');
    expect(result.promptPayload).not.toContain('Deleted fact');
    expect(result.promptPayload).not.toContain('Wrong-thread fact');
  });

  it('expands run facts in deterministic run and observed-step order without cross-thread reads', () => {
    const runId = 'run-ordered';
    const run = makeFact('Run summary.', {
      sourceRunId: runId,
      memoryKind: 'agent_run',
      attributes: { sourceRunId: runId },
      now: 20,
    });
    const spanOne = makeFact('Observed step one.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      attributes: { stateIndex: 4, sequence: 1 },
      now: 20,
    });
    const spanZero = makeFact('Observed step zero.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      attributes: { stateIndex: 2, sequence: 0 },
      now: 20,
    });
    makeFact('Wrong-thread run evidence.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      originThreadId: 'source-thread-2',
      attributes: { stateIndex: 0, sequence: 0 },
      now: 20,
    });
    const invalid = makeFact('Invalid run evidence.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      now: 20,
    });
    const deleted = makeFact('Deleted run evidence.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      now: 20,
    });
    makeFact('Expired run evidence.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      expiresAt: 80,
      now: 20,
    });
    makeFact('Future run evidence.', {
      sourceRunId: runId,
      memoryKind: 'evidence_span',
      validAt: 120,
      now: 20,
    });
    getMemoryDb().runSync('UPDATE memory_facts SET invalid_at = ? WHERE id = ?', 50, invalid.id);
    getMemoryDb().runSync('UPDATE memory_facts SET deleted_at = ? WHERE id = ?', 50, deleted.id);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET last_conflicted_at = ? WHERE id = ?',
      40,
      spanZero.id,
    );

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [{ kind: 'run', sourceRunId: runId }],
      asOf: 100,
    });

    expect(result.evidence.map((item) => item.provenance.factId)).toEqual([
      spanZero.id,
      spanOne.id,
      run.id,
    ]);
    expect(result.evidence.map((item) => item.order.stateIndex)).toEqual([2, 4, null]);
    expect(result.evidence.map((item) => item.order.sequence)).toEqual([0, 1, null]);
    expect(result.evidence[0].conflict).toEqual({
      state: 'observed',
      lastConflictedAt: 40,
    });
    expect(result.promptPayload).not.toContain('Wrong-thread');
    expect(result.promptPayload).not.toContain('Invalid run');
    expect(result.promptPayload).not.toContain('Deleted run');
    expect(result.promptPayload).not.toContain('Expired run');
    expect(result.promptPayload).not.toContain('Future run');

    const firstItemBudget = JSON.stringify([result.evidence[0]]).length;
    const tight = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [{ kind: 'run', sourceRunId: runId }],
      asOf: 100,
      promptBudgetChars: firstItemBudget,
    });
    expect(tight.evidence).toHaveLength(1);
    expect(tight.evidence[0].factKind).toBe('evidence_span');
    expect(tight.promptPayload).not.toContain('Run summary.');
  });

  it('compacts dense evidence-span JSON structurally so late grounding survives', () => {
    const runId = 'run-dense-late';
    const controls = Array.from({ length: 60 }, (_entry, index) => ({
      role: 'button',
      label: index === 59 ? 'LATE_SUPPORTING_CONTROL' : `control-${index}`,
      section: 'dense table',
      attributes: 'clickable visible',
    }));
    const span = makeFact(
      JSON.stringify({
        sourceRunId: runId,
        thought: 'untrusted internal reasoning '.repeat(200),
        stateIndex: 99,
        sequence: 7,
        toolName: 'browser_observe',
        observedControlSequence: controls,
        observation: 'LATE_SUPPORTING_OBSERVATION',
        toolResult: 'LATE_SUPPORTING_TOOL_RESULT',
      }),
      {
        subjectId: 'subject-dense-evidence',
        sourceRunId: runId,
        memoryKind: 'evidence_span',
        attributes: { stateIndex: 99, sequence: 7 },
        now: 20,
      },
    );

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [{ kind: 'run', sourceRunId: runId }],
      asOf: 100,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      provenance: { factId: span.id },
      factKind: 'evidence_span',
      order: { stateIndex: 99, sequence: 7 },
      truncated: true,
    });
    expect(result.evidence[0].statement).toContain('LATE_SUPPORTING_OBSERVATION');
    expect(result.evidence[0].statement).toContain('LATE_SUPPORTING_TOOL_RESULT');
    expect(result.evidence[0].statement).toContain('LATE_SUPPORTING_CONTROL');
    expect(result.evidence[0].statement?.length).toBeLessThanOrEqual(
      LOCAL_EVIDENCE_EXPANSION_LIMITS.statementChars,
    );
    expect(result.promptPayload).not.toContain('untrusted internal reasoning');
  });

  it('rejects oversized provenance IDs and bounds oversized evidence text', () => {
    const fact = makeFact('Bounded evidence fact.');
    insertEvidence({
      id: 'evidence-valid',
      factId: fact.id,
      messageId: 'message-valid',
      quote: 'q'.repeat(2_000),
      createdAt: 30,
    });
    insertEvidence({
      id: 'evidence-oversized-id',
      factId: fact.id,
      messageId: 'm'.repeat(LOCAL_EVIDENCE_EXPANSION_LIMITS.identifierChars + 1),
      quote: 'must be rejected with its unverifiable provenance',
      createdAt: 31,
    });

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [
        { kind: 'fact', factId: 'f'.repeat(LOCAL_EVIDENCE_EXPANSION_LIMITS.identifierChars + 1) },
        { kind: 'fact', factId: fact.id },
      ],
      asOf: 100,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].quote).toHaveLength(LOCAL_EVIDENCE_EXPANSION_LIMITS.quoteChars);
    expect(result.evidence[0].quote).toMatch(/\u2026$/u);
    expect(result.evidence[0].truncated).toBe(true);
    expect(result.promptPayload).not.toContain('must be rejected');
    expect(result.diagnostics).toMatchObject({
      rejectedSourceCount: 1,
      rejectedCandidateCount: 1,
      queryCount: 1,
    });
  });

  it('uses stable source and evidence ordering across repeated reads', () => {
    const first = makeFact('First selected fact.');
    const second = makeFact('Second selected fact.');
    insertEvidence({ id: 'evidence-b', factId: first.id, quote: 'b', createdAt: 30 });
    insertEvidence({ id: 'evidence-a', factId: first.id, quote: 'a', createdAt: 30 });
    insertEvidence({ id: 'evidence-c', factId: second.id, quote: 'c', createdAt: 20 });
    const input = {
      scope: SCOPE,
      selectedSources: [
        { kind: 'fact' as const, factId: first.id },
        { kind: 'fact' as const, factId: second.id },
        { kind: 'fact' as const, factId: first.id },
      ],
      asOf: 100,
    };

    const firstRead = expandLocalEvidence(input);
    const secondRead = expandLocalEvidence(input);

    expect(firstRead.promptPayload).toBe(secondRead.promptPayload);
    expect(firstRead.evidence.map((item) => item.provenance.evidenceId)).toEqual([
      'evidence-a',
      'evidence-b',
      'evidence-c',
    ]);
    expect(firstRead.evidence.map((item) => item.order.source)).toEqual([0, 0, 1]);
    expect(firstRead.diagnostics.duplicateSourceCount).toBe(1);
  });

  it('fails closed on malformed runtime source unions without querying them', () => {
    const fact = makeFact('Valid source after malformed inputs.');
    insertEvidence({ id: 'evidence-valid-runtime-source', factId: fact.id, quote: 'valid' });

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [
        null,
        { kind: 'unknown', factId: fact.id },
        { kind: 'fact' },
        { kind: 'fact', factId: fact.id },
      ] as unknown as Parameters<typeof expandLocalEvidence>[0]['selectedSources'],
      asOf: 100,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      requestedSourceCount: 4,
      rejectedSourceCount: 3,
      acceptedSourceCount: 1,
      queryCount: 1,
    });
  });

  it('enforces the complete serialized prompt budget and fixed fanout bounds', () => {
    const selectedSources = Array.from({ length: 14 }, (_entry, sourceIndex) => {
      const fact = makeFact(`Budget fact ${sourceIndex}.`, { now: 10 + sourceIndex });
      for (let evidenceIndex = 0; evidenceIndex < 8; evidenceIndex += 1) {
        insertEvidence({
          id: `budget-${sourceIndex}-${evidenceIndex}`,
          factId: fact.id,
          messageId: `budget-message-${sourceIndex}-${evidenceIndex}`,
          quote: `${sourceIndex}-${evidenceIndex}-${'x'.repeat(300)}`,
          createdAt: 100 + evidenceIndex,
        });
      }
      return { kind: 'fact' as const, factId: fact.id };
    });

    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources,
      asOf: 1_000,
      promptBudgetChars: 1_200,
    });

    expect(result.promptPayload.length).toBeLessThanOrEqual(1_200);
    expect(JSON.parse(result.promptPayload)).toEqual(result.evidence);
    expect(result.evidence.length).toBeLessThanOrEqual(
      LOCAL_EVIDENCE_EXPANSION_LIMITS.evidenceItems,
    );
    expect(result.diagnostics).toMatchObject({
      acceptedSourceCount: LOCAL_EVIDENCE_EXPANSION_LIMITS.selectedSources,
      sourceLimitDroppedCount: 2,
      queryCount: LOCAL_EVIDENCE_EXPANSION_LIMITS.selectedSources,
      promptChars: result.promptPayload.length,
    });
    expect(result.diagnostics.sourceEvidenceCapDroppedCount).toBeGreaterThan(0);
    expect(result.diagnostics.promptBudgetDroppedCount).toBeGreaterThan(0);
  });

  it('returns an empty bounded payload and content-free diagnostics when no evidence matches', () => {
    const fact = makeFact('Fact without local evidence.');
    const result = expandLocalEvidence({
      scope: SCOPE,
      selectedSources: [
        { kind: 'fact', factId: fact.id },
        { kind: 'episode', episodeId: 'missing-episode' },
        { kind: 'run', sourceRunId: 'missing-run' },
      ],
      asOf: 100,
    });

    expect(result).toMatchObject({
      evidence: [],
      promptPayload: '[]',
      diagnostics: {
        requestedSourceCount: 3,
        acceptedSourceCount: 3,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        queryCount: 3,
        promptChars: 2,
      },
    });
    const diagnosticsJson = JSON.stringify(result.diagnostics);
    expect(diagnosticsJson).not.toContain(fact.id);
    expect(diagnosticsJson).not.toContain('missing-episode');
    expect(diagnosticsJson).not.toContain('missing-run');
  });

  it.each<[MemoryFactKind]>([['semantic_fact'], ['agent_run'], ['evidence_span']])(
    'normalizes and preserves the supported %s fact kind marker',
    (memoryKind) => {
      const fact = makeFact(`kind-${memoryKind}`, { memoryKind });
      insertEvidence({ id: `kind-evidence-${memoryKind}`, factId: fact.id, quote: memoryKind });

      const result = expandLocalEvidence({
        scope: SCOPE,
        selectedSources: [{ kind: 'fact', factId: fact.id }],
        asOf: 100,
      });

      expect(result.evidence[0]?.factKind).toBe(memoryKind);
    },
  );
});
