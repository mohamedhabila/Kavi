// ---------------------------------------------------------------------------
// Tests — Evidence-to-Fact bridge
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { insertRetiredMemorySourceForTest } from '../helpers/memoryWithdrawalFixtures';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { listFacts } from '../../src/services/memory/facts/queries';
import { findEntityByName } from '../../src/services/memory/entities';
import {
  bridgeEvidenceToFacts,
  bridgeGraphGoalEvidence,
  mapGraphGoalEvidenceToEntries,
  type EvidenceBridgeOptions,
} from '../../src/services/memory/evidenceBridge';
import type { AgentRunEvidenceEntry } from '../../src/types/agentRun';
import {
  buildGraphEvidenceFactProducerEventId,
  GRAPH_EVIDENCE_FACT_PRODUCER_ID,
} from '../../src/services/memory/evidenceBridgeContributionIdentity';
import {
  isMemorySourceWithdrawn,
  MemoryPersistenceSourceWithdrawnError,
} from '../../src/services/memory/withdrawalFence';

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

function bridgeOptions(overrides: Partial<EvidenceBridgeOptions> = {}): EvidenceBridgeOptions {
  return {
    sourceTurnId: 'assistant-evidence-1',
    memoryConversationId: 'conversation-evidence-1',
    sourceThreadId: 'thread-evidence-1',
    taskId: null,
    scope: 'global',
    now: 10,
    ...overrides,
  };
}

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

