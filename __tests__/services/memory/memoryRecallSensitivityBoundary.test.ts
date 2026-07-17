jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  createExplicitMemoryRecallGrant,
  resetExplicitMemoryRecallGrantStateForTests,
} from '../../../src/services/memory/explicitMemoryRecallGrant';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  executeMemoryRecall,
  type MemoryRecallExecutionContext,
} from '../../../src/services/memory/memoryTools';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from '../../../src/services/memory/memorySensitivityPolicy';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const BASE_EXECUTION = {
  memoryConversationId: 'sensitivity-root',
  sourceThreadId: 'sensitivity-thread',
  personaId: 'default',
  taskId: 'sensitivity-task',
  now: 1_000,
} as const;
const SUBJECT = 'user';
const PREDICATE = '属性_医療42';
const VALUE = '値_π_成功_error';
const ORDINARY_PREDICATE = '表示_theme_42';
const ORDINARY_VALUE = '普通_値';
const RESTRICTED_PREDICATE = '保管庫_secret_42';
const RESTRICTED_VALUE = '絶対に返さない';
const MESSAGE = '请显示我保存的健康资料';
const REQUEST_IDENTITY = {
  currentUserMessageId: 'user-message-sensitive-natural',
  currentUserMessageText: MESSAGE,
  executionRunId: 'execution-sensitive-natural',
  toolCallId: 'tool-call-sensitive-natural',
  agentRunId: 'agent-sensitive-natural',
} as const;
type RequestIdentity = NonNullable<MemoryRecallExecutionContext['requestIdentity']>;

function explicitEvidence(
  input: {
    messageId?: string;
    message?: string;
    predicate?: string;
    relationQuote?: string;
    overrides?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    version: 1,
    source_message_id: input.messageId ?? REQUEST_IDENTITY.currentUserMessageId,
    evidence_quote: input.message ?? MESSAGE,
    subject_ref: { kind: 'self' },
    subject_quote: '我',
    predicate: input.predicate ?? PREDICATE,
    relation_quote: input.relationQuote ?? '健康资料',
    ...input.overrides,
  };
}

function explicitExecution(
  input: {
    requestIdentity?: RequestIdentity;
    evidence?: unknown;
    executionOverrides?: Partial<MemoryRecallExecutionContext>;
  } = {},
): MemoryRecallExecutionContext {
  const execution = { ...BASE_EXECUTION, ...input.executionOverrides };
  const requestIdentity = input.requestIdentity ?? REQUEST_IDENTITY;
  const explicitUserRequestGrant = createExplicitMemoryRecallGrant({
    ...requestIdentity,
    explicitRequestEvidence: input.evidence ?? explicitEvidence(),
    scope: resolveLocalMemoryAccessScope({
      memoryConversationId: execution.memoryConversationId,
      sourceThreadId: execution.sourceThreadId,
      personaId: execution.personaId,
      taskId: execution.taskId,
    }),
  });
  return {
    ...execution,
    requestIdentity,
    ...(explicitUserRequestGrant ? { explicitUserRequestGrant } : {}),
  };
}

function factValues(result: ReturnType<typeof executeMemoryRecall>): string[] {
  return result.ok ? result.facts.map((fact) => fact.value) : [];
}

