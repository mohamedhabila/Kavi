jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
} from '../../../src/services/memory/localSimilarity';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
import { getFactById } from '../../../src/services/memory/facts/queries';
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { DEFAULT_MEMORY_PERSONA_ID } from '../../../src/services/memory/memoryScopeIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function memoryScope(taskId: string | null = null) {
  return {
    memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
    memoryConversationId: 'conv-retrieval',
    sourceThreadId: 'conv-retrieval',
    personaId: DEFAULT_MEMORY_PERSONA_ID,
    taskId,
  };
}

function recordObservedFact(
  input: Omit<RecordFactInput, 'scope'> & { scope?: RecordFactInput['scope'] },
) {
  return recordFactWithApplicability(
    { ...input, scope: input.scope ?? 'global' },
    { factClass: 'workflow', sourceAuthority: 'tool_observed' },
  );
}

function recordInferredFact(input: RecordFactInput) {
  return recordFactWithApplicability(input, {
    factClass: 'workflow',
    sourceAuthority: 'assistant_inferred',
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

describe('orchestrateMemoryRetrieval', () => {
  it('routes inferred run summaries to the resolution lane instead of direct use', async () => {
    const subject = upsertEntity({ name: 'analysis task', type: 'project', now: 1 });
    const aggregate = recordInferredFact({
      subjectId: subject.id,
      predicate: 'agent_run',
      objectText: JSON.stringify({
        sourceRunId: 'run-analysis',
        goal: 'Analyze the dataset',
        outcome: 'reports/analysis.json was created',
        artifacts: ['reports/analysis.json'],
        evidenceSlices: [{ action: 'Run python analysis', toolName: 'python' }],
      }),
      memoryKind: 'agent_run',
      sourceRunId: 'run-analysis',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.9,
      importance: 0.8,
      now: 2,
    });
    const result = await orchestrateMemoryRetrieval({
      userMessage: 'Where is the analysis json artifact?',
      memoryScope: memoryScope(),
      limit: 4,
      now: 4,
    });

    expect(result.facts).toEqual([]);
    expect(result.resolutionFacts.map((fact) => fact.id)).toEqual([aggregate.fact.id]);
    expect(result.timings?.episodes).toMatchObject({
      candidateCount: 0,
      resultCount: 0,
    });
  });

  it('can retrieve a direct evidence span without relying on a broader run summary', async () => {
    const subject = upsertEntity({ name: 'release task', type: 'project', now: 1 });
    const span = recordObservedFact({
      subjectId: subject.id,
      predicate: 'evidence_span',
      objectText: JSON.stringify({
        sourceRunId: 'run-release',
        stateIndex: 3,
        toolResult: 'release manifest path dist/release-manifest.json',
      }),
      memoryKind: 'evidence_span',
      sourceRunId: 'run-release',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.94,
      importance: 0.86,
      now: 2,
    });
    recordInferredFact({
      subjectId: subject.id,
      predicate: 'agent_run',
      objectText: JSON.stringify({
        sourceRunId: 'run-release',
        goal: 'Prepare release artifacts',
        evidenceSlices: [{ action: 'Inspect artifacts' }],
      }),
      memoryKind: 'agent_run',
      sourceRunId: 'run-release',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.7,
      importance: 0.7,
      now: 3,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'What was the release manifest path?',
      memoryScope: memoryScope(),
      limit: 2,
      now: 4,
    });

    expect(result.facts[0]?.id).toBe(span.fact.id);
    expect(result.facts[0]?.memoryKind).toBe('evidence_span');
  });

  it('uses quoted observations as recall signals alongside the primary request', async () => {
    const subject = upsertEntity({ name: 'quoted label task', type: 'project', now: 1 });
    for (let index = 0; index < 12; index += 1) {
      recordObservedFact({
        subjectId: subject.id,
        predicate: `noise_${index}`,
        objectText:
          'workspace action detail page toolbar visible control candidate summary repeated context',
        memoryKind: 'evidence_span',
        sourceRunId: `run-noise-${index}`,
        originConversationId: 'conv-retrieval',
        scope: 'conversation',
        retrievability: 0.95,
        importance: 0.85,
        now: 10 + index,
      });
    }
    const target = recordObservedFact({
      subjectId: subject.id,
      predicate: 'evidence_span',
      objectText: JSON.stringify({
        sourceRunId: 'run-target',
        evidenceSlices: [
          {
            action: 'inspect project state',
            observation: 'Target Action is recorded next to Return Control in the project log',
          },
        ],
      }),
      memoryKind: 'evidence_span',
      sourceRunId: 'run-target',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.9,
      importance: 0.75,
      now: 2,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage:
        'In the project log, what is recorded between "Target Action" and "Return Control"?',
      memoryScope: memoryScope(),
      limit: 4,
      now: 40,
    });

    expect(result.querySignals).toContain('Target Action');
    expect(result.querySignals).toContain('Return Control');
    expect(result.querySignals.indexOf('Target Action')).toBeLessThan(
      result.querySignals.findIndex((signal) => signal.includes('project log')),
    );
    expect(result.facts.some((fact) => fact.id === target.fact.id)).toBe(true);
  });

  it('forwards the closed strategy and caller-supplied local semantic input', async () => {
    const subject = upsertEntity({ name: 'semantic handoff', type: 'project', now: 1 });
    const target = recordObservedFact({
      subjectId: subject.id,
      predicate: 'opaque_result',
      objectText: 'violet-handoff',
      now: 2,
    });
    const queryVector = createCurrentLocalSimilarityVector(
      buildFactLocalSimilarityText(target.fact),
    );

    const lexical = await orchestrateMemoryRetrieval({
      userMessage: 'conceptually related evidence',
      memoryScope: memoryScope(),
      candidateStrategy: 'lexical',
      localSemantic: { queryVector },
      now: 4,
    });
    const hybrid = await orchestrateMemoryRetrieval({
      userMessage: 'conceptually related evidence',
      memoryScope: memoryScope(),
      candidateStrategy: 'hybrid',
      localSemantic: { queryVector },
      now: 4,
    });

    expect(lexical.facts).toHaveLength(0);
    expect(lexical.timings?.recall?.candidateStages).toMatchObject({
      strategy: 'lexical',
      localSemanticOutcome: 'not_requested',
    });
    expect(hybrid.facts.map((fact) => fact.id)).toEqual([target.fact.id]);
    expect(hybrid.timings?.recall?.candidateStages).toMatchObject({
      strategy: 'hybrid',
      localSemanticOutcome: 'applied',
      localSemanticCount: 1,
    });
  });

  it('rejects invalid public bounds before recall and never reinforces raw selections', async () => {
    const subject = upsertEntity({ name: 'boundary target', type: 'project', now: 1 });
    const target = recordObservedFact({
      subjectId: subject.id,
      predicate: 'boundary_result',
      objectText: 'stable boundary target',
      now: 2,
    });

    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      await expect(
        orchestrateMemoryRetrieval({
          userMessage: 'stable boundary target',
          memoryScope: memoryScope(),
          limit,
          now: 10,
        }),
      ).rejects.toThrow('memory_retrieval_limit_invalid');
    }
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      await expect(
        orchestrateMemoryRetrieval({
          userMessage: 'stable boundary target',
          memoryScope: memoryScope(),
          now,
        }),
      ).rejects.toThrow('memory_retrieval_timestamp_invalid');
    }
    expect(getFactById(target.fact.id)?.lastRecalledAt).toBeNull();

    const selected = await orchestrateMemoryRetrieval({
      userMessage: 'stable boundary target',
      memoryScope: memoryScope(),
      now: 10,
    });
    expect(selected.facts.map((fact) => fact.id)).toContain(target.fact.id);
    expect(getFactById(target.fact.id)?.lastRecalledAt).toBeNull();
  });

  it('excludes current-thread episodes that are incomplete at the retrieval boundary', async () => {
    const episode = recordThreadLocalEpisode({
      conversationId: 'conv-retrieval',
      threadId: 'conv-retrieval',
      summary: 'future release episode',
      messageIds: ['future-start', 'future-end'],
      sourceStartMessageId: 'future-start',
      sourceEndMessageId: 'future-end',
      startedAt: 290,
      endedAt: 300,
      now: 300,
    });
    expect(episode).not.toBeNull();

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'future release',
      memoryScope: memoryScope(),
      now: 200,
    });

    expect(result.episodes).toEqual([]);
    expect(result.episodeSelections).toEqual([]);
    expect(result.timings?.episodes).toMatchObject({ candidateCount: 0, resultCount: 0 });
  });
});
