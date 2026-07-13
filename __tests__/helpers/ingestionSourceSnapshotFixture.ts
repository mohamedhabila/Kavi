import {
  encodeIngestionSourceSnapshot,
  type EncodedIngestionSourceSnapshot,
} from '../../src/services/memory/ingestionSourceSnapshot';
import type { Message } from '../../src/types/message';

export interface IngestionSourceSnapshotFixtureIdentity {
  sourceStartMessageId?: string | null;
  sourceEndMessageId: string;
  priorUserMessageId?: string | null;
}

type OptionalFixtureSnapshot = {
  sourceSnapshot?: EncodedIngestionSourceSnapshot;
};

/** Build a valid, content-minimal snapshot matching one test enqueue identity. */
export function ingestionSourceSnapshotFixture(
  input: IngestionSourceSnapshotFixtureIdentity,
): EncodedIngestionSourceSnapshot {
  const sourceStartMessageId = input.sourceStartMessageId ?? null;
  const priorUserMessageId = input.priorUserMessageId ?? null;
  const messages: Message[] = [];

  if (priorUserMessageId !== null) {
    messages.push({
      id: priorUserMessageId,
      role: 'user',
      content: 'Earlier deterministic test request.',
      timestamp: 1,
    });
  }
  if (sourceStartMessageId !== null) {
    messages.push({
      id: sourceStartMessageId,
      role: 'user',
      content: 'Deterministic test request.',
      timestamp: 2,
    });
  }
  messages.push({
    id: input.sourceEndMessageId,
    role: 'assistant',
    content: 'Deterministic test response.',
    timestamp: 3,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  });

  return encodeIngestionSourceSnapshot({
    messages,
    sourceStartMessageId,
    sourceEndMessageId: input.sourceEndMessageId,
    priorUserMessageId,
  });
}

export function withIngestionSourceSnapshot<
  T extends IngestionSourceSnapshotFixtureIdentity & OptionalFixtureSnapshot,
>(input: T): T & { sourceSnapshot: EncodedIngestionSourceSnapshot } {
  return {
    ...input,
    sourceSnapshot: input.sourceSnapshot ?? ingestionSourceSnapshotFixture(input),
  };
}

/** Keep queue tests terse while making the production snapshot requirement explicit. */
export function createTestIngestionJobEnqueuer<
  TInput extends IngestionSourceSnapshotFixtureIdentity & OptionalFixtureSnapshot,
  TResult,
>(
  enqueue: (input: TInput & { sourceSnapshot: EncodedIngestionSourceSnapshot }) => TResult,
): (input: Omit<TInput, 'sourceSnapshot'> & OptionalFixtureSnapshot) => TResult {
  return (input) => enqueue(withIngestionSourceSnapshot(input as TInput));
}
