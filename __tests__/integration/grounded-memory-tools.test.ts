jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/remote/approvalStore', () => {
  const actual = jest.requireActual('../../src/services/remote/approvalStore');
  return {
    ...actual,
    requestToolApproval: jest.fn(async () => 'approved'),
  };
});

import { executeTool } from '../../src/engine/tools';
import { findEntityByName } from '../../src/services/memory/entities';
import { listFactEvidence } from '../../src/services/memory/episodes/queries';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
  useChatStore.setState({ conversations: [] } as never);
});

afterEach(() => {
  closeMemoryDb();
  useChatStore.setState({ conversations: [] } as never);
});

async function remember(input: {
  subject: string;
  predicate: string;
  value: string;
  messageId: string;
  messageText: string;
  subjectType?: 'self' | 'person' | 'project' | 'concept' | 'system';
  scope?: 'global' | 'conversation';
  threadId?: string;
  memoryConversationId?: string;
  extraArgs?: Record<string, unknown>;
}) {
  const threadId = input.threadId ?? 'thread-a';
  const memoryConversationId = input.memoryConversationId ?? 'memory-root-a';
  return JSON.parse(
    await executeTool(
      'memory_remember',
      JSON.stringify({
        subject: input.subject,
        ...(input.subjectType ? { subjectType: input.subjectType } : {}),
        predicate: input.predicate,
        value: input.value,
        scope: input.scope ?? 'conversation',
        ...input.extraArgs,
      }),
      threadId,
      {
        memoryConversationId,
        currentUserMessage: { id: input.messageId, text: input.messageText },
      },
    ),
  ) as Record<string, any>;
}

async function recall(input: {
  subject: string;
  predicate: string;
  threadId?: string;
  memoryConversationId?: string;
}) {
  return JSON.parse(
    await executeTool(
      'memory_recall',
      JSON.stringify({ subject: input.subject, predicate: input.predicate }),
      input.threadId ?? 'thread-a',
      { memoryConversationId: input.memoryConversationId ?? 'memory-root-a' },
    ),
  ) as Record<string, any>;
}

