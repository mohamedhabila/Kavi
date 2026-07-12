import { upsertEntity } from '../../services/memory/entities';
import { recordFact } from '../../services/memory/facts/mutations';
import { listFacts } from '../../services/memory/facts/queries';
import { processIngestionTurn } from '../../services/memory/turnProcessor';
import type { Message } from '../../types/message';
import type { AcceptanceFixtureOutcome } from './types';
import type { MemoryCorrectionFixture } from './memoryCorrectionFixtures';

export async function evaluateMemoryCorrectionFixture(
  fixture: MemoryCorrectionFixture,
  now: number,
): Promise<AcceptanceFixtureOutcome> {
  const threadId = `synthetic-${fixture.id}`;
  const userMessageId = `user-${fixture.id}`;
  const user = upsertEntity({ name: 'user', type: 'self', now: now - 20 });
  const previous = recordFact({
    subjectId: user.id,
    predicate: fixture.predicate,
    objectText: fixture.previousValue,
    scope: 'global',
    sourceMessageId: `seed-${fixture.id}`,
    now: now - 10,
  }).fact;
  const messages: Message[] = [
    { id: userMessageId, role: 'user', content: fixture.userMessage, timestamp: now },
    {
      id: `assistant-${fixture.id}`,
      role: 'assistant',
      content: 'Acknowledged.',
      timestamp: now + 1,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];

  await processIngestionTurn({
    threadId,
    memoryConversationId: threadId,
    messages,
    extractor: async () =>
      JSON.stringify({
        new_facts: [
          {
            subject: 'user',
            predicate: fixture.predicate,
            value: fixture.proposedValue,
            scope: 'global',
            operation: 'replace_current',
            assertion_class: fixture.assertionClass,
            evidence_message_ids: [userMessageId],
            evidence_quote: fixture.userMessage,
          },
        ],
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    now: now + 2,
    skipWorkingMemorySync: true,
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
  });

  const current = listFacts({ subjectId: user.id, predicate: fixture.predicate });
  const history = listFacts({
    subjectId: user.id,
    predicate: fixture.predicate,
    includeInvalidated: true,
  });
  const expectedCurrent = fixture.shouldReplace ? fixture.proposedValue : fixture.previousValue;
  const passed =
    current.length === 1 &&
    current[0]?.objectText === expectedCurrent &&
    (fixture.shouldReplace
      ? history.length === 2 &&
        history.find((fact) => fact.id === previous.id)?.invalidAt === now + 2
      : history.length === 1 && history[0]?.id === previous.id);

  return {
    fixtureId: fixture.id,
    passed,
    detail: passed
      ? `current=${expectedCurrent}; history=${history.length}`
      : `expected current=${expectedCurrent}; actual=${current.map((fact) => fact.objectText).join(',')}; history=${history.length}`,
  };
}
