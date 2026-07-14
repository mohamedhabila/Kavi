jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { findEntityByName, upsertEntity } from '../../../src/services/memory/entities';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  buildMemoryRememberProducerEventId,
  MEMORY_REMEMBER_FACT_PRODUCER_ID,
} from '../../../src/services/memory/memoryRememberContributionIdentity';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

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

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

function contributions(): ContributionRow[] {
  return getMemoryDb().getAllSync(
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

function remember(input: {
  value?: string;
  userMessageId?: string;
  userMessageText?: string;
  executionRunId?: string;
  toolCallId?: string;
  claimedAt?: number;
  sourceRunId?: string | null;
  confidence?: number;
  pinned?: boolean;
  importance?: number;
  operation?: 'record' | 'replace_current';
}) {
  const value = input.value ?? 'Mo';
  const userMessageId = input.userMessageId ?? 'user-display-name';
  const userMessageText = input.userMessageText ?? `主体🧑 display_name ${value}`;
  const context = memoryRememberExecution({
    userMessageId,
    userMessageText,
    executionRunId: input.executionRunId,
    toolCallId: input.toolCallId,
    claimedAt: input.claimedAt ?? 100,
    sourceRunId: input.sourceRunId,
  });
  return {
    context,
    result: executeMemoryRemember(
      memoryRememberArgs({
        userMessageText,
        subjectRef: { kind: 'self' },
        predicate: 'preferred display name',
        value,
        scope: 'global',
        operation: input.operation ?? 'record',
        confidence: input.confidence,
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        importance: input.importance,
      }),
      context,
    ),
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

describe('memory_remember fact contributions', () => {
  it('uses the authorized effect identity, exact request scope, timestamp, and aliases', () => {
    const { context, result } = remember({
      sourceRunId: 'agent-run-memory-1',
      executionRunId: 'execution-run-memory-1',
      toolCallId: 'tool-call-memory-1',
      claimedAt: 123,
    });
    expect(result).toMatchObject({ ok: true, status: 'created' });

    const [contribution] = contributions();
    expect(contribution).toMatchObject({
      fact_id: result.ok ? result.fact.id : '',
      memory_conversation_id: 'conversation-request',
      source_thread_id: 'thread-request',
      task_id: '',
      producer_id: MEMORY_REMEMBER_FACT_PRODUCER_ID,
      producer_event_id: buildMemoryRememberProducerEventId(context.executionClaim),
      contributed_at: 123,
    });
    expect(aliases(contribution!.id)).toEqual([
      { source_kind: 'message', source_id: 'user-display-name' },
      { source_kind: 'run', source_id: 'agent-run-memory-1' },
    ]);
    expect(JSON.parse(contribution!.payload_json).input).toMatchObject({
      sourceMessageId: 'user-display-name',
      sourceRunId: 'agent-run-memory-1',
      sourceTurnId: null,
      validAt: 123,
      now: 123,
    });
    expect(getMemoryDb().getFirstSync('SELECT created_at FROM memory_fact_evidence')).toEqual({
      created_at: 123,
    });
    expect(findEntityByName('user')).toMatchObject({ firstSeenAt: 123, lastSeenAt: 123 });
  });

  it('records same-value metadata as a distinct immutable contribution', () => {
    const first = remember({
      executionRunId: 'execution-metadata-1',
      toolCallId: 'tool-metadata-1',
      claimedAt: 200,
    });
    const second = remember({
      userMessageId: 'user-display-name-confirmed',
      executionRunId: 'execution-metadata-2',
      toolCallId: 'tool-metadata-2',
      claimedAt: 201,
      confidence: 0.95,
      pinned: true,
      importance: 0.9,
    });

    expect(first.result).toMatchObject({ ok: true, status: 'created' });
    expect(second.result).toMatchObject({ ok: true, status: 'duplicate' });
    const rows = contributions();
    expect(rows).toHaveLength(2);
    const secondPayload = JSON.parse(
      rows.find((row) => row.contributed_at === 201)!.payload_json,
    ).input;
    expect(secondPayload).toMatchObject({
      confidence: 0.95,
      pinned: true,
      importance: 0.9,
    });
    expect(listFacts()).toEqual([
      expect.objectContaining({
        importance: 0.9,
      }),
    ]);
  });

  it('replays one exact effect without duplicating facts, evidence, or contributions', () => {
    const input = {
      executionRunId: 'execution-replay',
      toolCallId: 'tool-replay',
      claimedAt: 300,
    } as const;
    const first = remember(input);
    const replay = remember(input);

    expect(first.result).toMatchObject({ ok: true });
    expect(replay.result).toMatchObject({ ok: true, status: 'duplicate' });
    expect(tableCount('memory_entities')).toBe(1);
    expect(tableCount('memory_facts')).toBe(1);
    expect(tableCount('memory_fact_evidence')).toBe(1);
    expect(tableCount('memory_fact_contributions')).toBe(1);
    expect(tableCount('memory_fact_contribution_sources')).toBe(1);
  });

  it('rejects a changed payload at the same effect identity and rolls it back', () => {
    const identity = {
      executionRunId: 'execution-mismatch',
      toolCallId: 'tool-mismatch',
      claimedAt: 400,
    } as const;
    const first = remember(identity);
    const changed = remember({
      ...identity,
      value: 'Mina',
      userMessageText: 'My preferred display name is Mina.',
    });

    expect(first.result).toMatchObject({ ok: true, fact: { value: 'Mo' } });
    expect(changed.result).toMatchObject({ ok: false, code: 'internal' });
    expect(listFacts()).toEqual([expect.objectContaining({ objectText: 'Mo', invalidAt: null })]);
    expect(tableCount('memory_fact_contributions')).toBe(1);
    expect(tableCount('memory_fact_contribution_supersessions')).toBe(0);
  });

  it('keeps the same tool-call id in distinct execution runs causally distinct', () => {
    remember({
      executionRunId: 'execution-distinct-a',
      toolCallId: 'shared-tool-call',
      claimedAt: 500,
    });
    remember({
      executionRunId: 'execution-distinct-b',
      toolCallId: 'shared-tool-call',
      claimedAt: 500,
    });

    const rows = contributions();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.producer_event_id)).size).toBe(2);
    expect(tableCount('memory_facts')).toBe(1);
  });

  it('replays a changed-value correction without duplicating its durable history', () => {
    const firstMessage = '主体🧑 duration 20 minutes';
    const firstContext = memoryRememberExecution({
      userMessageId: 'user-duration-old',
      userMessageText: firstMessage,
      executionRunId: 'execution-duration-old',
      toolCallId: 'tool-duration-old',
      claimedAt: 600,
    });
    const first = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText: firstMessage,
        subjectRef: { kind: 'self' },
        predicate: 'sprint review duration preference',
        value: '20 minutes',
        scope: 'global',
        operation: 'record',
      }),
      firstContext,
    );
    const correctionMessage = '主体🧑 duration 30 minutes';
    const correctionContext = memoryRememberExecution({
      userMessageId: 'user-duration-new',
      userMessageText: correctionMessage,
      executionRunId: 'execution-duration-new',
      toolCallId: 'tool-duration-new',
      claimedAt: 601,
    });
    const correctionInput = memoryRememberArgs({
      userMessageText: correctionMessage,
      subjectRef: { kind: 'self' },
      predicate: 'sprint review duration preference',
      value: '30 minutes',
      scope: 'global',
      operation: 'replace_current',
    });
    const corrected = executeMemoryRemember(correctionInput, correctionContext);

    expect(first).toMatchObject({ ok: true });
    expect(corrected).toMatchObject({ ok: true, fact: { value: '30 minutes' } });
    const correction = contributions().find(
      (row) =>
        row.producer_event_id ===
        buildMemoryRememberProducerEventId(correctionContext.executionClaim),
    )!;
    expect(aliases(correction.id)).toEqual([
      { source_kind: 'message', source_id: 'user-duration-new' },
    ]);
    expect(tableCount('memory_fact_contribution_supersessions')).toBe(1);
    const countsBeforeReplay = {
      facts: tableCount('memory_facts'),
      evidence: tableCount('memory_fact_evidence'),
      contributions: tableCount('memory_fact_contributions'),
      aliases: tableCount('memory_fact_contribution_sources'),
      snapshots: tableCount('memory_fact_contribution_supersession_snapshots'),
      edges: tableCount('memory_fact_contribution_supersessions'),
    };
    upsertEntity({ name: 'user', type: 'self', now: 700 });
    expect(findEntityByName('user')?.lastSeenAt).toBe(700);

    const replayed = executeMemoryRemember(correctionInput, correctionContext);

    expect(replayed).toMatchObject({
      ok: true,
      status: 'duplicate',
      fact: { value: '30 minutes' },
    });
    expect(findEntityByName('user')?.lastSeenAt).toBe(700);
    expect({
      facts: tableCount('memory_facts'),
      evidence: tableCount('memory_fact_evidence'),
      contributions: tableCount('memory_fact_contributions'),
      aliases: tableCount('memory_fact_contribution_sources'),
      snapshots: tableCount('memory_fact_contribution_supersession_snapshots'),
      edges: tableCount('memory_fact_contribution_supersessions'),
    }).toEqual(countsBeforeReplay);

    const changedMessage = '主体🧑 exact 30 minutes';
    const changedEvidenceText = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText: changedMessage,
        subjectRef: { kind: 'self' },
        predicate: 'sprint review duration preference',
        value: '30 minutes',
        scope: 'global',
        operation: 'replace_current',
      }),
      memoryRememberExecution({
        userMessageId: 'user-duration-new',
        userMessageText: changedMessage,
        executionRunId: 'execution-duration-new',
        toolCallId: 'tool-duration-new',
        claimedAt: 601,
      }),
    );
    expect(changedEvidenceText).toMatchObject({ ok: false, code: 'internal' });
    expect({
      facts: tableCount('memory_facts'),
      evidence: tableCount('memory_fact_evidence'),
      contributions: tableCount('memory_fact_contributions'),
      aliases: tableCount('memory_fact_contribution_sources'),
      snapshots: tableCount('memory_fact_contribution_supersession_snapshots'),
      edges: tableCount('memory_fact_contribution_supersessions'),
    }).toEqual(countsBeforeReplay);
  });

  it.each([
    ['missing execution context', undefined, 'internal', false],
    [
      'mismatched current evidence',
      memoryRememberExecution({
        userMessageId: 'user-ungrounded',
        userMessageText: '主体🧑 value Mo',
      }),
      'grounding_required',
      true,
    ],
  ] as const)('fails %s before any write', (_label, context, code, wrongEvidence) => {
    const input = memoryRememberArgs({
      userMessageText: wrongEvidence ? '異なる証拠 Mo' : '主体🧑 value Mo',
      subjectRef: { kind: 'self' },
      predicate: 'preferred display name',
      value: 'Mo',
      scope: 'global',
    });
    const result = executeMemoryRemember(input, context as never);
    expect(result).toMatchObject({ ok: false, code });
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('rejects opt-out, restricted content, scope mismatch, and retired aliases without writes', () => {
    useSettingsStore.setState({ disableLongTermMemory: true });
    expect(remember({}).result).toMatchObject({ ok: false, code: 'memory_disabled' });
    useSettingsStore.setState({ disableLongTermMemory: false });

    const restrictedContext = memoryRememberExecution({
      userMessageId: 'user-secret',
      userMessageText: 'My API key is sk-private-secret.',
    });
    expect(
      executeMemoryRemember(
        memoryRememberArgs({
          userMessageText: 'My API key is sk-private-secret.',
          subjectRef: { kind: 'self' },
          predicate: 'API key',
          value: 'sk-private-secret',
          scope: 'global',
          sensitivity: 'restricted',
        }),
        restrictedContext,
      ),
    ).toMatchObject({ ok: false, code: 'permission_denied' });

    const mismatchedContext = memoryRememberExecution({
      memoryConversationId: 'request-root',
      sourceThreadId: 'request-thread',
      userMessageId: 'user-scope-mismatch',
      userMessageText: 'My preferred display name is Mo.',
    });
    expect(
      executeMemoryRemember(
        {
          ...memoryRememberArgs({
            userMessageText: 'My preferred display name is Mo.',
            subjectRef: { kind: 'self' },
            predicate: 'preferred display name',
            value: 'Mo',
            scope: 'conversation',
          }),
          originConversationId: 'different-root',
        } as never,
        mismatchedContext,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_args' });

    insertRetiredMemorySourceForTest({
      retirementGroupId: 'retired-memory-tool-source',
      memoryConversationId: 'conversation-request',
      sourceThreadId: 'thread-request',
      taskId: null,
      sourceKind: 'message',
      sourceId: 'user-retired',
    });
    expect(
      remember({
        userMessageId: 'user-retired',
        userMessageText: 'My preferred display name is Mo.',
      }).result,
    ).toMatchObject({ ok: false, code: 'internal' });

    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('maps a stale replacement conflict after rolling back entity metadata', () => {
    const first = remember({
      value: 'Mo',
      executionRunId: 'execution-current',
      toolCallId: 'tool-current',
      claimedAt: 800,
    });
    const conflicted = remember({
      value: 'Mina',
      userMessageId: 'user-stale-correction',
      userMessageText: 'Update my preferred display name to Mina going forward, not Mo.',
      executionRunId: 'execution-stale',
      toolCallId: 'tool-stale',
      claimedAt: 799,
      operation: 'replace_current',
    });

    expect(first.result).toMatchObject({ ok: true });
    expect(conflicted.result).toMatchObject({ ok: false, code: 'conflict' });
    expect(findEntityByName('user')).toMatchObject({ lastSeenAt: 800 });
    expect(listFacts()).toEqual([expect.objectContaining({ objectText: 'Mo', invalidAt: null })]);
    expect(tableCount('memory_fact_contributions')).toBe(1);
  });

  it('rolls back entity, fact, contribution, and supersession when evidence persistence fails', () => {
    getMemoryDb().execSync(
      `CREATE TRIGGER reject_memory_tool_evidence
       BEFORE INSERT ON memory_fact_evidence
       BEGIN
         SELECT RAISE(ABORT, 'test_memory_tool_evidence_failed');
       END`,
    );

    const result = remember({
      executionRunId: 'execution-evidence-failure',
      toolCallId: 'tool-evidence-failure',
      claimedAt: 900,
    }).result;
    expect(result).toMatchObject({ ok: false, code: 'internal' });
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_fact_evidence')).toBe(0);
  });
});
