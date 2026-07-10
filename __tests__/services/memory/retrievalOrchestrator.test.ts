jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

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
  it('retrieves compact agent-run evidence once', async () => {
    const subject = upsertEntity({ name: 'analysis task', type: 'project', now: 1 });
    recordFact({
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
      conversationId: 'conv-retrieval',
      limit: 4,
      now: 4,
    });

    expect(result.facts.filter((fact) => fact.memoryKind === 'agent_run')).toHaveLength(1);
    expect(result.facts.every((fact) => fact.memoryKind !== 'semantic_fact')).toBe(true);
    expect(result.timings?.episodes).toMatchObject({
      candidateCount: 0,
      resultCount: 0,
    });
  });

  it('can retrieve a direct evidence span without relying on a broader run summary', async () => {
    const subject = upsertEntity({ name: 'release task', type: 'project', now: 1 });
    const span = recordFact({
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
    recordFact({
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
      conversationId: 'conv-retrieval',
      limit: 2,
      now: 4,
    });

    expect(result.facts[0]?.id).toBe(span.fact.id);
    expect(result.facts[0]?.memoryKind).toBe('evidence_span');
  });

  it('uses quoted observations as recall signals alongside the primary request', async () => {
    const subject = upsertEntity({ name: 'quoted label task', type: 'project', now: 1 });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: subject.id,
        predicate: `noise_${index}`,
        objectText:
          'workspace action detail page toolbar visible control candidate summary repeated context',
        memoryKind: 'agent_run',
        sourceRunId: `run-noise-${index}`,
        originConversationId: 'conv-retrieval',
        scope: 'conversation',
        retrievability: 0.95,
        importance: 0.85,
        now: 10 + index,
      });
    }
    const target = recordFact({
      subjectId: subject.id,
      predicate: 'agent_run',
      objectText: JSON.stringify({
        sourceRunId: 'run-target',
        evidenceSlices: [
          {
            action: 'inspect project state',
            observation: 'Target Action is recorded next to Return Control in the project log',
          },
        ],
      }),
      memoryKind: 'agent_run',
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
      conversationId: 'conv-retrieval',
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
});
