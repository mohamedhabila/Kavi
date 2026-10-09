import { createForegroundSteeringDelivery } from '../../../src/engine/graph/foregroundRun/steeringDelivery';
import {
  createSteeringQueue,
  MAX_QUEUED_STEERING_MESSAGES,
} from '../../../src/engine/graph/foregroundRun/steeringQueue';
import type { Message } from '../../../src/types/message';

function enqueue(
  queue: ReturnType<typeof createSteeringQueue>,
  id: string,
  overrides: { conversationId?: string; targetRunId?: string; text?: string } = {},
) {
  return queue.enqueue({
    id,
    conversationId: overrides.conversationId ?? 'conversation-1',
    targetRunId: overrides.targetRunId ?? 'run-1',
    text: overrides.text ?? `steer ${id}`,
    enqueuedAt: 1,
  });
}

describe('steering queue', () => {
  it('hands a run only the messages queued for it, oldest first, once', () => {
    const queue = createSteeringQueue();
    enqueue(queue, 'a');
    enqueue(queue, 'stale', { targetRunId: 'run-0' });
    enqueue(queue, 'b');
    enqueue(queue, 'elsewhere', { conversationId: 'conversation-2' });

    expect(queue.take('conversation-1', 'run-1').map((message) => message.id)).toEqual(['a', 'b']);
    expect(queue.take('conversation-1', 'run-1')).toEqual([]);
    expect(queue.get('conversation-1').map((message) => message.id)).toEqual(['stale']);
    expect(queue.get('conversation-2').map((message) => message.id)).toEqual(['elsewhere']);
  });

  it('refuses blank text and a full queue instead of dropping a message', () => {
    const queue = createSteeringQueue();

    expect(enqueue(queue, 'blank', { text: '  \n' })).toEqual({
      status: 'rejected',
      reason: 'empty',
    });
    for (let index = 0; index < MAX_QUEUED_STEERING_MESSAGES; index += 1) {
      expect(enqueue(queue, `m${index}`).status).toBe('queued');
    }
    expect(enqueue(queue, 'overflow')).toEqual({ status: 'rejected', reason: 'queue_full' });
    expect(queue.get('conversation-1')).toHaveLength(MAX_QUEUED_STEERING_MESSAGES);
  });

  it('rejects a message without identities', () => {
    const queue = createSteeringQueue();

    expect(() => enqueue(queue, ' ')).toThrow('steering_queue_message_id_invalid');
    expect(() => enqueue(queue, 'a', { targetRunId: '' })).toThrow('steering_queue_run_id_invalid');
  });

  it('removes one message or clears the conversation, returning what was waiting', () => {
    const queue = createSteeringQueue();
    enqueue(queue, 'a');
    enqueue(queue, 'b');
    enqueue(queue, 'c');

    expect(queue.remove('conversation-1', 'b')?.id).toBe('b');
    expect(queue.remove('conversation-1', 'b')).toBeUndefined();
    expect(queue.clear('conversation-1').map((message) => message.id)).toEqual(['a', 'c']);
    expect(queue.get('conversation-1')).toEqual([]);
    expect(queue.clear('conversation-1')).toEqual([]);
  });

  it('publishes a new snapshot on every change and none on a no-op', () => {
    const queue = createSteeringQueue();
    const listener = jest.fn();
    const unsubscribe = queue.subscribe(listener);
    const initial = queue.getSnapshot();

    enqueue(queue, 'a');
    const queued = queue.getSnapshot();
    queue.take('conversation-1', 'run-other');
    queue.clear('conversation-2');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(queued).not.toBe(initial);
    expect(queue.getSnapshot()).toBe(queued);
    expect(queued.byConversation.get('conversation-1')?.map((message) => message.id)).toEqual([
      'a',
    ]);
    unsubscribe();
    queue.take('conversation-1', 'run-1');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('foreground steering delivery', () => {
  function setup(canDeliver: boolean) {
    const queue = createSteeringQueue();
    const added: Message[] = [];
    const delivery = createForegroundSteeringDelivery({
      conversationId: 'conversation-1',
      runId: 'run-1',
      queue,
      canDeliver: () => canDeliver,
      addMessage: (_conversationId, message) => added.push(message),
      now: () => 42,
    });
    return { queue, added, delivery };
  }

  it('persists each queued message as a steer of the run and returns it', () => {
    const { queue, added, delivery } = setup(true);
    enqueue(queue, 'a', { text: 'Make it vegetarian.' });

    const delivered = delivery.takeSteeringMessages();

    const expected = {
      id: 'a',
      role: 'user',
      content: 'Make it vegetarian.',
      timestamp: 42,
      steerOfRunId: 'run-1',
    };
    expect(delivered).toEqual([expected]);
    expect(added).toEqual([expected]);
    expect(queue.get('conversation-1')).toEqual([]);
  });

  it('keeps messages waiting while the run cannot take them yet', () => {
    const { queue, added, delivery } = setup(false);
    enqueue(queue, 'a');

    expect(delivery.takeSteeringMessages()).toEqual([]);
    expect(added).toEqual([]);
    expect(queue.get('conversation-1').map((message) => message.id)).toEqual(['a']);
  });
});
