import { act, renderHook } from '@testing-library/react-native';
import { appSteeringQueue } from '../../src/engine/graph/foregroundRun/steeringQueue';
import { useQueuedSteering } from '../../src/screens/chatScreen/useQueuedSteering';

describe('useQueuedSteering', () => {
  afterEach(() => {
    appSteeringQueue.clear('conversation-1');
  });

  it('follows the queue of the active conversation and returns an edited message', () => {
    const returnTextToComposer = jest.fn();
    const { result } = renderHook(() =>
      useQueuedSteering({ conversationId: 'conversation-1', returnTextToComposer }),
    );
    expect(result.current.queuedMessages).toEqual([]);

    act(() => {
      appSteeringQueue.enqueue({
        id: 'steer-1',
        conversationId: 'conversation-1',
        targetRunId: 'run-1',
        text: 'Make it vegetarian.',
        enqueuedAt: 1,
      });
    });
    expect(result.current.queuedMessages.map((message) => message.id)).toEqual(['steer-1']);

    act(() => {
      result.current.editQueuedMessage('steer-1');
    });
    expect(result.current.queuedMessages).toEqual([]);
    expect(returnTextToComposer).toHaveBeenCalledWith('conversation-1', 'Make it vegetarian.');

    act(() => {
      result.current.editQueuedMessage('steer-1');
    });
    expect(returnTextToComposer).toHaveBeenCalledTimes(1);
  });

  it('has nothing queued without an active conversation', () => {
    const { result } = renderHook(() =>
      useQueuedSteering({ conversationId: null, returnTextToComposer: jest.fn() }),
    );

    expect(result.current.queuedMessages).toEqual([]);
  });
});
