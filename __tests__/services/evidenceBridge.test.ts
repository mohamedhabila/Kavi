// ---------------------------------------------------------------------------
// Tests — Evidence-to-Fact bridge
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { listFacts } from '../../src/services/memory/facts/queries';
import { findEntityByName } from '../../src/services/memory/entities';
import {
  bridgeEvidenceToFacts,
  bridgeGraphGoalEvidence,
  mapGraphGoalEvidenceToEntries,
} from '../../src/services/memory/evidenceBridge';
import type { AgentRunEvidenceEntry } from '../../src/types/agentRun';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function makeEntry(over: Partial<AgentRunEvidenceEntry> = {}): AgentRunEvidenceEntry {
  return {
    id: 'e1',
    kind: 'fact',
    status: 'verified',
    recorder: 'supervisor',
    title: 'API key rotated',
    content: 'OpenAI key rotated on 2026-04-29',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('bridgeEvidenceToFacts', () => {
  it('bridges a verified fact with high confidence', () => {
    const result = bridgeEvidenceToFacts([makeEntry()], {
      subjectName: 'run-001',
      subjectType: 'project',
    });
    expect(result.bridged).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.bridged[0].fact.confidence).toBe(0.85);
    expect(result.bridged[0].fact.objectText).toBe(
      'API key rotated: OpenAI key rotated on 2026-04-29',
    );
  });

  it('bridges a candidate fact at low confidence', () => {
    const result = bridgeEvidenceToFacts([makeEntry({ status: 'candidate' })], {
      subjectName: 'run-001',
    });
    expect(result.bridged).toHaveLength(1);
    expect(result.bridged[0].fact.confidence).toBe(0.5);
  });

  it('skips kinds that are not bridged', () => {
    const result = bridgeEvidenceToFacts(
      [
        makeEntry({ id: 'e1', kind: 'risk' }),
        makeEntry({ id: 'e2', kind: 'question' }),
        makeEntry({ id: 'e3', kind: 'artifact' }),
        makeEntry({ id: 'e4', kind: 'source' }),
        makeEntry({ id: 'e5', kind: 'summary' }),
      ],
      { subjectName: 'run-001' },
    );
    expect(result.bridged).toEqual([]);
    expect(result.skipped).toHaveLength(5);
    for (const skip of result.skipped) {
      expect(skip.reason).toMatch(/not bridged/);
    }
  });

  it('skips status=open and status=resolved', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry({ id: 'e1', status: 'open' }), makeEntry({ id: 'e2', status: 'resolved' })],
      { subjectName: 'run-001' },
    );
    expect(result.bridged).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  it('falls back to defaultSubject when subjectName is missing', () => {
    const result = bridgeEvidenceToFacts([makeEntry()], {
      defaultSubject: { name: 'run-002', type: 'project' },
    });
    expect(result.bridged).toHaveLength(1);
    const entity = findEntityByName('run-002');
    expect(entity).not.toBeNull();
    if (entity) {
      const facts = listFacts({ subjectId: entity.id });
      expect(facts).toHaveLength(1);
    }
  });

  it('returns no-op when no subject available', () => {
    const result = bridgeEvidenceToFacts([makeEntry()], {});
    expect(result.bridged).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing subject');
  });

  it('uses dedupeKey as the predicate when present', () => {
    const result = bridgeEvidenceToFacts([makeEntry({ dedupeKey: 'rotated:openai_key' })], {
      subjectName: 'run-001',
    });
    expect(result.bridged[0].fact.predicate).toBe('rotated:openai_key');
  });

  it('uses synthetic predicate when dedupeKey is absent', () => {
    const result = bridgeEvidenceToFacts([makeEntry({ kind: 'decision', dedupeKey: undefined })], {
      subjectName: 'run-001',
    });
    expect(result.bridged[0].fact.predicate).toBe('evidence_decision');
  });

  it('is idempotent: re-running yields duplicates instead of new facts', () => {
    const entries = [makeEntry({ dedupeKey: 'k1' })];
    const a = bridgeEvidenceToFacts(entries, { subjectName: 'run-001' });
    const b = bridgeEvidenceToFacts(entries, { subjectName: 'run-001' });
    expect(a.bridged[0].status).toBe('created');
    expect(b.bridged[0].status).toBe('duplicate');
    const entity = findEntityByName('run-001');
    if (entity) expect(listFacts({ subjectId: entity.id })).toHaveLength(1);
  });

  it('records sourceRunId for traceability', () => {
    const result = bridgeEvidenceToFacts([makeEntry()], {
      subjectName: 'run-001',
      sourceRunId: 'agent-run-42',
    });
    expect(result.bridged[0].fact.sourceRunId).toBe('agent-run-42');
  });

  it('maps graph goal evidence strings to bridgable fact entries', () => {
    const entries = mapGraphGoalEvidenceToEntries([
      'python:artifact:reports/analysis.json',
      'read_file:workspace/README.md',
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('fact');
    expect(entries[0].status).toBe('verified');
    expect(entries[0].dedupeKey).toBe('python:artifact:reports/analysis.json');
  });

  it('bridges graph goal evidence with task and run provenance', () => {
    const result = bridgeGraphGoalEvidence(['python:execution:success'], {
      subjectName: 'goal-42',
      sourceRunId: 'run-1',
      originConversationId: 'conv-1',
      originThreadId: 'conv-1',
      originTaskId: 'goal-42',
    });
    expect(result.bridged).toHaveLength(1);
    expect(result.bridged[0].fact.originTaskId).toBe('goal-42');
    expect(result.bridged[0].fact.sourceRunId).toBe('run-1');
  });

  it('truncates oversize content', () => {
    const long = 'x'.repeat(500);
    const result = bridgeEvidenceToFacts([makeEntry({ title: '', content: long })], {
      subjectName: 'run-001',
    });
    expect(result.bridged[0].fact.objectText.length).toBeLessThanOrEqual(200);
    expect(result.bridged[0].fact.objectText).toMatch(/\u2026$/);
  });
});
