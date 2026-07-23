import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';

function handle(conversationId: string, requestId: string) {
  return {
    conversationId,
    requestId,
    controller: new AbortController(),
  };
}

describe('foreground request registry', () => {
  it('isolates concurrent requests even when request ids collide', () => {
    const registry = createForegroundRequestRegistry();
    const first = handle('conversation-a', 'request-1');
    const second = handle('conversation-b', 'request-1');

    registry.register(first);
    registry.register(second);
    registry.setStreamingMessageId(first, 'message-a');
    registry.setStreamingMessageId(second, 'message-b');

    expect(registry.abortForConversation('conversation-a', 'stop-a')).toBe(true);
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(false);
    expect(registry.getStreamingMessageId('conversation-a')).toBe('message-a');
    expect(registry.getStreamingMessageId('conversation-b')).toBe('message-b');

    expect(registry.clear(first)).toBe(true);
    expect(registry.hasConversation('conversation-a')).toBe(false);
    expect(registry.isCurrent(second)).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('rejects stale clear, abort, and streaming updates after replacement', () => {
    const registry = createForegroundRequestRegistry();
    const stale = handle('conversation-a', 'request-1');
    const current = handle('conversation-a', 'request-2');

    registry.register(stale);
    registry.register(current);

    expect(stale.controller.signal.aborted).toBe(true);
    expect(current.controller.signal.aborted).toBe(false);
    expect(registry.abort(stale, 'stale abort')).toBe(false);
    expect(registry.clear(stale)).toBe(false);
    expect(registry.setStreamingMessageId(stale, 'stale-message')).toBe(false);
    expect(registry.isCurrent(current)).toBe(true);
    expect(current.controller.signal.aborted).toBe(false);
    expect(registry.getStreamingMessageId('conversation-a')).toBeNull();
  });

  it('aborts and removes every owned request during disposal', () => {
    const registry = createForegroundRequestRegistry();
    const first = handle('conversation-a', 'request-a');
    const second = handle('conversation-b', 'request-b');

    registry.register(first);
    registry.register(second);
    registry.dispose('screen disposed');

    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(true);
    expect(registry.getActiveConversationIds()).toEqual(new Set());
    expect(registry.size).toBe(0);
    expect(registry.clear(first)).toBe(false);
  });

  it('publishes a monotonic snapshot when visible request state changes', () => {
    const registry = createForegroundRequestRegistry();
    const request = handle('conversation-a', 'request-a');
    const versions: number[] = [];
    const unsubscribe = registry.subscribe(() => versions.push(registry.getVersion()));

    registry.register(request);
    const registeredSnapshot = registry.getSnapshot();
    registry.setStreamingMessageId(request, 'message-a');
    expect(registry.clear(handle('conversation-a', 'stale-request'))).toBe(false);
    expect(registry.clear(request)).toBe(true);
    unsubscribe();
    registry.register(handle('conversation-b', 'request-b'));

    expect(versions).toEqual([1, 2, 3]);
    expect(registry.getVersion()).toBe(4);
    expect(registeredSnapshot).toEqual({
      activeConversationIds: new Set(['conversation-a']),
      streamingMessageIds: new Map(),
      size: 1,
      version: 1,
    });
    expect(registry.getSnapshot()).toEqual({
      activeConversationIds: new Set(['conversation-b']),
      streamingMessageIds: new Map(),
      size: 1,
      version: 4,
    });
  });
});