describe('bridgeEvidenceToFacts', () => {
  it('bridges a verified fact with high confidence', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry()],
      bridgeOptions({
        subjectName: 'run-001',
        subjectType: 'project',
      }),
    );
    expect(result.bridged).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.bridged[0].fact.confidence).toBe(0.85);
    expect(result.bridged[0].fact.sourceAuthority).toBe('assistant_inferred');
    expect(result.bridged[0].fact.objectText).toBe(
      'API key rotated: OpenAI key rotated on 2026-04-29',
    );
  });

  it('bridges a candidate fact at low confidence', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry({ status: 'candidate' })],
      bridgeOptions({
        subjectName: 'run-001',
      }),
    );
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
      bridgeOptions({ subjectName: 'run-001' }),
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
      bridgeOptions({ subjectName: 'run-001' }),
    );
    expect(result.bridged).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  it('falls back to defaultSubject when subjectName is missing', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry()],
      bridgeOptions({
        defaultSubject: { name: 'run-002', type: 'project' },
      }),
    );
    expect(result.bridged).toHaveLength(1);
    const entity = findEntityByName('run-002');
    expect(entity).not.toBeNull();
    if (entity) {
      const facts = listFacts({ subjectId: entity.id });
      expect(facts).toHaveLength(1);
    }
  });

  it('returns no-op when no subject available', () => {
    const result = bridgeEvidenceToFacts([makeEntry()], bridgeOptions());
    expect(result.bridged).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing subject');
  });

  it('uses dedupeKey as the predicate when present', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry({ dedupeKey: 'rotated:openai_key' })],
      bridgeOptions({ subjectName: 'run-001' }),
    );
    expect(result.bridged[0].fact.predicate).toBe('rotated:openai_key');
  });

  it('uses synthetic predicate when dedupeKey is absent', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry({ kind: 'decision', dedupeKey: undefined })],
      bridgeOptions({ subjectName: 'run-001' }),
    );
    expect(result.bridged[0].fact.predicate).toBe('evidence_decision');
  });

  it('is idempotent: re-running yields duplicates instead of new facts', () => {
    const entries = [makeEntry({ dedupeKey: 'k1' })];
    const a = bridgeEvidenceToFacts(entries, bridgeOptions({ subjectName: 'run-001' }));
    const b = bridgeEvidenceToFacts(entries, bridgeOptions({ subjectName: 'run-001' }));
    expect(a.bridged[0].status).toBe('created');
    expect(b.bridged[0].status).toBe('duplicate');
    const entity = findEntityByName('run-001');
    if (entity) expect(listFacts({ subjectId: entity.id })).toHaveLength(1);
  });

  it('persists one exact source contribution with a stable replay clock', () => {
    const options = bridgeOptions({
      subjectName: 'run-contribution',
      sourceRunId: 'agent-run-contribution',
    });
    const result = bridgeEvidenceToFacts([makeEntry()], options);
    const row = getMemoryDb().getFirstSync<{
      fact_id: string;
      memory_conversation_id: string;
      source_thread_id: string;
      task_id: string;
      producer_id: string;
      producer_event_id: string;
      contributed_at: number;
      payload_json: string;
    }>('SELECT * FROM memory_fact_contributions LIMIT 1');
    expect(row).toMatchObject({
      fact_id: result.bridged[0].fact.id,
      memory_conversation_id: options.memoryConversationId,
      source_thread_id: options.sourceThreadId,
      task_id: '',
      producer_id: GRAPH_EVIDENCE_FACT_PRODUCER_ID,
      producer_event_id: buildGraphEvidenceFactProducerEventId({
        sourceTurnId: options.sourceTurnId,
        evidenceEntryId: 'e1',
        inputIndex: 0,
      }),
      contributed_at: options.now,
    });
    const payload = JSON.parse(row!.payload_json) as {
      input: {
        sourceMessageId: string;
        sourceRunId: string;
        sourceTurnId: string;
        sensitivityFloor: string;
        now: number;
      };
    };
    expect(payload.input).toMatchObject({
      sourceMessageId: options.sourceTurnId,
      sourceRunId: options.sourceRunId,
      sourceTurnId: options.sourceTurnId,
      sensitivityFloor: 'normal',
      now: options.now,
    });
    expect(
      getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
        `SELECT source_kind, source_id
           FROM memory_fact_contribution_sources
          ORDER BY source_kind, source_id`,
      ),
    ).toEqual([
      { source_kind: 'message', source_id: options.sourceTurnId },
      { source_kind: 'run', source_id: options.sourceRunId },
      { source_kind: 'turn', source_id: options.sourceTurnId },
    ]);
  });

  it('rejects changed payload under the same causal event without partial facts', () => {
    const options = bridgeOptions({ subjectName: 'run-replay' });
    bridgeEvidenceToFacts([makeEntry({ content: 'first durable value' })], options);

    expect(() =>
      bridgeEvidenceToFacts([makeEntry({ content: 'changed durable value' })], options),
    ).toThrow('memory_fact_contribution_replay_mismatch');

    const entity = findEntityByName('run-replay')!;
    expect(listFacts({ subjectId: entity.id })).toHaveLength(1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_evidence',
      )?.count,
    ).toBe(1);
  });

  it('skips structurally restricted evidence before creating any entity or contribution', () => {
    const syntheticStructuredSecret = `gh${'p_'}${'abcdefghijklmnopqrstuvwxyz'}${'ABCDEFGHIJ'}`;
    const result = bridgeEvidenceToFacts(
      [makeEntry({ title: '', content: syntheticStructuredSecret })],
      bridgeOptions({ subjectName: 'restricted-bridge' }),
    );

    expect(result).toEqual({
      bridged: [],
      skipped: [{ id: 'e1', reason: 'restricted_content' }],
    });
    expect(findEntityByName('restricted-bridge')).toBeNull();
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('rolls back the fact and contribution when evidence persistence fails', () => {
    getMemoryDb().execSync(`
      CREATE TRIGGER fail_graph_evidence_insert
      BEFORE INSERT ON memory_fact_evidence
      BEGIN
        SELECT RAISE(ABORT, 'forced_graph_evidence_failure');
      END;
    `);

    expect(() =>
      bridgeEvidenceToFacts([makeEntry()], bridgeOptions({ subjectName: 'run-atomic-evidence' })),
    ).toThrow('forced_graph_evidence_failure');
    expect(findEntityByName('run-atomic-evidence')).toBeNull();
    for (const table of [
      'memory_facts',
      'memory_fact_contributions',
      'memory_fact_contribution_sources',
      'memory_fact_evidence',
    ]) {
      expect(
        getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
          ?.count,
      ).toBe(0);
    }
  });

  it('fences the message alias independently and rolls the whole bridge back', () => {
    const options = bridgeOptions({ subjectName: 'retired-message-bridge' });
    const scope = {
      memoryConversationId: options.memoryConversationId,
      sourceThreadId: options.sourceThreadId,
      taskId: options.taskId,
    };
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'graph-message-retirement',
      ...scope,
      sourceKind: 'message',
      sourceId: options.sourceTurnId,
    });
    expect(
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'turn',
        sourceId: options.sourceTurnId,
      }),
    ).toBe(false);

    expect(() =>
      bridgeEvidenceToFacts(
        [makeEntry(), makeEntry({ id: 'e2', title: 'Second verified fact' })],
        options,
      ),
    ).toThrow(MemoryPersistenceSourceWithdrawnError);
    expect(findEntityByName('retired-message-bridge')).toBeNull();
    for (const table of [
      'memory_entities',
      'memory_facts',
      'memory_fact_terms',
      'memory_fact_contributions',
      'memory_fact_contribution_sources',
      'memory_fact_evidence',
    ]) {
      expect(tableCount(table)).toBe(0);
    }
  });

  it('rejects a repaired or missing closed-turn identity before any write', () => {
    expect(() =>
      bridgeEvidenceToFacts(
        [makeEntry()],
        bridgeOptions({ subjectName: 'run-invalid-turn', sourceTurnId: ' assistant-1 ' }),
      ),
    ).toThrow('memory_graph_evidence_source_turn_id_invalid');
    expect(findEntityByName('run-invalid-turn')).toBeNull();
  });

  it('records sourceRunId for traceability', () => {
    const result = bridgeEvidenceToFacts(
      [makeEntry()],
      bridgeOptions({
        subjectName: 'run-001',
        sourceRunId: 'agent-run-42',
      }),
    );
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
      sourceTurnId: 'assistant-1',
      memoryConversationId: 'conv-1',
      sourceThreadId: 'conv-1',
      taskId: 'goal-42',
      originConversationId: 'conv-1',
      originThreadId: 'conv-1',
      originTaskId: 'goal-42',
      scope: 'session',
      now: 10,
    });
    expect(result.bridged).toHaveLength(1);
    expect(result.bridged[0].fact.originTaskId).toBe('goal-42');
    expect(result.bridged[0].fact.sourceRunId).toBe('run-1');
    expect(result.bridged[0].fact.sourceTurnId).toBe('assistant-1');
  });

  it('preserves long structured evidence up to the bridge cap', () => {
    const long = 'x'.repeat(900);
    const result = bridgeEvidenceToFacts(
      [makeEntry({ title: '', content: long })],
      bridgeOptions({
        subjectName: 'run-001',
      }),
    );
    expect(result.bridged[0].fact.objectText).toBe(long);
  });

  it('truncates content above the bridge cap', () => {
    const long = 'x'.repeat(4000);
    const result = bridgeEvidenceToFacts(
      [makeEntry({ title: '', content: long })],
      bridgeOptions({
        subjectName: 'run-001',
      }),
    );
    expect(result.bridged[0].fact.objectText.length).toBeLessThanOrEqual(3200);
    expect(result.bridged[0].fact.objectText).toMatch(/\u2026$/);
  });
});
