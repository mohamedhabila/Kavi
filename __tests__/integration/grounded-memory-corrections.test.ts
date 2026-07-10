jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { ConsolidatorAssertionClass } from '../../src/services/memory/consolidator';
import { findEntityByName, upsertEntity } from '../../src/services/memory/entities';
import { listFactEvidence } from '../../src/services/memory/episodes/queries';
import { recordFact } from '../../src/services/memory/facts/mutations';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { processIngestionTurn } from '../../src/services/memory/turnProcessor';
import type { Message } from '../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function seedCurrent(
  predicate: string,
  value: string,
  scope: 'global' | 'conversation' = 'global',
) {
  const user = upsertEntity({ name: 'user', type: 'self', now: 10 });
  return recordFact({
    subjectId: user.id,
    predicate,
    objectText: value,
    scope,
    originConversationId: 'conversation-1',
    originThreadId: 'thread-1',
    now: 100,
  }).fact;
}

function messages(userContent: string, enrichedContent?: string): Message[] {
  return [
    {
      id: 'user-current',
      role: 'user',
      content: userContent,
      ...(enrichedContent ? { enrichedContent } : {}),
      timestamp: 200,
    },
    {
      id: 'assistant-current',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 210,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

async function ingest(input: {
  userContent: string;
  predicate: string;
  value: string;
  quote?: string;
  scope?: 'global' | 'conversation' | 'project' | 'persona';
  operation?: 'insert' | 'replace_current';
  assertionClass?: ConsolidatorAssertionClass;
  evidenceMessageIds?: string[];
  enrichedContent?: string;
}) {
  const turnMessages = messages(input.userContent, input.enrichedContent);
  return processIngestionTurn({
    threadId: 'thread-1',
    memoryConversationId: 'conversation-1',
    messages: turnMessages,
    extractor: async () =>
      JSON.stringify({
        new_facts: [
          {
            subject: 'user',
            predicate: input.predicate,
            value: input.value,
            scope: input.scope ?? 'global',
            operation: input.operation ?? 'replace_current',
            assertion_class: input.assertionClass ?? 'current_direct',
            evidence_message_ids: input.evidenceMessageIds ?? ['user-current'],
            evidence_quote: input.quote ?? input.userContent,
          },
        ],
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    now: 300,
    skipWorkingMemorySync: true,
  });
}

describe('grounded passive memory corrections', () => {
  it.each([
    {
      language: 'English',
      predicate: 'lives_in',
      oldValue: 'Amsterdam',
      message: 'I moved to Utrecht last week.',
      value: 'Utrecht',
    },
    {
      language: 'Dutch',
      predicate: 'preferred_name',
      oldValue: 'Mohamed',
      message: 'Noem me voortaan Sam',
      value: 'Sam',
    },
    {
      language: 'Arabic',
      predicate: 'preferred_contact',
      oldValue: 'البريد الإلكتروني',
      message: 'أفضل التواصل عبر سيجنال الآن',
      value: 'سيجنال',
    },
  ])('versions a direct current fact in $language', async (fixture) => {
    const old = seedCurrent(fixture.predicate, fixture.oldValue);

    const result = await ingest({
      userContent: fixture.message,
      predicate: fixture.predicate,
      value: fixture.value,
    });

    expect(result.invalidatedFactIds).toEqual([old.id]);
    const user = upsertEntity({ name: 'user', type: 'self', now: 400 });
    const current = listFacts({ subjectId: user.id, predicate: fixture.predicate });
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      objectText: fixture.value,
      sourceMessageId: 'user-current',
      attributes: {
        memoryWrite: {
          operation: 'replace_current',
          authority: 'grounded_user_statement',
          evidenceMessageId: 'user-current',
          expectedCurrentFactId: old.id,
          assertionClass: 'current_direct',
          evidenceQuote: fixture.message,
        },
      },
    });
    expect(listFacts({ subjectId: user.id, predicate: fixture.predicate, asOf: 150 })).toEqual([
      expect.objectContaining({ id: old.id, objectText: fixture.oldValue }),
    ]);
    expect(listFactEvidence(current[0]!.id)).toEqual([
      expect.objectContaining({ messageId: 'user-current', quote: fixture.message }),
    ]);
  });

  it.each([
    ['historical', 'I lived in Utrecht in 2019.'],
    ['hypothetical', 'If I moved to Utrecht, I would cycle more.'],
    ['quoted', 'The note says “I moved to Utrecht.”'],
    ['third_party', 'Alex said, “I moved to Utrecht.”'],
    ['uncertain', 'Did I move to Utrecht?'],
  ] as const)('does not replace current state for a %s assertion', async (assertionClass, text) => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    await ingest({
      userContent: text,
      predicate: 'lives_in',
      value: 'Utrecht',
      assertionClass,
    });

    const current = listFacts({ subjectId: old.subjectId, predicate: 'lives_in' });
    expect(current).toEqual([expect.objectContaining({ id: old.id, objectText: 'Amsterdam' })]);
  });

  it('does not let an ordinary provider insert overwrite a current key', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      operation: 'insert',
    });
    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id }),
    ]);
  });

  it('does not promote an incompatible conversation fact into global memory', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam', 'conversation');
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      scope: 'global',
    });
    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id, scope: 'conversation' }),
    ]);
  });

  it('finds an exact global target despite many newer incompatible facts', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    for (let index = 0; index < 20; index += 1) {
      recordFact({
        subjectId: old.subjectId,
        predicate: 'lives_in',
        objectText: `Temporary place ${index}`,
        scope: 'conversation',
        originConversationId: `other-conversation-${index}`,
        originThreadId: `other-thread-${index}`,
        now: 200 + index,
      });
    }

    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      scope: 'global',
    });

    expect(
      listFacts({ subjectId: old.subjectId, predicate: 'lives_in', scope: 'global' }),
    ).toEqual([expect.objectContaining({ objectText: 'Utrecht' })]);
  });

  it('rejects a contradictory provider replacement group without order dependence', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    const turnMessages = messages('I am considering Utrecht or Paris.');

    await processIngestionTurn({
      threadId: 'thread-1',
      memoryConversationId: 'conversation-1',
      messages: turnMessages,
      extractor: async () =>
        JSON.stringify({
          new_facts: ['Utrecht', 'Paris'].map((value) => ({
            subject: 'user',
            predicate: 'lives_in',
            value,
            scope: 'global',
            operation: 'replace_current',
            assertion_class: 'current_direct',
            evidence_message_ids: ['user-current'],
            evidence_quote: 'I am considering Utrecht or Paris.',
          })),
          episode_summary: null,
          active_focus: null,
          open_threads: [],
          notable: [],
        }),
      now: 300,
      skipWorkingMemorySync: true,
    });

    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id, objectText: 'Amsterdam' }),
    ]);
  });

  it('updates conversation memory after the app changes thread and task', async () => {
    const user = upsertEntity({ name: 'user', type: 'self', now: 10 });
    const old = recordFact({
      subjectId: user.id,
      predicate: 'preferred_name',
      objectText: 'Mo',
      scope: 'conversation',
      originConversationId: 'conversation-1',
      originThreadId: 'older-thread',
      originTaskId: 'older-task',
      now: 100,
    }).fact;

    await ingest({
      userContent: 'Call me Mohamed now.',
      predicate: 'preferred_name',
      value: 'Mohamed',
      scope: 'conversation',
    });

    expect(listFacts({ subjectId: user.id, predicate: 'preferred_name' })).toEqual([
      expect.objectContaining({ objectText: 'Mohamed' }),
    ]);
    expect(listFacts({ subjectId: user.id, predicate: 'preferred_name', asOf: 150 })).toEqual([
      expect.objectContaining({ id: old.id, objectText: 'Mo' }),
    ]);
  });

  it('rejects evidence that appears only in enriched, assistant, or tool-visible text', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    await ingest({
      userContent: 'Please continue.',
      enrichedContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      quote: 'I moved to Utrecht.',
    });
    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id }),
    ]);
  });

  it('requires the exact current user evidence id and grounded value', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Paris',
      evidenceMessageIds: ['assistant-current'],
    });
    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id }),
    ]);
  });

  it('stores a no-target proposal as an ordinary fact without replacement authority', async () => {
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
    });

    const user = upsertEntity({ name: 'user', type: 'self', now: 400 });
    const current = listFacts({ subjectId: user.id, predicate: 'lives_in' });
    expect(current).toHaveLength(1);
    expect(current[0].objectText).toBe('Utrecht');
    expect(current[0].attributes).not.toHaveProperty('memoryWrite');
  });

  it.each(['historical', 'hypothetical', 'quoted', 'third_party', 'uncertain'] as const)(
    'rejects a no-target %s replacement proposal',
    async (assertionClass) => {
      await ingest({
        userContent: 'If I moved to Utrecht, I would cycle more.',
        predicate: 'lives_in',
        value: 'Utrecht',
        assertionClass,
      });
      expect(findEntityByName('user')).toBeNull();
    },
  );

  it.each([
    { evidenceMessageIds: ['assistant-current'], label: 'wrong source message' },
    { quote: 'I moved to Paris.', label: 'quote absent from user text' },
    { value: 'Paris', label: 'value absent from grounded quote' },
  ])('rejects a no-target proposal with $label', async (overrides) => {
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: overrides.value ?? 'Utrecht',
      quote: overrides.quote,
      evidenceMessageIds: overrides.evidenceMessageIds,
    });
    expect(findEntityByName('user')).toBeNull();
  });
});
