jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { CONSOLIDATION_FACT_PRODUCER_IDS } from '../../src/services/memory/consolidation/factContributionIdentity';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { editWorkingBlock, getWorkingBlock } from '../../src/services/memory/workingBlocks';
import { listFacts } from '../../src/services/memory/facts/queries';
import { findEntityByName } from '../../src/services/memory/entities';
import { listEpisodes, listFactEvidence } from '../../src/services/memory/episodes/queries';
import {
  parseConsolidatorOutput,
  applyThreadLocalConsolidatorResult,
} from '../../src/services/memory/consolidator';
import { semanticFactProposalJson } from '../helpers/semanticFactProposalFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const THREAD_LOCAL_PRODUCER = CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport;
const CODE_OWNED_NORMAL_SENSITIVITY = {
  version: 1,
  source: 'code_owned',
  sensitivity: 'normal',
} as const;

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

describe('parseConsolidatorOutput', () => {
  const validProposal = (overrides: Record<string, unknown> = {}) =>
    semanticFactProposalJson(
      { id: 'user-current', text: 'I live in Berlin' },
      {
        predicate: 'lives_in',
        value: 'Berlin',
        scope: 'global',
        sensitivity: 'personal',
        ...overrides,
      },
    );
  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    episode_sensitivity: 'normal',
    episode_summary: null,
    new_facts: [],
    active_focus: null,
    open_threads: [],
    notable: [],
    ...overrides,
  });

  it('returns valid for a strict canonical JSON payload', () => {
    const raw = JSON.stringify({
      ...validPayload(),
      new_facts: [validProposal()],
      active_focus: 'Setting up after relocating.',
      open_threads: ['Suggest a SIM card provider'],
      notable: ['User just moved to Berlin'],
    });
    const outcome = parseConsolidatorOutput(raw);
    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected valid outcome');
    expect(outcome.result.newFacts).toHaveLength(1);
    expect(outcome.result.newFacts[0]).toMatchObject({
      version: 1,
      subjectRef: { kind: 'self' },
      predicate: 'lives_in',
      value: 'Berlin',
      confidence: 0.9,
    });
    expect(outcome.result.activeFocus).toBe('Setting up after relocating.');
    expect(outcome.result.openThreads).toEqual(['Suggest a SIM card provider']);
    expect(outcome.result.notable).toEqual(['User just moved to Berlin']);
  });

  it('distinguishes a valid intentionally empty payload', () => {
    expect(parseConsolidatorOutput(JSON.stringify(validPayload()))).toEqual({
      status: 'empty_valid',
      result: {
        episodeSummary: null,
        episodeSensitivity: 'normal',
        newFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });
  });

  it.each([
    ['', 'empty_response'],
    ['not json at all', 'invalid_json'],
    ['```json\n{}\n```', 'invalid_json'],
    ['null', 'non_object'],
    ['[]', 'non_object'],
    ['"text"', 'non_object'],
  ])('returns a bounded malformed outcome for %p', (raw, code) => {
    expect(parseConsolidatorOutput(raw)).toEqual({ status: 'malformed', code });
  });

  it.each([
    [{}, 'missing_required_field'],
    [
      (() => {
        const missingSensitivity: Record<string, unknown> = validPayload();
        delete missingSensitivity.episode_sensitivity;
        return missingSensitivity;
      })(),
      'missing_required_field',
    ],
    [validPayload({ episodeSummary: null }), 'unexpected_field'],
    [validPayload({ episode_sensitivity: 'private' }), 'invalid_field_value'],
    [validPayload({ episode_sensitivity: null }), 'invalid_field_type'],
    [validPayload({ open_threads: null }), 'invalid_field_type'],
    [validPayload({ active_focus: '' }), 'invalid_field_value'],
    [validPayload({ notable: ['x'.repeat(201)] }), 'limit_exceeded'],
  ])('returns a bounded schema outcome instead of coercing %p', (payload, code) => {
    expect(parseConsolidatorOutput(JSON.stringify(payload))).toEqual({
      status: 'schema_invalid',
      code,
    });
  });

  it('rejects an oversized payload instead of truncating it', () => {
    const raw = JSON.stringify(
      validPayload({
        new_facts: Array.from({ length: 6 }, (_, i) => ({
          ...validProposal(),
          predicate: `p${i}`,
        })),
      }),
    );
    expect(parseConsolidatorOutput(raw)).toEqual({
      status: 'schema_invalid',
      code: 'limit_exceeded',
    });
  });

  it('invalidates the whole payload when any fact is invalid', () => {
    const raw = JSON.stringify(
      validPayload({
        new_facts: [
          validProposal({ predicate: 'has_name', value: 'Mo', evidence_quote: 'My name is Mo' }),
          (() => {
            const invalid = validProposal();
            delete invalid.value;
            return invalid;
          })(),
        ],
      }),
    );
    expect(parseConsolidatorOutput(raw)).toEqual({
      status: 'schema_invalid',
      code: 'missing_required_field',
    });
  });

  it.each([
    [{ ...validProposal(), object: 'v' }, 'unexpected_field'],
    [
      {
        ...validProposal(),
        assertionClass: 'current_direct',
      },
      'unexpected_field',
    ],
    [
      {
        ...validProposal(),
        evidenceQuote: 'v',
      },
      'unexpected_field',
    ],
    [{ ...validProposal(), confidence: 'high' }, 'invalid_field_value'],
    [{ ...validProposal(), confidence: 2 }, 'invalid_field_value'],
    [{ ...validProposal(), evidence_message_ids: ['ok', 2] }, 'unexpected_field'],
  ])('rejects aliases and invalid fact field values: %p', (fact, code) => {
    expect(parseConsolidatorOutput(JSON.stringify(validPayload({ new_facts: [fact] })))).toEqual({
      status: 'schema_invalid',
      code,
    });
  });
});

