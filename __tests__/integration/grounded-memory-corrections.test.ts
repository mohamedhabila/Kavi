jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { ConsolidatorAssertionClass } from '../../src/services/memory/consolidator';
import { findEntityByName, upsertEntity } from '../../src/services/memory/entities';
import { listFactEvidence } from '../../src/services/memory/episodes/queries';
import { recordFact, recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { executeMemoryRemember } from '../../src/services/memory/memoryTools';
import { processIngestionTurn } from '../../src/services/memory/turnProcessor';
import type { Message } from '../../src/types/message';
import { memoryRememberArgs, memoryRememberExecution } from '../helpers/memoryRememberExecution';

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
    ...(scope === 'conversation'
      ? {
          originConversationId: 'conversation-1',
          originThreadId: 'thread-1',
        }
      : {}),
    now: 100,
  }).fact;
}

function seedGroundedCurrent(predicate: string, value: string, sourceMessageId: string) {
  const user = upsertEntity({ name: 'user', type: 'self', now: 10 });
  return recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate,
      objectText: value,
      scope: 'global',
      sourceMessageId,
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

function messages(
  userContent: string,
  enrichedContent?: string,
  priorMessages: Message[] = [],
): Message[] {
  return [
    ...priorMessages,
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
  scope?: 'global' | 'conversation' | 'project' | 'session';
  operation?: 'record' | 'replace_current';
  assertionClass?: ConsolidatorAssertionClass;
  sourceMessageId?: string;
  enrichedContent?: string;
  priorMessages?: Message[];
}) {
  const turnMessages = messages(input.userContent, input.enrichedContent, input.priorMessages);
  return processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId: 'thread-1',
    memoryConversationId: 'conversation-1',
    messages: turnMessages,
    sourceEndMessageId: 'assistant-current',
    extractor: async () =>
      JSON.stringify({
        new_facts: [
          {
            version: 1,
            subject_ref: { kind: 'self' },
            predicate: input.predicate,
            value: input.value,
            scope: input.scope ?? 'global',
            importance: 0.8,
            confidence: 0.95,
            source_message_id: input.sourceMessageId ?? 'user-current',
            operation: input.operation ?? 'replace_current',
            assertion_class: input.assertionClass ?? 'current_direct',
            evidence_quote: input.quote ?? input.userContent,
            sensitivity: 'personal',
          },
        ],
        episode_sensitivity: 'normal',
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    now: 300,
  });
}

describe('grounded passive memory corrections', () => {
  const priorTurn = (id = 'user-prior'): Message[] => [
    { id, role: 'user', content: 'Prior user statement.', timestamp: 100 },
    {
      id: `${id}-assistant`,
      role: 'assistant',
      content: 'Understood.',
      timestamp: 110,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];

  it.each([
    {
      language: 'English',
      predicate: 'residence',
      oldValue: 'Amsterdam',
      message: 'I live in Utrecht.',
      value: 'Utrecht',
    },
    {
      language: 'Dutch',
      predicate: 'residence',
      oldValue: 'Amsterdam',
      message: 'Ik woon in Utrecht.',
      value: 'Utrecht',
    },
    {
      language: 'Spanish',
      predicate: 'residence',
      oldValue: 'Barcelona',
      message: 'Yo vivo en Madrid.',
      value: 'Madrid',
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
      expect.objectContaining({
        messageId: 'user-current',
        quote: fixture.message,
      }),
    ]);
  });

  it('does not let passive enrichment create a second semantic writer for an explicit source', async () => {
    const userContent = 'I usually keep design-review meetings to 30 minutes.';
    const explicitWrite = executeMemoryRemember(
      memoryRememberArgs({
        userMessageText: userContent,
        subjectRef: { kind: 'self' },
        predicate: 'design-review meeting duration',
        value: '30 minutes',
        scope: 'persona',
      }),
      memoryRememberExecution({
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        taskId: 'explicit-memory-task',
        userMessageId: 'user-current',
        userMessageText: userContent,
        executionRunId: 'explicit-memory-run',
        toolCallId: 'explicit-memory-call',
        claimedAt: 200,
        personaId: 'default',
      }),
    );
    expect(explicitWrite).toMatchObject({ ok: true, status: 'created' });

    const result = await ingest({
      userContent,
      predicate: 'keeps',
      value: 'design-review meetings to 30 minutes',
      quote: userContent,
      scope: 'global',
      operation: 'record',
    });

    expect(result.providerFactIds).toEqual([]);
    expect(
      listFacts({ includeInvalidated: true }).filter((fact) => fact.memoryKind === 'semantic_fact'),
    ).toEqual([
      expect.objectContaining({
        predicate: 'design-review meeting duration',
        objectText: '30 minutes',
        scope: 'persona',
        personaId: 'default',
      }),
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
      operation: 'record',
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

    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in', scope: 'global' })).toEqual(
      [expect.objectContaining({ objectText: 'Utrecht' })],
    );
  });

  it('rejects a contradictory provider replacement group without order dependence', async () => {
    const old = seedCurrent('lives_in', 'Amsterdam');
    const turnMessages = messages('I am considering Utrecht or Paris.');

    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'thread-1',
      memoryConversationId: 'conversation-1',
      messages: turnMessages,
      sourceEndMessageId: 'assistant-current',
      extractor: async () =>
        JSON.stringify({
          new_facts: ['Utrecht', 'Paris'].map((value) => ({
            version: 1,
            subject_ref: { kind: 'self' },
            predicate: 'lives_in',
            value,
            scope: 'global',
            importance: 0.8,
            confidence: 0.95,
            source_message_id: 'user-current',
            operation: 'replace_current',
            assertion_class: 'current_direct',
            evidence_quote: 'I am considering Utrecht or Paris.',
            sensitivity: 'personal',
          })),
          episode_sensitivity: 'normal',
          episode_summary: null,
          active_focus: null,
          open_threads: [],
          notable: [],
        }),
      now: 300,
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
      now: 100,
    }).fact;

    await ingest({
      userContent: 'Call me Mohamed.',
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
      sourceMessageId: 'assistant-current',
    });
    expect(listFacts({ subjectId: old.subjectId, predicate: 'lives_in' })).toEqual([
      expect.objectContaining({ id: old.id }),
    ]);
  });

  it('stores a grounded no-target insert without replacement authority', async () => {
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      operation: 'record',
    });

    const user = upsertEntity({ name: 'user', type: 'self', now: 400 });
    const current = listFacts({ subjectId: user.id, predicate: 'lives_in' });
    expect(current).toHaveLength(1);
    expect(current[0].objectText).toBe('Utrecht');
    expect(current[0].attributes).toMatchObject({
      memoryWrite: {
        operation: 'insert',
        authority: 'grounded_user_statement',
        evidenceMessageId: 'user-current',
      },
    });
    expect(current[0].attributes.memoryWrite).not.toHaveProperty('expectedCurrentFactId');
  });

  it('does not guess a persisted predicate from different provider semantics', async () => {
    const old = seedGroundedCurrent('usual_design_review_duration', '30 minutes', 'user-prior');

    const result = await ingest({
      userContent:
        'Actually, make my usual design-review length 45 minutes from now on, not 30 minutes.',
      predicate: 'design_review_default_duration_minutes',
      value: '45 minutes',
      priorMessages: priorTurn(),
    });

    expect(result.invalidatedFactIds).toEqual([]);
    expect(listFacts({ subjectId: old.subjectId, predicate: old.predicate })).toEqual([
      expect.objectContaining({ id: old.id, objectText: '30 minutes', invalidAt: null }),
    ]);
    expect(listFacts({ predicate: 'design_review_default_duration_minutes' })).toEqual([]);
  });

  it('does not guess a correction target from an older user message', async () => {
    const old = seedGroundedCurrent('usual_design_review_duration', '30 minutes', 'user-older');

    await ingest({
      userContent:
        'Actually, make my usual design-review length 45 minutes from now on, not 30 minutes.',
      predicate: 'design_review_default_duration_minutes',
      value: '45 minutes',
      priorMessages: priorTurn('user-immediate'),
    });

    expect(listFacts({ subjectId: old.subjectId, predicate: old.predicate })).toEqual([
      expect.objectContaining({ id: old.id, objectText: '30 minutes', invalidAt: null }),
    ]);
    expect(listFacts({ predicate: 'design_review_default_duration_minutes' })).toEqual([]);
  });

  it('rejects an ambiguous cross-predicate correction instead of choosing by order', async () => {
    const first = seedGroundedCurrent('planning_review_duration', '25 minutes', 'user-prior');
    const second = seedGroundedCurrent('retrospective_review_duration', '25 minutes', 'user-prior');

    await ingest({
      userContent:
        'Actually, make my usual review duration 35 minutes from now on, not 25 minutes.',
      predicate: 'review_default_minutes',
      value: '35 minutes',
      priorMessages: priorTurn(),
    });

    expect(listFacts({ subjectId: first.subjectId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, invalidAt: null }),
        expect.objectContaining({ id: second.id, invalidAt: null }),
      ]),
    );
    expect(listFacts({ predicate: 'review_default_minutes' })).toEqual([]);
  });

  it.each([
    'If I changed my usual design-review length to 45 minutes, not 30 minutes, I would leave earlier.',
    'Alex said make my usual design-review length 45 minutes from now on, not 30 minutes.',
    'The note says “make my usual design-review length 45 minutes from now on, not 30 minutes.”',
    'Should I make my usual design-review length 45 minutes from now on, not 30 minutes?',
  ])('rejects unsafe direct correction evidence: %s', async (userContent) => {
    const old = seedGroundedCurrent('usual_design_review_duration', '30 minutes', 'user-prior');

    await ingest({
      userContent,
      predicate: 'design_review_default_duration_minutes',
      value: '45 minutes',
      priorMessages: priorTurn(),
    });

    expect(listFacts({ subjectId: old.subjectId, predicate: old.predicate })).toEqual([
      expect.objectContaining({ id: old.id, invalidAt: null }),
    ]);
    expect(listFacts({ predicate: 'design_review_default_duration_minutes' })).toEqual([]);
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
    { sourceMessageId: 'assistant-current', label: 'wrong provider source message' },
    { quote: 'I moved to Paris.', label: 'provider quote absent from user text' },
  ])('rejects a no-target proposal with a $label', async (overrides) => {
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Utrecht',
      quote: overrides.quote,
      sourceMessageId: overrides.sourceMessageId,
    });
    expect(listFacts({ predicate: 'lives_in' })).toEqual([]);
  });

  it('rejects a no-target proposal whose value is absent from user evidence', async () => {
    await ingest({
      userContent: 'I moved to Utrecht.',
      predicate: 'lives_in',
      value: 'Paris',
    });
    expect(findEntityByName('user')).toBeNull();
  });
});
