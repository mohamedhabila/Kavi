import { upsertEntity } from '../../services/memory/entities';
import { listFacts } from '../../services/memory/facts/queries';
import { processIngestionTurn } from '../../services/memory/turnProcessor';
import type { Message } from '../../types/message';
import type { AcceptanceFixtureOutcome } from './types';
import type { MemoryCorrectionFixture } from './memoryCorrectionFixtures';
import {
  ACCEPTANCE_FACT_PRODUCER_IDS,
  recordAcceptanceFixtureFact,
} from '../acceptanceFactContributions';

export async function evaluateMemoryCorrectionFixture(
  fixture: MemoryCorrectionFixture,
  now: number,
): Promise<AcceptanceFixtureOutcome> {
  const threadId = `synthetic-${fixture.id}`;
  const userMessageId = `user-${fixture.id}`;
  const user = upsertEntity({ name: 'user', type: 'self', now: now - 20 });
  const previous = recordAcceptanceFixtureFact(
    {
      subjectId: user.id,
      predicate: fixture.predicate,
      objectText: fixture.previousValue,
      scope: 'global',
      now: now - 10,
    },
    { factClass: 'unknown', sourceAuthority: 'unknown' },
    {
      producerId: ACCEPTANCE_FACT_PRODUCER_IDS.memoryCorrection,
      fixtureId: fixture.id,
      eventKey: 'previous-value',
      memoryConversationId: threadId,
      sourceThreadId: threadId,
      taskId: null,
      sourceKind: 'message',
      sourceId: `seed-${fixture.id}`,
    },
  ).fact;
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
    sourceEndMessageId: `assistant-${fixture.id}`,
    extractor: async () =>
      JSON.stringify({
        new_facts: [
          {
            version: 1,
            subject_ref: { kind: 'self' },
            predicate: fixture.predicate,
            value: fixture.proposedValue,
            scope: 'global',
            importance: 0.8,
            confidence: 0.95,
            source_message_id: userMessageId,
            operation: 'replace_current',
            assertion_class: fixture.assertionClass,
            evidence_quote: fixture.userMessage,
            sensitivity: 'personal',
          },
        ],
        episode_sensitivity: 'personal',
        episode_summary: null,
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    now: now + 2,
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
