jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { Message } from '../../../src/types/message';
import type {
  SubAgentConfig,
  SubAgentOutcomeReconciliationState,
  SubAgentSnapshot,
} from '../../../src/types/subAgent';
import {
  createPendingSubAgentOutcomeReconciliation,
  reconcileSubAgentOutcomeMemory,
  sanitizeSubAgentOutcomeReconciliationState,
  SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS,
} from '../../../src/services/agents/subAgentOutcomeReconciliation';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const NOW = 10_000;

function makeConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    parentConversationId: 'parent-thread',
    prompt: 'Create and verify the requested artifact.',
    agentRunId: 'parent-run-1',
    workstreamId: 'task-1',
    memorySelectionScope: {
      memoryConversationId: 'memory-root',
      sourceThreadId: 'parent-thread',
      personaId: 'super-agent',
      taskId: 'task-1',
    },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'worker-1',
    parentConversationId: 'parent-thread',
    agentRunId: 'parent-run-1',
    workstreamId: 'task-1',
    depth: 1,
    startedAt: 1_000,
    updatedAt: 9_000,
    status: 'completed',
    sandboxPolicy: 'safe-only',
    launchState: 'terminal',
    output: 'Created the requested artifact and verified its contents.',
    completionState: 'verified_success',
    outcomeReconciliation: createPendingSubAgentOutcomeReconciliation(9_000),
    ...overrides,
  };
}

function makeObservedMessages(): Message[] {
  return [
    {
      id: 'worker-turn-1',
      role: 'assistant',
      content: '',
      timestamp: 8_000,
      toolCalls: [
        {
          id: 'tool-call-1',
          name: 'write_file',
          arguments: JSON.stringify({ path: 'deliverables/report.md' }),
          status: 'completed',
          result: JSON.stringify({
            status: 'ok',
            path: 'deliverables/report.md',
            observation: 'File exists and contains the expected heading.',
          }),
        },
      ],
    },
  ];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

describe('worker outcome reconciliation', () => {
  it('records verified tool evidence with exact worker and parent-run provenance', async () => {
    const state = await reconcileSubAgentOutcomeMemory({
      agent: makeAgent(),
      config: makeConfig(),
      messages: makeObservedMessages(),
      now: NOW,
    });

    expect(state).toEqual(
      expect.objectContaining({
        status: 'completed',
        code: 'recorded_verified',
        attemptCount: 1,
        updatedAt: NOW,
        completedAt: NOW,
      }),
    );
    expect(state.factIds).toHaveLength(2);

    const facts = listFacts({ originTaskId: 'task-1' });
    expect(facts.map((fact) => fact.memoryKind).sort()).toEqual(['agent_run', 'evidence_span']);
    for (const fact of facts) {
      expect(fact.sourceRunId).toBe('worker-1');
      expect(fact.sourceActorId).toBe('worker-1');
      expect(fact.originConversationId).toBe('memory-root');
      expect(fact.originThreadId).toBe('parent-thread');
      expect(fact.originTaskId).toBe('task-1');
      expect(fact.sourceTurnId).toBe('worker-turn-1');
      expect(fact.attributes).toEqual(
        expect.objectContaining({
          sourceRunId: 'worker-1',
          sourceActorId: 'worker-1',
          parentRunId: 'parent-run-1',
          goal: 'Create and verify the requested artifact.',
          status: 'completed',
          outcome: 'verified_success',
        }),
      );
    }
    expect(facts.find((fact) => fact.memoryKind === 'evidence_span')?.sourceAuthority).toBe(
      'tool_observed',
    );
  });

  it('replays idempotently after a crash before the completed receipt persisted', async () => {
    const agent = makeAgent();
    const messages = makeObservedMessages();
    const first = await reconcileSubAgentOutcomeMemory({
      agent,
      config: makeConfig(),
      messages,
      now: NOW,
    });
    const firstFacts = listFacts({ originTaskId: 'task-1' });

    agent.outcomeReconciliation = createPendingSubAgentOutcomeReconciliation(NOW + 1);
    const replay = await reconcileSubAgentOutcomeMemory({
      agent,
      config: makeConfig(),
      messages,
      now: NOW + 2,
    });
    const replayedFacts = listFacts({ originTaskId: 'task-1' });

    expect(replay.code).toBe('recorded_verified');
    expect(replay.factIds).toEqual(first.factIds);
    expect(replayedFacts.map((fact) => fact.id).sort()).toEqual(
      firstFacts.map((fact) => fact.id).sort(),
    );
    expect(replayedFacts.every((fact) => fact.repeatedMentionCount === 0)).toBe(true);
  });

  it('keeps prose-only success as an inferred candidate without tool-observed evidence', async () => {
    const state = await reconcileSubAgentOutcomeMemory({
      agent: makeAgent(),
      config: makeConfig(),
      messages: [
        {
          id: 'worker-turn-prose',
          role: 'assistant',
          content: 'Everything is done.',
          timestamp: 8_000,
        },
      ],
      now: NOW,
    });

    expect(state.code).toBe('recorded_candidate');
    const facts = listFacts({ originTaskId: 'task-1' });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual(
      expect.objectContaining({
        memoryKind: 'agent_run',
        sourceAuthority: 'assistant_inferred',
      }),
    );
    expect(facts[0].attributes).toEqual(
      expect.objectContaining({
        status: 'incomplete',
        outcome: 'verified_success',
      }),
    );
  });

  it('retains observed failure evidence as a scoped candidate without promoting success', async () => {
    const state = await reconcileSubAgentOutcomeMemory({
      agent: makeAgent({
        status: 'error',
        output: 'The write failed because storage was unavailable.',
        completionState: 'blocked',
      }),
      config: makeConfig(),
      messages: [
        {
          id: 'worker-turn-failed',
          role: 'assistant',
          content: '',
          timestamp: 8_000,
          toolCalls: [
            {
              id: 'tool-call-failed',
              name: 'write_file',
              arguments: '{"path":"deliverables/report.md"}',
              status: 'failed',
              result: '{"error":"storage unavailable","observation":"write rejected"}',
            },
          ],
        },
      ],
      now: NOW,
    });

    expect(state.code).toBe('recorded_candidate');
    const facts = listFacts({ originTaskId: 'task-1' });
    expect(facts.map((fact) => fact.memoryKind).sort()).toEqual(['agent_run', 'evidence_span']);
    expect(facts.find((fact) => fact.memoryKind === 'agent_run')?.attributes).toEqual(
      expect.objectContaining({ status: 'error', outcome: 'blocked' }),
    );
    expect(facts.find((fact) => fact.memoryKind === 'evidence_span')?.sourceAuthority).toBe(
      'tool_observed',
    );
  });

  it('fails closed before writing when the persisted source scope does not bind to the worker', async () => {
    const recordEvidence = jest.fn();
    const state = await reconcileSubAgentOutcomeMemory({
      agent: makeAgent(),
      config: makeConfig({
        memorySelectionScope: {
          memoryConversationId: 'memory-root',
          sourceThreadId: 'different-thread',
          personaId: 'super-agent',
          taskId: 'task-1',
        },
      }),
      messages: makeObservedMessages(),
      now: NOW,
      recordEvidence,
    });

    expect(state).toEqual(
      expect.objectContaining({ status: 'blocked', code: 'source_scope_mismatch' }),
    );
    expect(recordEvidence).not.toHaveBeenCalled();
    expect(listFacts()).toEqual([]);
  });

  it('honors memory opt-out without invoking the persistence boundary', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const recordEvidence = jest.fn();

    const state = await reconcileSubAgentOutcomeMemory({
      agent: makeAgent(),
      config: makeConfig(),
      messages: makeObservedMessages(),
      now: NOW,
      recordEvidence,
    });

    expect(state).toEqual(expect.objectContaining({ status: 'blocked', code: 'memory_disabled' }));
    expect(recordEvidence).not.toHaveBeenCalled();
    expect(listFacts()).toEqual([]);
  });

  it('retries bounded write failures and settles closed after the configured limit', async () => {
    const recordEvidence = jest.fn(() => {
      throw new Error('disk unavailable');
    });
    const agent = makeAgent();

    for (let attempt = 1; attempt <= SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS; attempt += 1) {
      const state = await reconcileSubAgentOutcomeMemory({
        agent,
        config: makeConfig(),
        messages: makeObservedMessages(),
        now: NOW + attempt,
        recordEvidence,
      });
      agent.outcomeReconciliation = state;
      expect(state.attemptCount).toBe(attempt);
      if (attempt < SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS) {
        expect(state).toEqual(expect.objectContaining({ status: 'pending', code: 'write_failed' }));
      } else {
        expect(state).toEqual(
          expect.objectContaining({ status: 'blocked', code: 'retry_exhausted' }),
        );
      }
    }

    const settled = await reconcileSubAgentOutcomeMemory({
      agent,
      config: makeConfig(),
      messages: makeObservedMessages(),
      now: NOW + 10,
      recordEvidence,
    });
    expect(settled).toEqual(agent.outcomeReconciliation);
    expect(recordEvidence).toHaveBeenCalledTimes(SUB_AGENT_OUTCOME_RECONCILIATION_MAX_ATTEMPTS);
    expect(listFacts()).toEqual([]);
  });
});