function recordFact(
  predicate: string,
  value: string,
  sensitivity: 'normal' | 'sensitive' | 'restricted',
): void {
  const entity = upsertEntity({ name: SUBJECT, type: 'self', now: 50 });
  const fact = recordFactWithApplicability(
    { subjectId: entity.id, predicate, objectText: value, scope: 'global', now: 100 },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  getMemoryDb().runSync(
    `UPDATE memory_facts SET sensitivity = ?, sensitivity_policy_version = ? WHERE id = ?`,
    sensitivity,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    fact.fact.id,
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  resetExplicitMemoryRecallGrantStateForTests();
  ensureFactSchema();
  recordFact(PREDICATE, VALUE, 'sensitive');
  recordFact(ORDINARY_PREDICATE, ORDINARY_VALUE, 'normal');
  recordFact(RESTRICTED_PREDICATE, RESTRICTED_VALUE, 'restricted');
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('typed sensitive-recall authority', () => {
  it('preserves ordinary automatic recall while hiding sensitive facts by default', () => {
    expect(
      factValues(
        executeMemoryRecall({ subject: SUBJECT, predicate: ORDINARY_PREDICATE }, BASE_EXECUTION),
      ),
    ).toEqual([ORDINARY_VALUE]);
    expect(
      factValues(executeMemoryRecall({ subject: SUBJECT, predicate: PREDICATE }, BASE_EXECUTION)),
    ).toEqual([]);
  });

  it('binds a natural mixed-script request to a canonical predicate not present in its prose', () => {
    expect(MESSAGE).not.toContain(PREDICATE);
    const evidence = explicitEvidence();
    const result = executeMemoryRecall(
      { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
      explicitExecution({ evidence }),
    );
    expect(factValues(result)).toEqual([VALUE]);
  });

  it.each([
    ['wrong source', { source_message_id: 'different-message' }],
    ['wrong evidence quote', { evidence_quote: `${MESSAGE}!` }],
    ['wrong subject quote', { subject_quote: 'missing subject' }],
    ['wrong relation quote', { relation_quote: 'missing relation' }],
    ['extra field', { provider_authorized: true }],
  ])('rejects %s without exposing sensitive content', (_label, override) => {
    const evidence = explicitEvidence({ overrides: override });
    const result = executeMemoryRecall(
      { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
      explicitExecution({ evidence }),
    );
    expect(factValues(result)).toEqual([]);
  });

  it('never returns permanently restricted facts even with valid typed evidence', () => {
    const message = '请显示我保存的保险库资料';
    const identity: RequestIdentity = {
      currentUserMessageId: 'user-message-restricted-natural',
      currentUserMessageText: message,
      executionRunId: 'execution-restricted-natural',
      toolCallId: 'tool-call-restricted-natural',
      agentRunId: 'agent-restricted-natural',
    };
    const evidence = explicitEvidence({
      messageId: identity.currentUserMessageId,
      message,
      predicate: RESTRICTED_PREDICATE,
      relationQuote: '保险库资料',
    });
    expect(
      factValues(
        executeMemoryRecall(
          {
            subject: SUBJECT,
            predicate: RESTRICTED_PREDICATE,
            explicitRequestEvidence: evidence,
          },
          explicitExecution({ requestIdentity: identity, evidence }),
        ),
      ),
    ).toEqual([]);
  });

  it('allows one exact use and rejects immediate replay of its execution identity', () => {
    const evidence = explicitEvidence();
    const execution = explicitExecution({ evidence });
    expect(
      factValues(
        executeMemoryRecall(
          { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
          execution,
        ),
      ),
    ).toEqual([VALUE]);
    expect(
      factValues(
        executeMemoryRecall(
          { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
          execution,
        ),
      ),
    ).toEqual([]);
    expect(
      createExplicitMemoryRecallGrant({
        ...REQUEST_IDENTITY,
        explicitRequestEvidence: evidence,
        scope: resolveLocalMemoryAccessScope({
          memoryConversationId: BASE_EXECUTION.memoryConversationId,
          sourceThreadId: BASE_EXECUTION.sourceThreadId,
          personaId: BASE_EXECUTION.personaId,
          taskId: BASE_EXECUTION.taskId,
        }),
      }),
    ).toBeNull();
  });

  it.each([
    ['execution run', { executionRunId: 'different-execution-run' }],
    ['tool call', { toolCallId: 'different-tool-call' }],
    ['message id', { currentUserMessageId: 'different-message-id' }],
    ['message text', { currentUserMessageText: `${MESSAGE}!` }],
    ['agent run', { agentRunId: 'different-agent-run' }],
  ] satisfies ReadonlyArray<readonly [string, Partial<RequestIdentity>]>)(
    'rejects a %s identity mismatch and consumes the grant',
    (_label, requestIdentityOverride) => {
      const evidence = explicitEvidence();
      const execution = explicitExecution({ evidence });
      expect(
        factValues(
          executeMemoryRecall(
            { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
            {
              ...execution,
              requestIdentity: { ...REQUEST_IDENTITY, ...requestIdentityOverride },
            },
          ),
        ),
      ).toEqual([]);
      expect(
        factValues(
          executeMemoryRecall(
            { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: evidence },
            execution,
          ),
        ),
      ).toEqual([]);
    },
  );

  it('consumes authority on subject, predicate, broad-query, or scope mismatch', () => {
    const cases = [
      { args: { subject: 'different', predicate: PREDICATE } },
      { args: { subject: SUBJECT, predicate: 'different' } },
      { args: { subject: SUBJECT, predicate: PREDICATE, all: true } },
      {
        args: { subject: SUBJECT, predicate: PREDICATE },
        execution: { sourceThreadId: 'different-thread' },
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      resetExplicitMemoryRecallGrantStateForTests();
      const identity: RequestIdentity = {
        ...REQUEST_IDENTITY,
        executionRunId: `${REQUEST_IDENTITY.executionRunId}-${index}`,
        toolCallId: `${REQUEST_IDENTITY.toolCallId}-${index}`,
      };
      const evidence = explicitEvidence();
      const base = explicitExecution({ requestIdentity: identity, evidence });
      expect(
        factValues(
          executeMemoryRecall(
            { ...testCase.args, explicitRequestEvidence: evidence },
            { ...base, ...testCase.execution },
          ),
        ),
      ).toEqual([]);
    }
  });

  it('does not accept a provider-forged visible grant object', () => {
    const result = executeMemoryRecall(
      { subject: SUBJECT, predicate: PREDICATE, explicitRequestEvidence: explicitEvidence() },
      {
        ...BASE_EXECUTION,
        requestIdentity: REQUEST_IDENTITY,
        explicitUserRequestGrant: { kind: 'explicit_memory_recall_grant' },
      },
    );
    expect(factValues(result)).toEqual([]);
  });
});
