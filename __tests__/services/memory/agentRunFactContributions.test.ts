jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  recordAgentRunEvidenceMemory,
  type AgentRunEvidenceMemoryInput,
} from '../../../src/services/memory/agentRunEvidenceMemory';
import {
  AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
  buildAgentRunFactProducerEventId,
} from '../../../src/services/memory/agentRunFactContributionIdentity';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface ContributionRow {
  id: string;
  fact_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  producer_id: string;
  producer_event_id: string;
  payload_json: string;
  contributed_at: number;
}

function agentEvidence(input: {
  sourceRunId: string;
  stateIndex: number;
  observation?: string;
  toolResult?: string;
}): string {
  return `agent:${JSON.stringify({
    trajectory_id: input.sourceRunId,
    state_index: input.stateIndex,
    action: `Inspect state ${input.stateIndex}`,
    observation: input.observation,
    toolResult: input.toolResult,
    toolName: 'browser_state',
    status: 'completed',
  })}`;
}

function contributionInput(
  suffix: string,
  evidence?: readonly string[],
): AgentRunEvidenceMemoryInput {
  return {
    evidence:
      evidence ??
      [
        agentEvidence({
          sourceRunId: `run-${suffix}`,
          stateIndex: 1,
          observation: `Observed ${suffix}`,
        }),
      ],
    conversationId: `conversation-${suffix}`,
    threadId: `thread-${suffix}`,
    taskId: `task-${suffix}`,
    sourceTurnId: `assistant-${suffix}`,
    now: 10,
  };
}

function contributions(): ContributionRow[] {
  return getMemoryDb().getAllSync<ContributionRow>(
    `SELECT id, fact_id, memory_conversation_id, source_thread_id, task_id,
            producer_id, producer_event_id, payload_json, contributed_at
       FROM memory_fact_contributions
      ORDER BY producer_event_id`,
  );
}

function aliases(contributionId: string): Array<{ source_kind: string; source_id: string }> {
  return getMemoryDb().getAllSync(
    `SELECT source_kind, source_id
       FROM memory_fact_contribution_sources
      WHERE contribution_id = ?
      ORDER BY source_kind, source_id`,
    contributionId,
  );
}

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
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

