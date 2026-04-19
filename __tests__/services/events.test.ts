// ---------------------------------------------------------------------------
// Tests — Event Bus
// ---------------------------------------------------------------------------

import {
  registerInternalHook,
  unregisterInternalHook,
  clearInternalHooks,
  getRegisteredEventKeys,
  triggerInternalHook,
  createInternalHookEvent,
  emitAppEvent,
  emitMcpEvent,
  emitSessionEvent,
} from '../../src/services/events/bus';

beforeEach(() => {
  clearInternalHooks();
});

describe('registerInternalHook / triggerInternalHook', () => {
  it('calls registered handler for matching event type', async () => {
    const handler = jest.fn();
    registerInternalHook('command', handler);

    const event = createInternalHookEvent('command', 'new', 'session1');
    await triggerInternalHook(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('calls handler for specific event:action key', async () => {
    const handler = jest.fn();
    registerInternalHook('command:new', handler);

    await triggerInternalHook(createInternalHookEvent('command', 'new', 'session1'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls both type and specific handlers', async () => {
    const typeHandler = jest.fn();
    const specificHandler = jest.fn();
    registerInternalHook('session', typeHandler);
    registerInternalHook('session:start', specificHandler);

    await triggerInternalHook(createInternalHookEvent('session', 'start', 's1'));

    expect(typeHandler).toHaveBeenCalledTimes(1);
    expect(specificHandler).toHaveBeenCalledTimes(1);
  });

  it('does not call unrelated handlers', async () => {
    const handler = jest.fn();
    registerInternalHook('memory', handler);

    await triggerInternalHook(createInternalHookEvent('command', 'new', 's1'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles handler errors gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    registerInternalHook('command', () => {
      throw new Error('boom');
    });

    await expect(
      triggerInternalHook(createInternalHookEvent('command', 'test', 's1')),
    ).resolves.not.toThrow();

    warnSpy.mockRestore();
  });
});

describe('unregisterInternalHook', () => {
  it('removes a specific handler', async () => {
    const handler = jest.fn();
    registerInternalHook('command', handler);
    unregisterInternalHook('command', handler);

    await triggerInternalHook(createInternalHookEvent('command', 'new', 's1'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not affect other handlers', async () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    registerInternalHook('command', h1);
    registerInternalHook('command', h2);
    unregisterInternalHook('command', h1);

    await triggerInternalHook(createInternalHookEvent('command', 'new', 's1'));
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });
});

describe('clearInternalHooks', () => {
  it('removes all handlers', async () => {
    const handler = jest.fn();
    registerInternalHook('command', handler);
    clearInternalHooks();

    await triggerInternalHook(createInternalHookEvent('command', 'new', 's1'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('getRegisteredEventKeys', () => {
  it('returns registered keys', () => {
    registerInternalHook('command', jest.fn());
    registerInternalHook('session:start', jest.fn());

    const keys = getRegisteredEventKeys();
    expect(keys).toContain('command');
    expect(keys).toContain('session:start');
  });
});

describe('createInternalHookEvent', () => {
  it('creates event with all fields', () => {
    const event = createInternalHookEvent('session', 'start', 'session1', { foo: 'bar' });
    expect(event.type).toBe('session');
    expect(event.action).toBe('start');
    expect(event.sessionKey).toBe('session1');
    expect(event.context).toEqual({ foo: 'bar' });
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.messages).toEqual([]);
  });
});

describe('convenience emitters', () => {
  it('emitAppEvent triggers app event', async () => {
    const handler = jest.fn();
    registerInternalHook('app', handler);
    await emitAppEvent('launch');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].action).toBe('launch');
  });

  it('emitMcpEvent triggers mcp event with context', async () => {
    const handler = jest.fn();
    registerInternalHook('mcp', handler);
    await emitMcpEvent('connected', { serverId: 's1', serverName: 'test' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].context.serverId).toBe('s1');
  });

  it('emitSessionEvent triggers session event', async () => {
    const handler = jest.fn();
    registerInternalHook('session', handler);
    await emitSessionEvent('start', { conversationId: 'c1' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
