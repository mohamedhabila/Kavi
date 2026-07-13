import { recordFactWithContribution } from '../../src/services/memory/facts/mutations';

export function recordContributedSchemaFact(subjectId: string) {
  return recordFactWithContribution(
    {
      subjectId,
      predicate: 'prefers_tone',
      objectText: 'brief',
      scope: 'global',
      sourceMessageId: 'u-1',
      sourceTurnId: 'a-1',
      now: 2,
    },
    { factClass: 'unknown', sourceAuthority: 'unknown' },
    {
      memoryConversationId: 'conv-schema',
      sourceThreadId: 'thread-schema',
      taskId: null,
      producer: { producerId: 'schema_test', producerEventId: 'schema-event' },
      sourceAliases: [
        { sourceKind: 'message', sourceId: 'u-1' },
        { sourceKind: 'turn', sourceId: 'a-1' },
      ],
    },
  );
}