describe('worker outcome receipt validation', () => {
  const completed: SubAgentOutcomeReconciliationState = {
    status: 'completed',
    code: 'recorded_verified',
    attemptCount: 1,
    updatedAt: NOW,
    completedAt: NOW,
    factIds: ['fact-1'],
  };

  it('accepts only internally consistent receipt states', () => {
    expect(sanitizeSubAgentOutcomeReconciliationState(completed)).toEqual(completed);
    expect(
      sanitizeSubAgentOutcomeReconciliationState({
        status: 'pending',
        code: 'write_failed',
        attemptCount: 2,
        updatedAt: NOW,
      }),
    ).toEqual({ status: 'pending', code: 'write_failed', attemptCount: 2, updatedAt: NOW });
    expect(
      sanitizeSubAgentOutcomeReconciliationState({
        status: 'blocked',
        code: 'retry_exhausted',
        attemptCount: 3,
        updatedAt: NOW,
      }),
    ).toEqual({ status: 'blocked', code: 'retry_exhausted', attemptCount: 3, updatedAt: NOW });
  });

  it.each([
    { ...completed, factIds: [] },
    { ...completed, factIds: undefined },
    { ...completed, code: 'memory_disabled' },
    { ...completed, attemptCount: 0 },
    { ...completed, completedAt: undefined },
    { status: 'pending', code: 'pending', attemptCount: 1, updatedAt: NOW },
    { status: 'pending', code: 'write_failed', attemptCount: 3, updatedAt: NOW },
    { status: 'pending', code: 'pending', attemptCount: 0, updatedAt: NOW, factIds: ['fact-1'] },
    { status: 'blocked', code: 'recorded_verified', attemptCount: 1, updatedAt: NOW },
    {
      status: 'blocked',
      code: 'retry_exhausted',
      attemptCount: 3,
      updatedAt: NOW,
      completedAt: NOW,
    },
  ])('rejects malformed state %#', (value) => {
    expect(sanitizeSubAgentOutcomeReconciliationState(value)).toBeUndefined();
  });
});
