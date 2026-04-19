// ---------------------------------------------------------------------------
// Event Bus — full tests
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
  emitAgentEvent,
  emitMemoryEvent,
  emitSchedulerEvent,
} from '../../src/services/events/bus';

describe('Event Bus', () => {
  beforeEach(() => {
    clearInternalHooks();
  });

  describe('registerInternalHook / unregisterInternalHook', () => {
    it('registers a handler', () => {
      registerInternalHook('test', jest.fn());
      expect(getRegisteredEventKeys()).toContain('test');
    });

    it('registers multiple handlers for same key', () => {
      registerInternalHook('multi', jest.fn());
      registerInternalHook('multi', jest.fn());
      expect(getRegisteredEventKeys().filter((k) => k === 'multi')).toHaveLength(1);
    });

    it('unregisters a specific handler', () => {
      const handler = jest.fn();
      registerInternalHook('unreg', handler);
      unregisterInternalHook('unreg', handler);
      expect(getRegisteredEventKeys()).not.toContain('unreg');
    });

    it('unregister does nothing for unknown key', () => {
      unregisterInternalHook('nope', jest.fn());
      // No error thrown
    });

    it('unregister does nothing for non-matching handler', () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      registerInternalHook('test2', h1);
      unregisterInternalHook('test2', h2);
      expect(getRegisteredEventKeys()).toContain('test2');
    });
  });

  describe('clearInternalHooks', () => {
    it('clears all hooks', () => {
      registerInternalHook('a', jest.fn());
      registerInternalHook('b', jest.fn());
      clearInternalHooks();
      expect(getRegisteredEventKeys()).toEqual([]);
    });
  });

  describe('triggerInternalHook', () => {
    it('calls handlers for event type', async () => {
      const handler = jest.fn();
      registerInternalHook('command', handler);

      const event = createInternalHookEvent('command', 'new', 'session1');
      await triggerInternalHook(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('calls handlers for specific event:action', async () => {
      const generalHandler = jest.fn();
      const specificHandler = jest.fn();
      registerInternalHook('command', generalHandler);
      registerInternalHook('command:new', specificHandler);

      const event = createInternalHookEvent('command', 'new', 'session1');
      await triggerInternalHook(event);
      expect(generalHandler).toHaveBeenCalled();
      expect(specificHandler).toHaveBeenCalled();
    });

    it('does nothing with no handlers', async () => {
      const event = createInternalHookEvent('command', 'new', 'session1');
      await triggerInternalHook(event); // Should not throw
    });

    it('catches handler errors and warns', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      registerInternalHook('error_test', () => {
        throw new Error('handler broke');
      });

      const event = createInternalHookEvent('error_test' as any, 'fail', 'session1');
      await triggerInternalHook(event);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('handler broke'));
      warnSpy.mockRestore();
    });

    it('calls async handlers', async () => {
      const handler = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      registerInternalHook('async', handler);

      const event = createInternalHookEvent('async' as any, 'test', 'session1');
      await triggerInternalHook(event);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('createInternalHookEvent', () => {
    it('creates event with all fields', () => {
      const event = createInternalHookEvent('command', 'new', 'session1', {
        commandName: 'new',
      });
      expect(event.type).toBe('command');
      expect(event.action).toBe('new');
      expect(event.sessionKey).toBe('session1');
      expect(event.context).toEqual({ commandName: 'new' });
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.messages).toEqual([]);
    });

    it('defaults context to empty object', () => {
      const event = createInternalHookEvent('session', 'start', 'session1');
      expect(event.context).toEqual({});
    });
  });

  describe('Convenience emitters', () => {
    it('emitAppEvent triggers app hook', async () => {
      const handler = jest.fn();
      registerInternalHook('app', handler);
      await emitAppEvent('launch');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'app', action: 'launch' }),
      );
    });

    it('emitMcpEvent triggers mcp hook', async () => {
      const handler = jest.fn();
      registerInternalHook('mcp', handler);
      await emitMcpEvent('connected', { serverId: 's1', serverName: 'Test' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp',
          action: 'connected',
          context: expect.objectContaining({ serverId: 's1' }),
        }),
      );
    });

    it('emitSessionEvent triggers session hook', async () => {
      const handler = jest.fn();
      registerInternalHook('session', handler);
      await emitSessionEvent('start', { conversationId: 'conv1' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session', action: 'start' }),
      );
    });

    it('emitSessionEvent defaults conversationId', async () => {
      const handler = jest.fn();
      registerInternalHook('session', handler);
      await emitSessionEvent('end');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: 'system' }));
    });

    it('emitAgentEvent triggers agent hook', async () => {
      const handler = jest.fn();
      registerInternalHook('agent', handler);
      await emitAgentEvent('tool_start', { toolName: 'read_file' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent',
          action: 'tool_start',
          context: expect.objectContaining({ toolName: 'read_file' }),
        }),
      );
    });

    it('emitMemoryEvent triggers memory hook', async () => {
      const handler = jest.fn();
      registerInternalHook('memory', handler);
      await emitMemoryEvent('updated', { source: 'compaction' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'memory', action: 'updated' }),
      );
    });

    it('emitSchedulerEvent triggers scheduler hook', async () => {
      const handler = jest.fn();
      registerInternalHook('scheduler', handler);
      await emitSchedulerEvent('task_run', { taskId: 't1' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scheduler',
          action: 'task_run',
          context: expect.objectContaining({ taskId: 't1' }),
        }),
      );
    });
  });
});
