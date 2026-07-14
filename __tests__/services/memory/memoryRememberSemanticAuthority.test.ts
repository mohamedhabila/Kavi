jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { findEntityByName } from '../../../src/services/memory/entities';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

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
      'evidence quote',
      (input: ReturnType<typeof args>) => {
        (input.semanticEvidence as Record<string, unknown>).evidence_quote = `${MESSAGE}!`;
      },
    ],
    [
      'value',
      (input: ReturnType<typeof args>) => {
        (input.semanticEvidence as Record<string, unknown>).value = '不存在_value';
      },
    ],
    [
      'named subject',
      (input: ReturnType<typeof args>) => {
        (input.semanticEvidence as Record<string, unknown>).subject_ref = {
          kind: 'named',
          label: '不存在_subject',
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

  it.each(['source_message_id', 'subject_quote', 'predicate_quote', 'value_quote'] as const)(
    'rejects removed semantic field %s without a compatibility fallback',
    (field) => {
      const input = args();
      (input.semanticEvidence as Record<string, unknown>)[field] = 'forged';
      expect(executeMemoryRemember(input, execution())).toMatchObject({
        ok: false,
        code: 'invalid_args',
      });
      expect(listFacts({ includeInvalidated: true })).toEqual([]);
    },
  );

  it('rejects the v1 semantic contract without a compatibility fallback', () => {
    const input = args();
    (input.semanticEvidence as Record<string, unknown>).version = 1;
    expect(executeMemoryRemember(input, execution())).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
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
        userMessageId: 'message-operation-mismatch',
        userMessageText: nextMessage,
        value: '次の値',
        evidenceQuote: nextMessage,
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
        evidenceQuote: changedMessage,
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
