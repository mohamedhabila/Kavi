/**
 * Messages a person sent while a foreground run was working, waiting for that run's
 * next step ("steering"). The run takes the messages queued for it before each model
 * step that follows a tool result; each becomes a user message marked with the run's id.
 *
 * Process-local, like the foreground request registry: the queue belongs to the live
 * runs of this process and is observable so the composer can show what is waiting.
 */

/** Queued messages per conversation; a send beyond this is refused, not dropped. */
export const MAX_QUEUED_STEERING_MESSAGES = 8;

export type QueuedSteeringMessage = Readonly<{
  /** Id the user message is persisted with when the run takes it. */
  id: string;
  conversationId: string;
  /** The foreground request (its projection owner's `runId`) this message steers. */
  targetRunId: string;
  text: string;
  enqueuedAt: number;
}>;

export type SteeringEnqueueResult =
  | Readonly<{ status: 'queued'; message: QueuedSteeringMessage }>
  | Readonly<{ status: 'rejected'; reason: 'empty' | 'queue_full' }>;

export type SteeringQueueSnapshot = Readonly<{
  byConversation: ReadonlyMap<string, ReadonlyArray<QueuedSteeringMessage>>;
  version: number;
}>;

const EMPTY_QUEUE: ReadonlyArray<QueuedSteeringMessage> = Object.freeze([]);

function requireIdentity(value: string, field: string): string {
  if (!value.trim()) throw new Error(`steering_queue_${field}_invalid`);
  return value;
}

export function createSteeringQueue() {
  const queues = new Map<string, ReadonlyArray<QueuedSteeringMessage>>();
  const listeners = new Set<() => void>();
  let version = 0;
  let snapshot: SteeringQueueSnapshot = { byConversation: new Map(), version };

  const replace = (conversationId: string, next: ReadonlyArray<QueuedSteeringMessage>): void => {
    if (next.length > 0) queues.set(conversationId, Object.freeze([...next]));
    else queues.delete(conversationId);
    version += 1;
    snapshot = { byConversation: new Map(queues), version };
    for (const listener of listeners) listener();
  };

  const get = (conversationId: string): ReadonlyArray<QueuedSteeringMessage> =>
    queues.get(conversationId) ?? EMPTY_QUEUE;

  return {
    enqueue(input: {
      id: string;
      conversationId: string;
      targetRunId: string;
      text: string;
      enqueuedAt: number;
    }): SteeringEnqueueResult {
      const message: QueuedSteeringMessage = Object.freeze({
        id: requireIdentity(input.id, 'message_id'),
        conversationId: requireIdentity(input.conversationId, 'conversation_id'),
        targetRunId: requireIdentity(input.targetRunId, 'run_id'),
        text: input.text,
        enqueuedAt: input.enqueuedAt,
      });
      if (!message.text.trim()) return { status: 'rejected', reason: 'empty' };
      const queue = get(message.conversationId);
      if (queue.length >= MAX_QUEUED_STEERING_MESSAGES) {
        return { status: 'rejected', reason: 'queue_full' };
      }
      replace(message.conversationId, [...queue, message]);
      return { status: 'queued', message };
    },
    /** Remove and return the messages queued for this run, oldest first. */
    take(conversationId: string, targetRunId: string): QueuedSteeringMessage[] {
      const queue = get(conversationId);
      const taken = queue.filter((message) => message.targetRunId === targetRunId);
      if (taken.length === 0) return [];
      replace(
        conversationId,
        queue.filter((message) => message.targetRunId !== targetRunId),
      );
      return taken;
    },
    /** Address the messages waiting for one run to the run that continues its work. */
    retarget(conversationId: string, fromRunId: string, toRunId: string): void {
      requireIdentity(toRunId, 'run_id');
      const queue = get(conversationId);
      if (!queue.some((message) => message.targetRunId === fromRunId)) return;
      replace(
        conversationId,
        queue.map((message) =>
          message.targetRunId === fromRunId
            ? Object.freeze({ ...message, targetRunId: toRunId })
            : message,
        ),
      );
    },
    /** Remove one queued message, returning it when it was still waiting. */
    remove(conversationId: string, messageId: string): QueuedSteeringMessage | undefined {
      const queue = get(conversationId);
      const removed = queue.find((message) => message.id === messageId);
      if (removed)
        replace(
          conversationId,
          queue.filter((message) => message !== removed),
        );
      return removed;
    },
    /** Remove and return everything queued in the conversation, oldest first. */
    clear(conversationId: string): QueuedSteeringMessage[] {
      const queue = get(conversationId);
      if (queue.length > 0) replace(conversationId, []);
      return [...queue];
    },
    get,
    getSnapshot: (): SteeringQueueSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SteeringQueue = ReturnType<typeof createSteeringQueue>;

/** The process's queue, shared by the composer that fills it and the runs that drain it. */
export const appSteeringQueue = createSteeringQueue();
