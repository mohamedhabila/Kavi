jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { bindReadFileEvidence } from '../../helpers/memoryRememberSemanticEvidence';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { findEntityByName } from '../../../src/services/memory/entities';
import { listFactEvidence } from '../../../src/services/memory/episodes/queries';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import { persistMemoryRemember } from '../../../src/services/memory/memoryRememberPersistence';
import {
  bindMemoryRememberSemanticEvidence,
  resolveBoundMemoryRememberSemanticEvidence,
} from '../../../src/services/memory/memoryRememberSemanticEvidence';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const MESSAGE_ID = 'message-opaque-authority';
const SUBJECT = '主体_ω42';
const PREDICATE = '属性_π42';
const VALUE = 'значение_成功_error_failed';
const MESSAGE = `${SUBJECT} :: 関係_本文42 :: ${VALUE}`;

function args(overrides: Partial<Parameters<typeof memoryRememberArgs>[0]> = {}) {
  return memoryRememberArgs({
    userMessageText: MESSAGE,
    subjectRef: { kind: 'named', label: SUBJECT },
    subjectType: 'concept',
    predicate: PREDICATE,
    value: VALUE,
    scope: 'conversation',
    operation: 'record',
    ...overrides,
  });
}

function execution(overrides: Partial<Parameters<typeof memoryRememberExecution>[0]> = {}) {
  return memoryRememberExecution({
    memoryConversationId: 'memory-root-opaque',
    sourceThreadId: 'thread-opaque',
    userMessageId: MESSAGE_ID,
    userMessageText: MESSAGE,
    executionRunId: 'execution-opaque',
    toolCallId: 'tool-call-opaque',
    claimedAt: 1_000,
    ...overrides,
  });
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

describe('typed memory_remember semantic authority', () => {
  it('persists arbitrary mixed-script labels despite misleading outcome prose', () => {
    const result = executeMemoryRemember(args(), execution());

    expect(result).toMatchObject({
      ok: true,
      status: 'created',
      fact: {
        subject: SUBJECT,
        predicate: PREDICATE,
        value: VALUE,
        scope: 'conversation',
        sourceMessageId: MESSAGE_ID,
        originConversationId: 'memory-root-opaque',
        originThreadId: 'thread-opaque',
      },
    });
    expect(findEntityByName(SUBJECT)).not.toBeNull();
  });

  it.each(['has default_workspace', 'has_default_workspace'])(
    'preserves an explicit current-user predicate identifier from %s',
    (modelPredicate) => {
      const caseId = modelPredicate.replace(/[^a-z0-9]+/gu, '-');
      const userMessageText =
        'Remember that subject `expense-app` has default_workspace `TEAM-EXPENSE-E2E`.';
      const result = executeMemoryRemember(
        memoryRememberArgs({
          userMessageText,
          subjectRef: { kind: 'named', label: 'expense-app' },
          subjectType: 'project',
          predicate: modelPredicate,
          value: 'TEAM-EXPENSE-E2E',
          scope: 'global',
        }),
        memoryRememberExecution({
          userMessageId: `message-explicit-predicate-${caseId}`,
          userMessageText,
          executionRunId: `execution-explicit-predicate-${caseId}`,
          toolCallId: `tool-explicit-predicate-${caseId}`,
        }),
      );

      expect(result).toMatchObject({
        ok: true,
        fact: {
          subject: 'expense-app',
          predicate: 'default_workspace',
          value: 'TEAM-EXPENSE-E2E',
          scope: 'global',
        },
      });
    },
  );

  it.each(['historical', 'hypothetical', 'quoted', 'third_party', 'uncertain'] as const)(
    'rejects assertion_class=%s structurally without a write',
    (assertionClass) => {
      const result = executeMemoryRemember(args({ assertionClass }), execution());
      expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
      expect(listFacts({ includeInvalidated: true })).toEqual([]);
    },
  );

  it.each([
    [
      'value',
      (input: ReturnType<typeof args>) => {
        (input.semanticEvidence as Record<string, unknown>).value = '不存在_value';
      },
    ],
    [
      'named subject',
      (input: ReturnType<typeof args>) => {
        (input.semanticEvidence as Record<string, unknown>).subject = {
          kind: 'named',
          label: '不存在_subject',
          type: 'concept',
        };
      },
    ],
  ] as const)('rejects an exact %s mismatch', (_label, mutate) => {
    const input = args();
    mutate(input);
    const result = executeMemoryRemember(input, execution());
    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it.each([
    {
      language: 'Arabic',
      subject: 'مشروع-نورس',
      value: 'جاهز-٧٢',
    },
    {
      language: 'Japanese',
      subject: '計画-星',
      value: '準備完了-四二',
    },
    {
      language: 'Chinese',
      subject: '项目-青鸟',
      value: '状态-完成',
    },
    {
      language: 'opaque combining-mark text',
      subject: 'unit-e\u0301',
      value: 'state-a\u030Angstro\u0308m',
    },
  ])(
    'derives the same minimal exact evidence structure for $language without language rules',
    ({ subject, value }) => {
      const closest = `${subject}⇢${value}`;
      const userMessageText = `${subject}${'◇'.repeat(40)}${value}${'◇'.repeat(20)}${closest}｜${value}`;
      const input = memoryRememberArgs({
        userMessageText,
        subjectRef: { kind: 'named', label: subject },
        subjectType: 'concept',
        predicate: 'opaque-relation',
        value,
      });
      const request = memoryRememberExecution({
        userMessageId: `message-${subject}`,
        userMessageText,
      }).requestEvidence;

      const bound = bindMemoryRememberSemanticEvidence(input.semanticEvidence, request);
      expect(bound.valid).toBe(true);
      if (!bound.valid) throw new Error(bound.code);
      expect(resolveBoundMemoryRememberSemanticEvidence(bound.evidence)?.evidenceSpan).toBe(
        closest,
      );
    },
  );

  it('persists only the code-derived minimal span as source evidence', () => {
    const subject = '项目-青鸟';
    const value = '状态-完成';
    const minimalSpan = `${subject}⇢${value}`;
    const userMessageText = `${subject}${'界'.repeat(40)}${value}${'界'.repeat(20)}${minimalSpan}`;
    const result = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText,
        subjectRef: { kind: 'named', label: subject },
        subjectType: 'project',
        predicate: 'opaque_state',
        value,
        scope: 'conversation',
      }),
      memoryRememberExecution({
        memoryConversationId: 'memory-root-minimal',
        sourceThreadId: 'thread-minimal',
        userMessageId: 'message-minimal-span',
        userMessageText,
        executionRunId: 'execution-minimal-span',
        toolCallId: 'tool-minimal-span',
      }),
    );

    expect(result).toMatchObject({ ok: true });
    const [fact] = listFacts({ predicate: 'opaque_state' });
    expect(fact?.attributes).toMatchObject({
      memoryWrite: {
        evidenceMessageId: 'message-minimal-span',
        evidenceQuote: minimalSpan,
        evidenceSourceSha256: sha256HexUtf8(userMessageText),
      },
    });
    expect(listFactEvidence(fact!.id)).toEqual([
      expect.objectContaining({ messageId: 'message-minimal-span', quote: minimalSpan }),
    ]);
  });

  it('persists an exact named-subject fact from a verified current-run read result', () => {
    const userMessageId = 'message-retain-release-policy';
    const userMessageText = 'Inspect the release policy and retain its reusable constraint.';
    const executionRunId = 'execution-retain-release-policy';
    const sourceResult =
      'Durable fact labels: subject mobile-release-workflow, predicate required_artifact_suffix, value .approved.txt.';
    const toolObservedEvidence = bindReadFileEvidence({
      executionRunId,
      userMessageId,
      userMessageText,
      result: sourceResult,
    });
    expect(toolObservedEvidence).toHaveLength(1);

    const result = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText,
        subjectRef: { kind: 'named', label: 'mobile-release-workflow' },
        subjectType: 'project',
        predicate: 'required_artifact_suffix',
        value: '.approved.txt',
        scope: 'global',
        operation: 'record',
        assertionClass: 'quoted',
      }),
      memoryRememberExecution({
        memoryConversationId: 'memory-release-project',
        sourceThreadId: 'thread-release-project',
        userMessageId,
        userMessageText,
        executionRunId,
        toolCallId: 'tool-call-remember-release-policy',
        toolObservedEvidence,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'created',
      fact: {
        subject: 'mobile-release-workflow',
        predicate: 'required_artifact_suffix',
        value: '.approved.txt',
        scope: 'project',
        sourceMessageId: 'message-tool-read-release-policy',
      },
    });
    const [fact] = listFacts({ predicate: 'required_artifact_suffix' });
    expect(fact?.sourceAuthority).toBe('tool_observed');
    expect(fact?.attributes).toMatchObject({
      memoryWrite: {
        authority: 'verified_tool_observation',
        evidenceSourceKind: 'tool_observed',
        sourceToolCallId: 'tool-call-read-release-policy',
        sourceToolName: 'read_file',
        evidenceSourceSha256: sha256HexUtf8(sourceResult),
      },
    });
    expect(listFactEvidence(fact!.id)).toEqual([
      expect.objectContaining({
        messageId: 'message-tool-read-release-policy',
        role: 'tool',
        quote: 'mobile-release-workflow, predicate required_artifact_suffix, value .approved.txt',
      }),
    ]);
  });

  it.each([
    ['replacement', { operation: 'replace_current' as const }],
    ['self subject', { subjectRef: { kind: 'self' as const }, subjectType: 'self' as const }],
  ])('rejects tool-observed %s without writing memory', (_label, override) => {
    const caseId = _label.replace(/\s+/gu, '-');
    const userMessageId = `message-tool-observed-reject-${caseId}`;
    const userMessageText = 'Inspect and retain the exact result.';
    const executionRunId = `execution-tool-observed-reject-${caseId}`;
    const sourceResult = 'subject project-opaque value constraint-opaque';
    const toolObservedEvidence = bindReadFileEvidence({
      executionRunId,
      userMessageId,
      userMessageText,
      result: sourceResult,
    });
    const result = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText,
        subjectRef: { kind: 'named', label: 'project-opaque' },
        subjectType: 'project',
        predicate: 'constraint',
        value: 'constraint-opaque',
        scope: 'project',
        operation: 'record',
        assertionClass: 'quoted',
        ...override,
      }),
      memoryRememberExecution({
        userMessageId,
        userMessageText,
        executionRunId,
        toolCallId: `tool-call-tool-observed-reject-${caseId}`,
        toolObservedEvidence,
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it.each(['global', 'persona'] as const)(
    'narrows tool-observed %s scope to the project boundary',
    (scope) => {
      const userMessageId = `message-tool-observed-scope-${scope}`;
      const userMessageText = 'Inspect and retain the exact result.';
      const executionRunId = `execution-tool-observed-scope-${scope}`;
      const sourceResult = 'subject project-opaque value constraint-opaque';
      const toolObservedEvidence = bindReadFileEvidence({
        executionRunId,
        userMessageId,
        userMessageText,
        result: sourceResult,
      });
      const result = executeMemoryRemember(
        memoryRememberArgs({
          userMessageText,
          subjectRef: { kind: 'named', label: 'project-opaque' },
          subjectType: 'project',
          predicate: 'constraint',
          value: 'constraint-opaque',
          scope,
          operation: 'record',
          assertionClass: 'quoted',
        }),
        memoryRememberExecution({
          memoryConversationId: 'memory-tool-observed-scope',
          sourceThreadId: 'thread-tool-observed-scope',
          userMessageId,
          userMessageText,
          executionRunId,
          toolCallId: `tool-call-tool-observed-scope-${scope}`,
          toolObservedEvidence,
        }),
      );

      expect(result).toMatchObject({
        ok: true,
        fact: {
          scope: 'project',
          originConversationId: 'memory-tool-observed-scope',
        },
      });
    },
  );

  it('rejects request evidence changed after the opaque binding was created', () => {
    const context = execution();
    const input = args();
    const bound = bindMemoryRememberSemanticEvidence(
      input.semanticEvidence,
      context.requestEvidence,
    );
    expect(bound.valid).toBe(true);
    if (!bound.valid) throw new Error(bound.code);
    context.requestEvidence.userMessageText = `changed :: ${SUBJECT} :: ${VALUE}`;

    expect(() => persistMemoryRemember({ semanticEvidence: bound.evidence }, context)).toThrow(
      'memory_remember_bound_evidence_changed',
    );
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('grounds self facts from the exact value without requiring a language-specific self token', () => {
    const input = memoryRememberArgs({
      userMessageText: 'المنطقة الزمنية الحالية هي أفريقيا/القاهرة',
      subjectRef: { kind: 'self' },
      subjectType: 'self',
      predicate: 'timezone',
      value: 'أفريقيا/القاهرة',
    });
    const request = memoryRememberExecution({
      userMessageId: 'message-self-arabic',
      userMessageText: 'المنطقة الزمنية الحالية هي أفريقيا/القاهرة',
    }).requestEvidence;

    const bound = bindMemoryRememberSemanticEvidence(input.semanticEvidence, request);
    expect(bound.valid).toBe(true);
    if (!bound.valid) throw new Error(bound.code);
    expect(resolveBoundMemoryRememberSemanticEvidence(bound.evidence)?.evidenceSpan).toBe(
      'أفريقيا/القاهرة',
    );
  });

  it('keeps Unicode normalization code-owned and fails closed on a non-identical form', () => {
    const decomposed = 'Cafe\u0301';
    const input = args({ value: 'Café' });
    const result = executeMemoryRemember(
      input,
      execution({ userMessageText: `${SUBJECT} :: ${decomposed}` }),
    );
    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('returns the current-user grounding failure without falling back to tool evidence', () => {
    const input = memoryRememberArgs({
      userMessageText: 'My usual review duration is 45 minutes.',
      subjectRef: { kind: 'self' },
      subjectType: 'self',
      predicate: 'review_duration',
      value: 'Usually uses 45 minutes.',
      assertionClass: 'current_direct',
    });
    const result = executeMemoryRemember(
      input,
      memoryRememberExecution({
        userMessageId: 'message-current-direct-no-fallback',
        userMessageText: 'My usual review duration is 45 minutes.',
        executionRunId: 'execution-current-direct-no-fallback',
        toolCallId: 'tool-call-current-direct-no-fallback',
        toolObservedEvidence: bindReadFileEvidence({
          executionRunId: 'execution-current-direct-no-fallback',
          userMessageId: 'message-current-direct-no-fallback',
          userMessageText: 'My usual review duration is 45 minutes.',
          result: 'Usually uses 45 minutes.',
        }),
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'grounding_required',
      error: expect.stringContaining('smallest atomic exact substring'),
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('matches JSON Schema character limits for astral subject labels and values', () => {
    const subject = '😀'.repeat(80);
    const value = '🚀'.repeat(200);
    const userMessageText = `${subject}⇢${value}`;
    const input = memoryRememberArgs({
      userMessageText,
      subjectRef: { kind: 'named', label: subject },
      subjectType: 'thing',
      predicate: 'astral_limit',
      value,
    });
    const request = memoryRememberExecution({
      userMessageId: 'message-astral-limit',
      userMessageText,
    }).requestEvidence;

    const bound = bindMemoryRememberSemanticEvidence(input.semanticEvidence, request);
    expect(bound.valid).toBe(true);
    if (!bound.valid) throw new Error(bound.code);
    expect(resolveBoundMemoryRememberSemanticEvidence(bound.evidence)?.evidenceSpan).toBe(
      userMessageText,
    );

    const oversized = memoryRememberArgs({
      userMessageText: `${subject}😀⇢${value}`,
      subjectRef: { kind: 'named', label: `${subject}😀` },
      subjectType: 'thing',
      predicate: 'astral_limit',
      value,
    });
    expect(
      bindMemoryRememberSemanticEvidence(oversized.semanticEvidence, {
        ...request,
        userMessageText: `${subject}😀⇢${value}`,
      }),
    ).toEqual({ valid: false, code: 'invalid_contract' });
  });

  it('finds the nearest exact pair without retaining repeated occurrence arrays', () => {
    const repeated = '◇'.repeat(200_000);
    const subject = '★';
    const value = '◇';
    const userMessageText = `${repeated}|${subject}${value}`;
    const input = memoryRememberArgs({
      userMessageText,
      subjectRef: { kind: 'named', label: subject },
      subjectType: 'concept',
      predicate: 'opaque_relation',
      value,
    });
    const request = memoryRememberExecution({
      userMessageId: 'message-repeated-occurrences',
      userMessageText,
    }).requestEvidence;

    const bound = bindMemoryRememberSemanticEvidence(input.semanticEvidence, request);
    expect(bound.valid).toBe(true);
    if (!bound.valid) throw new Error(bound.code);
    expect(resolveBoundMemoryRememberSemanticEvidence(bound.evidence)?.evidenceSpan).toBe(
      `${subject}${value}`,
    );
  });

  it('rejects a minimal exact evidence span above the resource bound', () => {
    const userMessageText = `${SUBJECT}${'界'.repeat(600)}${VALUE}`;
    const result = executeMemoryRemember(args({ userMessageText }), execution({ userMessageText }));
    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it.each([
    'evidence_quote',
    'source_message_id',
    'subject_ref',
    'subject_type',
    'subject_quote',
    'predicate_quote',
    'value_quote',
  ] as const)('rejects removed semantic field %s without a compatibility fallback', (field) => {
    const input = args();
    (input.semanticEvidence as Record<string, unknown>)[field] = 'forged';
    expect(executeMemoryRemember(input, execution())).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it.each([1, 2, 3])(
    'rejects the v%s semantic contract without a compatibility fallback',
    (version) => {
      const input = args();
      (input.semanticEvidence as Record<string, unknown>).version = version;
      expect(executeMemoryRemember(input, execution())).toMatchObject({
        ok: false,
        code: 'invalid_args',
      });
      expect(listFacts({ includeInvalidated: true })).toEqual([]);
    },
  );

  it('keeps self and named subject typing inside one exact discriminated object', () => {
    const selfWithNamedType = memoryRememberArgs({
      userMessageText: 'My timezone is UTC+1.',
      subjectRef: { kind: 'self' },
      predicate: 'timezone',
      value: 'UTC+1',
    });
    (selfWithNamedType.semanticEvidence as { subject: Record<string, unknown> }).subject.type =
      'person';
    expect(
      executeMemoryRemember(
        selfWithNamedType,
        execution({
          userMessageId: 'message-self-type-mismatch',
          userMessageText: 'My timezone is UTC+1.',
        }),
      ),
    ).toMatchObject({ ok: false, code: 'invalid_args' });

    const namedWithoutType = args();
    delete (namedWithoutType.semanticEvidence as { subject: Record<string, unknown> }).subject.type;
    expect(executeMemoryRemember(namedWithoutType, execution())).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
  });

  it('rejects the removed legacy argument surface without compatibility fallback', () => {
    const result = executeMemoryRemember(
      {
        subject: SUBJECT,
        predicate: PREDICATE,
        value: VALUE,
        scope: 'conversation',
      } as never,
      execution(),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('derives scoped origins from code-owned request scope and rejects provider origin fields', () => {
    const forged = {
      ...args(),
      originConversationId: 'forged-root',
      originThreadId: 'forged-thread',
    } as never;
    expect(executeMemoryRemember(forged, execution())).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('validates declared record/replace semantics against current state', () => {
    expect(executeMemoryRemember(args(), execution())).toMatchObject({ ok: true });
    const nextMessage = `${SUBJECT} :: ${PREDICATE} :: 次の値`;
    const result = executeMemoryRemember(
      args({
        userMessageText: nextMessage,
        value: '次の値',
        operation: 'record',
      }),
      execution({
        userMessageId: 'message-operation-mismatch',
        userMessageText: nextMessage,
        executionRunId: 'execution-operation-mismatch',
        toolCallId: 'tool-operation-mismatch',
        claimedAt: 1_001,
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ predicate: PREDICATE })).toEqual([
      expect.objectContaining({ objectText: VALUE, invalidAt: null }),
    ]);
  });

  it('replays one code-owned execution identity idempotently and rejects changed payloads', () => {
    expect(executeMemoryRemember(args(), execution())).toMatchObject({ ok: true });
    expect(executeMemoryRemember(args(), execution())).toMatchObject({
      ok: true,
      status: 'duplicate',
    });
    const changedMessage = `${SUBJECT} :: ${PREDICATE} :: 改変値`;
    const changed = executeMemoryRemember(
      args({
        userMessageText: changedMessage,
        value: '改変値',
      }),
      execution({ userMessageText: changedMessage }),
    );
    expect(changed).toMatchObject({ ok: false, code: 'internal' });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      ),
    ).toEqual({ count: 1 });
  });
});