describe('applyThreadLocalConsolidatorResult', () => {
  it('records new facts and updates the active_focus block', () => {
    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [
          {
            subject: 'user',
            predicate: 'lives_in',
            value: 'Berlin',
            confidence: 0.9,
            scope: 'global',
            importance: 0.8,
            evidenceMessageIds: ['u-1'],
            reason: 'The user stated this directly.',
            sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
          },
        ],
        activeFocus: 'Settling into Berlin.',
        openThreads: ['Suggest a SIM card provider'],
        notable: [],
      },
      {
        now: 1_700_000_000_000,
        conversationId: 'conv-1',
        threadId: 'conv-1',
        sourceUserMessageId: 'u-1',
        sourceAssistantMessageId: 'a-1',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );
    expect(result.recordedFacts).toHaveLength(1);
    expect(result.activeFocusUpdated).toBe(true);
    expect(result.openThreadsUpdated).toBe(true);

    const userEntity = findEntityByName('user');
    expect(userEntity).not.toBeNull();
    const facts = listFacts({ subjectId: userEntity!.id });
    expect(facts).toHaveLength(1);
    expect(facts[0].objectText).toBe('Berlin');
    expect(facts[0].scope).toBe('global');
    expect(facts[0].originConversationId).toBeNull();
    expect(facts[0].importance).toBe(0.8);
    expect(listFactEvidence(facts[0].id)).toHaveLength(1);

    const focusBlock = getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
    });
    expect(focusBlock?.content).toBe('Settling into Berlin.');
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'conv-1',
        threadId: 'conv-1',
      })?.content,
    ).toContain('Suggest a SIM card provider');
  });

  it('preserves thread title metadata when provider focus omits it', () => {
    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: 'Running: memory_recall',
        openThreads: [],
        notable: [],
      },
      {
        now: 1_700_000_000_001,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        threadTitle: 'longmem-delayed-thread',
        sourceAssistantMessageId: 'assistant-longmem-focus',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    expect(result.activeFocusUpdated).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
      })?.content,
    ).toBe('longmem-delayed-thread\nRunning: memory_recall');
  });

  it('skips active_focus writes when taskId is set (graph-owned task focus)', () => {
    editWorkingBlock('active_focus', 'scope-b-planning', {
      conversationId: 'conv-task',
      threadId: 'conv-task',
      taskId: 'scope-b',
    });

    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: 'Running: update_goals',
        openThreads: [],
        notable: [],
      },
      {
        now: 3,
        conversationId: 'conv-task',
        threadId: 'conv-task',
        taskId: 'scope-b',
        sourceAssistantMessageId: 'assistant-task-focus',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    expect(result.activeFocusUpdated).toBe(false);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task',
        threadId: 'conv-task',
        taskId: 'scope-b',
      })?.content,
    ).toBe('scope-b-planning');
  });

  it('skips working-memory writes when persistence is durable-only', () => {
    editWorkingBlock('active_focus', 'live-focus-token', {
      conversationId: 'conv-delayed',
      threadId: 'conv-delayed',
    });
    editWorkingBlock('open_threads', 'live-open-thread', {
      conversationId: 'conv-delayed',
      threadId: 'conv-delayed',
    });

    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: 'Delayed ingestion finished.',
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: 'stale-delayed-focus-token',
        openThreads: ['stale delayed thread'],
        notable: [],
      },
      {
        now: 4,
        conversationId: 'conv-delayed',
        threadId: 'conv-delayed',
        skipWorkingMemoryWrites: true,
        messages: [
          {
            id: 'user-delayed',
            role: 'user',
            content: 'Finish the delayed ingestion.',
            timestamp: 3,
          },
          {
            id: 'assistant-delayed',
            role: 'assistant',
            content: 'Delayed ingestion finished.',
            timestamp: 4,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          },
        ],
        sourceUserMessageId: 'user-delayed',
        sourceAssistantMessageId: 'assistant-delayed',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    expect(result.activeFocusUpdated).toBe(false);
    expect(result.openThreadsUpdated).toBe(false);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-delayed',
        threadId: 'conv-delayed',
      })?.content,
    ).toBe('live-focus-token');
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'conv-delayed',
        threadId: 'conv-delayed',
      })?.content,
    ).toBe('live-open-thread');
    expect(listEpisodes({ threadId: 'conv-delayed', limit: 1 })[0]?.summary).toBe(
      'Delayed ingestion finished.',
    );
  });

  it('does not grant ordinary consolidation broad cross-task supersession', () => {
    applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [
          {
            subject: 'direct-longmem-user',
            predicate: 'preferred_message_contact',
            value: 'Morgan',
            scope: 'conversation',
            sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 10,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        taskId: 'memory-goal-a',
        sourceUserMessageId: 'u-1',
        sourceAssistantMessageId: 'a-1',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );
    applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [
          {
            subject: 'direct-longmem-user',
            predicate: 'preferred_message_contact',
            value: 'Avery',
            scope: 'conversation',
            sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 20,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        taskId: 'memory-goal-b',
        sourceUserMessageId: 'u-2',
        sourceAssistantMessageId: 'a-2',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    const subject = findEntityByName('direct-longmem-user');
    expect(subject).not.toBeNull();
    const currentFacts = listFacts({
      subjectId: subject!.id,
      predicate: 'preferred_message_contact',
      includeInvalidated: false,
    });
    expect(currentFacts.map((fact) => fact.objectText).sort()).toEqual(['Avery', 'Morgan']);

    const historicalFacts = listFacts({
      subjectId: subject!.id,
      predicate: 'preferred_message_contact',
      includeInvalidated: true,
    });
    expect(historicalFacts.map((fact) => fact.objectText).sort()).toEqual(['Avery', 'Morgan']);
    expect(historicalFacts.every((fact) => fact.invalidAt === null)).toBe(true);
  });

  it('clears scoped open_threads when the consolidator returns an empty list', () => {
    applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: null,
        openThreads: ['Old follow-up'],
        notable: [],
      },
      {
        now: 1,
        conversationId: 'conv-clear',
        threadId: 'conv-clear',
        sourceAssistantMessageId: 'assistant-clear-1',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 2,
        conversationId: 'conv-clear',
        threadId: 'conv-clear',
        sourceAssistantMessageId: 'assistant-clear-2',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );

    expect(result.openThreadsUpdated).toBe(true);
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'conv-clear',
        threadId: 'conv-clear',
      })?.content,
    ).toBe('');
  });

  it('persists episode summaries as searchable episodic memory', () => {
    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: 'The user compared local model runtime options.',
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 10_000,
        conversationId: 'conv-episode',
        threadId: 'conv-episode',
        sourceAssistantMessageId: 'a-episode',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
        messages: [
          { id: 'u-episode', role: 'user', content: 'Compare runtimes', timestamp: 9_000 },
          { id: 'a-episode', role: 'assistant', content: 'Done', timestamp: 10_000 },
        ] as any,
      },
    );

    expect(result.episodeId).toEqual(expect.any(String));
    expect(listEpisodes({ conversationId: 'conv-episode' })[0]?.summary).toContain(
      'runtime options',
    );
  });

  it('is idempotent: re-applying the same result records no duplicates', () => {
    const result = {
      episodeSummary: null,
      episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
      newFacts: [
        {
          subject: 'user',
          predicate: 'lives_in',
          value: 'Berlin' as const,
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };
    const first = applyThreadLocalConsolidatorResult(result, {
      conversationId: 'conv-idempotent',
      threadId: 'thread-idempotent',
      sourceAssistantMessageId: 'assistant-idempotent',
      factContributionProducerId: THREAD_LOCAL_PRODUCER,
      now: 1,
    });
    const second = applyThreadLocalConsolidatorResult(result, {
      conversationId: 'conv-idempotent',
      threadId: 'thread-idempotent',
      sourceAssistantMessageId: 'assistant-idempotent',
      factContributionProducerId: THREAD_LOCAL_PRODUCER,
      now: 1,
    });
    expect(first.recordedFacts).toHaveLength(1);
    expect(second.recordedFacts).toHaveLength(0);
    const userEntity = findEntityByName('user');
    expect(listFacts({ subjectId: userEntity!.id })).toHaveLength(1);
  });

  it('skips active_focus update when null', () => {
    const result = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 1,
        conversationId: 'conv-null-focus',
        threadId: 'conv-null-focus',
        sourceAssistantMessageId: 'assistant-null-focus',
        factContributionProducerId: THREAD_LOCAL_PRODUCER,
      },
    );
    expect(result.activeFocusUpdated).toBe(false);
  });
});