describe('grounded memory_remember product writes', () => {
  it.each([
    {
      label: 'opaque identifier',
      subject: 'ZX-Δ-47',
      predicate: 'launch_code',
      value: 'QZ-904',
      message: 'Remember ZX-Δ-47 launch_code is QZ-904.',
    },
    {
      label: 'Arabic',
      subject: 'مشروع-زيتا',
      predicate: 'قناة_التواصل',
      value: 'سيجنال',
      message: 'تذكر أن مشروع-زيتا يستخدم سيجنال.',
    },
  ])('makes a directly stated $label concept fact recallable', async (fixture) => {
    const messageId = `user-${fixture.label.replace(/\s+/g, '-')}`;
    const written = await remember({
      ...fixture,
      messageId,
      messageText: fixture.message,
    });

    expect(written).toMatchObject({ ok: true, status: 'created' });
    const stored = listFacts({ predicate: fixture.predicate });
    expect(stored).toEqual([
      expect.objectContaining({
        id: written.fact.id,
        objectText: fixture.value,
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        sourceMessageId: messageId,
      }),
    ]);
    const recalled = await recall({ subject: fixture.subject, predicate: fixture.predicate });
    expect(recalled.facts).toEqual([
      expect.objectContaining({ value: fixture.value, policy: { action: 'use', reason: 'eligible' } }),
    ]);
  });

  it('grounds value containment with NFKC and whitespace normalization', async () => {
    const written = await remember({
      subject: 'Project-Café',
      predicate: 'release_label',
      value: 'Café 42',
      messageId: 'user-unicode',
      messageText: 'Project-Café release label is Cafe\u0301\t42.',
    });

    expect(written).toMatchObject({ ok: true, fact: { value: 'Café 42' } });
    expect((await recall({ subject: 'Project-Café', predicate: 'release_label' })).facts).toHaveLength(
      1,
    );
  });

  it('versions one exact current fact and preserves its historical row', async () => {
    const first = await remember({
      subject: 'ORBIT-9',
      predicate: 'launch_code',
      value: 'QZ-904',
      messageId: 'user-first',
      messageText: 'ORBIT-9 launch_code is QZ-904.',
    });
    const second = await remember({
      subject: 'ORBIT-9',
      predicate: 'launch_code',
      value: 'QZ-905',
      messageId: 'user-second',
      messageText: 'Correction: ORBIT-9 launch_code is QZ-905.',
    });

    expect(second).toMatchObject({
      ok: true,
      superseded: [expect.objectContaining({ id: first.fact.id, value: 'QZ-904' })],
    });
    expect(listFacts({ predicate: 'launch_code' })).toEqual([
      expect.objectContaining({ id: second.fact.id, objectText: 'QZ-905' }),
    ]);
    expect(listFacts({ predicate: 'launch_code', includeInvalidated: true })).toHaveLength(2);
    expect(listFactEvidence(second.fact.id)).toEqual([
      expect.objectContaining({ messageId: 'user-second', role: 'user', quote: 'QZ-905' }),
    ]);
  });

  it('rejects a wrong-person duplicate instead of reporting false success', async () => {
    const first = await remember({
      subject: 'Avery',
      subjectType: 'person',
      predicate: 'preferred_channel',
      value: 'Signal',
      messageId: 'user-avery',
      messageText: 'Avery prefers Signal.',
    });
    const hostile = await remember({
      subject: 'Avery',
      subjectType: 'person',
      predicate: 'preferred_channel',
      value: 'Signal',
      messageId: 'user-morgan',
      messageText: 'Morgan prefers Signal.',
    });

    expect(hostile).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ predicate: 'preferred_channel' })).toEqual([
      expect.objectContaining({ id: first.fact.id, objectText: 'Signal' }),
    ]);
    expect(listFactEvidence(first.fact.id)).toHaveLength(1);
  });

  it.each([
    {
      label: 'wrong subject',
      subject: 'Avery',
      subjectType: 'person' as const,
      value: 'Signal',
      text: 'Morgan prefers Signal.',
    },
    {
      label: 'prior-turn-only subject and value',
      subject: 'ORBIT-9',
      subjectType: 'concept' as const,
      value: 'QZ-904',
      text: 'Please remember that.',
    },
    {
      label: 'spoofed self classification',
      subject: 'Avery',
      subjectType: 'self' as const,
      value: 'Signal',
      text: 'Morgan prefers Signal.',
    },
    {
      label: 'case-variant self label',
      subject: 'USER',
      subjectType: 'self' as const,
      value: 'Signal',
      text: 'Morgan prefers Signal.',
    },
    {
      label: 'subject embedded in another label',
      subject: 'Avery',
      subjectType: 'person' as const,
      value: 'Signal',
      text: 'Averyson prefers Signal.',
    },
  ])('rejects $label without creating an actionable candidate', async (fixture) => {
    const result = await remember({
      subject: fixture.subject,
      subjectType: fixture.subjectType,
      predicate: 'preferred_channel',
      value: fixture.value,
      messageId: `user-${fixture.label.replace(/\s+/g, '-')}`,
      messageText: fixture.text,
    });

    expect(result).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ predicate: 'preferred_channel' })).toEqual([]);
    expect(await recall({ subject: fixture.subject, predicate: 'preferred_channel' })).toMatchObject({
      ok: true,
      facts: [],
    });
    if (
      fixture.label === 'spoofed self classification' ||
      fixture.label === 'case-variant self label'
    ) {
      expect(findEntityByName(fixture.subject)).toBeNull();
    }
  });

  it('does not let provider provenance fields replace code-owned request evidence', async () => {
    const written = await remember({
      subject: 'ORBIT-10',
      predicate: 'launch_code',
      value: 'REAL-10',
      messageId: 'user-real',
      messageText: 'ORBIT-10 launch_code is REAL-10.',
      extraArgs: {
        sourceMessageId: 'provider-message',
        originConversationId: 'provider-root',
        originThreadId: 'provider-thread',
        sourceRunId: 'provider-run',
      },
    });
    const fact = listFacts({ predicate: 'launch_code' })[0]!;

    expect(written.ok).toBe(true);
    expect(fact).toMatchObject({
      sourceMessageId: 'user-real',
      sourceRunId: null,
      originConversationId: 'memory-root-a',
      originThreadId: 'thread-a',
    });
  });

  it('keeps conversation roots isolated during recall and correction', async () => {
    const first = await remember({
      subject: 'ROOT-BOUND',
      predicate: 'token',
      value: 'A-1',
      messageId: 'user-root-a',
      messageText: 'ROOT-BOUND token is A-1.',
      memoryConversationId: 'memory-root-a',
    });
    const crossRoot = await remember({
      subject: 'ROOT-BOUND',
      predicate: 'token',
      value: 'B-1',
      messageId: 'user-root-b',
      messageText: 'ROOT-BOUND token is B-1.',
      threadId: 'thread-b',
      memoryConversationId: 'memory-root-b',
    });

    expect(crossRoot).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(
      await recall({
        subject: 'ROOT-BOUND',
        predicate: 'token',
        threadId: 'thread-b',
        memoryConversationId: 'memory-root-b',
      }),
    ).toMatchObject({ ok: true, facts: [] });
    expect(listFacts({ predicate: 'token' })).toEqual([
      expect.objectContaining({ id: first.fact.id, objectText: 'A-1' }),
    ]);
  });

  it('stores a bounded exact value quote instead of duplicating a long user turn', async () => {
    const longPrefix = 'context '.repeat(1_000);
    const written = await remember({
      subject: 'BOUND-7',
      predicate: 'release_code',
      value: 'REL-777',
      messageId: 'user-long',
      messageText: `${longPrefix} BOUND-7 release_code is REL-777.`,
    });
    const fact = listFacts({ predicate: 'release_code' })[0]!;
    const evidence = listFactEvidence(fact.id)[0]!;

    expect(written.ok).toBe(true);
    expect(evidence.quote).toBe('REL-777');
    expect(JSON.stringify(fact.attributes)).not.toContain(longPrefix.trim());
    expect(JSON.stringify(fact.attributes).length).toBeLessThan(500);
  });
});