describe('agent-run fact contributions', () => {
  it('uses stable versioned events with exact payload scope and only turn/run aliases', () => {
    expect(
      buildAgentRunFactProducerEventId({
        sourceRunId: 'run-event',
        recordKind: 'agent_run',
        recordIndex: 0,
      }),
    ).toBe(
      'agent_run_fact_event_v1_03fa99558ae011212cbde5407dafeffb3c85f8b5aed790b63845cacfb8866276',
    );

    const input = contributionInput('contract');
    const result = recordAgentRunEvidenceMemory(input);
    expect(result.factIds).toHaveLength(2);

    const rows = contributions();
    expect(rows).toHaveLength(2);
    const facts = getMemoryDb().getAllSync<{
      id: string;
      memory_kind: string;
      source_run_id: string;
      source_turn_id: string;
    }>(
      `SELECT id, memory_kind, source_run_id, source_turn_id
         FROM memory_facts
        ORDER BY memory_kind`,
    );
    expect(facts).toEqual([
      expect.objectContaining({
        memory_kind: 'agent_run',
        source_run_id: 'run-contract',
        source_turn_id: 'assistant-contract',
      }),
      expect.objectContaining({
        memory_kind: 'evidence_span',
        source_run_id: 'run-contract',
        source_turn_id: 'assistant-contract',
      }),
    ]);

    const eventByFactId = new Map(rows.map((row) => [row.fact_id, row]));
    for (const fact of facts) {
      const contribution = eventByFactId.get(fact.id)!;
      expect(contribution).toMatchObject({
        memory_conversation_id: input.conversationId,
        source_thread_id: input.threadId,
        task_id: input.taskId,
        producer_id: AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
        contributed_at: input.now,
      });
      expect(contribution.producer_event_id).toBe(
        buildAgentRunFactProducerEventId({
          sourceRunId: 'run-contract',
          recordKind: fact.memory_kind as 'agent_run' | 'evidence_span',
          recordIndex: 0,
        }),
      );
      expect(aliases(contribution.id)).toEqual([
        { source_kind: 'run', source_id: 'run-contract' },
        { source_kind: 'turn', source_id: 'assistant-contract' },
      ]);
      const payload = JSON.parse(contribution.payload_json) as {
        input: Record<string, unknown>;
      };
      expect(payload.input).toMatchObject({
        originConversationId: input.conversationId,
        originThreadId: input.threadId,
        originTaskId: input.taskId,
        sourceMessageId: null,
        sourceRunId: 'run-contract',
        sourceTurnId: input.sourceTurnId,
        now: input.now,
      });
    }
  });

  it('persists multiple span positions once and replays the exact bundle idempotently', () => {
    const sourceRunId = 'run-multiple';
    const input = contributionInput('multiple', [
      agentEvidence({ sourceRunId, stateIndex: 1, observation: 'Observed first state' }),
      agentEvidence({ sourceRunId, stateIndex: 2, toolResult: 'Observed second result' }),
    ]);
    const first = recordAgentRunEvidenceMemory(input);
    expect(first.factIds).toHaveLength(3);
    expect(contributions().map((row) => row.producer_event_id).sort()).toEqual(
      [
        buildAgentRunFactProducerEventId({
          sourceRunId,
          recordKind: 'agent_run',
          recordIndex: 0,
        }),
        buildAgentRunFactProducerEventId({
          sourceRunId,
          recordKind: 'evidence_span',
          recordIndex: 0,
        }),
        buildAgentRunFactProducerEventId({
          sourceRunId,
          recordKind: 'evidence_span',
          recordIndex: 1,
        }),
      ].sort(),
    );

    const replay = recordAgentRunEvidenceMemory(input);
    expect(replay.factIds).toEqual(first.factIds);
    expect(tableCount('memory_facts')).toBe(3);
    expect(tableCount('memory_fact_contributions')).toBe(3);
    expect(tableCount('memory_fact_contribution_sources')).toBe(6);
    expect(tableCount('memory_entities')).toBe(1);
  });

  it('rejects changed payload at the same event and rolls back the attempted fact', () => {
    const input = contributionInput('mismatch');
    recordAgentRunEvidenceMemory(input);
    const beforeFacts = getMemoryDb().getAllSync<{ id: string; object_text: string }>(
      'SELECT id, object_text FROM memory_facts ORDER BY id',
    );
    const beforeContributions = contributions();

    const changed = contributionInput('mismatch', [
      agentEvidence({
        sourceRunId: 'run-mismatch',
        stateIndex: 1,
        observation: 'Materially changed observation',
      }),
    ]);
    expect(() => recordAgentRunEvidenceMemory(changed)).toThrow(
      'memory_fact_contribution_replay_mismatch',
    );
    expect(
      getMemoryDb().getAllSync('SELECT id, object_text FROM memory_facts ORDER BY id'),
    ).toEqual(beforeFacts);
    expect(contributions()).toEqual(beforeContributions);
  });

  it('keeps identical record positions from distinct run ids causally distinct', () => {
    const input = contributionInput('distinct', [
      `agent:${JSON.stringify({
        trajectory_id: 'run-distinct-a',
        summary: 'First exact run',
        status: 'completed',
      })}`,
      `agent:${JSON.stringify({
        trajectory_id: 'run-distinct-b',
        summary: 'Second exact run',
        status: 'completed',
      })}`,
    ]);
    const result = recordAgentRunEvidenceMemory(input);
    expect(result.factIds).toHaveLength(2);
    const rows = contributions();
    expect(new Set(rows.map((row) => row.producer_event_id)).size).toBe(2);
    expect(
      getMemoryDb()
        .getAllSync<{ source_run_id: string }>(
          'SELECT source_run_id FROM memory_facts ORDER BY source_run_id',
        )
        .map((row) => row.source_run_id),
    ).toEqual(['run-distinct-a', 'run-distinct-b']);
  });

  it.each([
    ['missing turn', { sourceTurnId: undefined as never }, 'memory_agent_run_source_turn_id_invalid'],
    ['unstable timestamp', { now: 1.5 }, 'memory_agent_run_timestamp_invalid'],
    [
      'non-exact conversation scope',
      { conversationId: ' conversation-invalid ' },
      'memory_agent_run_conversation_scope_invalid',
    ],
    [
      'non-exact thread scope',
      { threadId: ' thread-invalid ' },
      'memory_agent_run_thread_scope_invalid',
    ],
    ['missing task scope', { taskId: undefined as never }, 'memory_agent_run_task_scope_invalid'],
    [
      'non-exact bundle run',
      {
        evidence: [
          agentEvidence({
            sourceRunId: ' run-invalid ',
            stateIndex: 1,
            observation: 'Invalid exact run identity',
          }),
        ],
      },
      'memory_agent_run_source_run_id_invalid',
    ],
  ] as const)('fails a nonempty bundle with %s before any write', (_label, override, code) => {
    expect(() =>
      recordAgentRunEvidenceMemory({ ...contributionInput('invalid'), ...override }),
    ).toThrow(code);
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('rolls back the entity and all earlier records when a later contribution fails', () => {
    const sourceRunId = 'run-rollback';
    const rejectedEvent = buildAgentRunFactProducerEventId({
      sourceRunId,
      recordKind: 'evidence_span',
      recordIndex: 1,
    });
    getMemoryDb().execSync(
      `CREATE TRIGGER test_reject_later_agent_run_contribution
       BEFORE INSERT ON memory_fact_contributions
       WHEN NEW.producer_event_id = '${rejectedEvent}'
       BEGIN
         SELECT RAISE(ABORT, 'test_later_agent_run_contribution_failed');
       END`,
    );
    const input = contributionInput('rollback', [
      agentEvidence({ sourceRunId, stateIndex: 1, observation: 'First record' }),
      agentEvidence({ sourceRunId, stateIndex: 2, toolResult: 'Second record' }),
    ]);

    expect(() => recordAgentRunEvidenceMemory(input)).toThrow(
      'test_later_agent_run_contribution_failed',
    );
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_fact_contribution_sources')).toBe(0);
  });
});
