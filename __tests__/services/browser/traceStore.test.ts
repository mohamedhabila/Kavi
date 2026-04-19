// ---------------------------------------------------------------------------
// Tests — Browser Trace Store
// ---------------------------------------------------------------------------

import {
  useBrowserTraceStore,
  startBrowserTrace,
  completeBrowserTrace,
} from '../../../src/services/browser/traceStore';

// Reset store between tests
beforeEach(() => {
  useBrowserTraceStore.getState().clearAll();
});

describe('useBrowserTraceStore', () => {
  describe('recordTrace', () => {
    it('should record a new trace and return its id', () => {
      const id = useBrowserTraceStore.getState().recordTrace({
        sessionId: 'sess-1',
        action: 'navigate',
        description: 'Navigate to https://example.com',
        status: 'pending',
      });

      expect(id).toMatch(/^bt-/);
      const traces = useBrowserTraceStore.getState().getSessionTraces('sess-1');
      expect(traces).toHaveLength(1);
      expect(traces[0].id).toBe(id);
      expect(traces[0].action).toBe('navigate');
      expect(traces[0].status).toBe('pending');
      expect(traces[0].sessionId).toBe('sess-1');
      expect(typeof traces[0].timestamp).toBe('number');
    });

    it('should store request payload', () => {
      useBrowserTraceStore.getState().recordTrace({
        sessionId: 'sess-1',
        action: 'click',
        description: 'Click button',
        status: 'pending',
        request: { ref: 'btn-1', x: 10, y: 20 },
      });

      const traces = useBrowserTraceStore.getState().getSessionTraces('sess-1');
      expect(traces[0].request).toEqual({ ref: 'btn-1', x: 10, y: 20 });
    });

    it('should add new traces at the beginning (most recent first)', () => {
      const store = useBrowserTraceStore.getState();
      store.recordTrace({ sessionId: 's1', action: 'first', description: '', status: 'pending' });
      store.recordTrace({ sessionId: 's1', action: 'second', description: '', status: 'pending' });
      store.recordTrace({ sessionId: 's1', action: 'third', description: '', status: 'pending' });

      const traces = useBrowserTraceStore.getState().getSessionTraces('s1');
      expect(traces[0].action).toBe('third');
      expect(traces[1].action).toBe('second');
      expect(traces[2].action).toBe('first');
    });

    it('should prune traces beyond 500 per session', () => {
      const store = useBrowserTraceStore.getState();
      for (let i = 0; i < 510; i++) {
        store.recordTrace({
          sessionId: 's1',
          action: `action-${i}`,
          description: '',
          status: 'success',
        });
      }

      const traces = useBrowserTraceStore.getState().getSessionTraces('s1');
      expect(traces.length).toBe(500);
      // Most recent should be at index 0
      expect(traces[0].action).toBe('action-509');
    });

    it('should keep separate trace lists per session', () => {
      const store = useBrowserTraceStore.getState();
      store.recordTrace({ sessionId: 'a', action: 'nav', description: '', status: 'pending' });
      store.recordTrace({ sessionId: 'b', action: 'click', description: '', status: 'pending' });
      store.recordTrace({ sessionId: 'a', action: 'type', description: '', status: 'pending' });

      expect(useBrowserTraceStore.getState().getSessionTraces('a')).toHaveLength(2);
      expect(useBrowserTraceStore.getState().getSessionTraces('b')).toHaveLength(1);
    });
  });

  describe('resolveTrace', () => {
    it('should update a pending trace with success result', () => {
      const id = useBrowserTraceStore.getState().recordTrace({
        sessionId: 's1',
        action: 'navigate',
        description: 'Navigate',
        status: 'pending',
      });

      useBrowserTraceStore.getState().resolveTrace(id, 's1', {
        status: 'success',
        durationMs: 150,
        pageUrl: 'https://example.com',
        response: { title: 'Example' },
      });

      const trace = useBrowserTraceStore.getState().getSessionTraces('s1')[0];
      expect(trace.status).toBe('success');
      expect(trace.durationMs).toBe(150);
      expect(trace.pageUrl).toBe('https://example.com');
      expect(trace.response).toEqual({ title: 'Example' });
    });

    it('should update a trace with error result', () => {
      const id = useBrowserTraceStore.getState().recordTrace({
        sessionId: 's1',
        action: 'click',
        description: 'Click',
        status: 'pending',
      });

      useBrowserTraceStore.getState().resolveTrace(id, 's1', {
        status: 'error',
        error: 'Element not found',
        durationMs: 50,
      });

      const trace = useBrowserTraceStore.getState().getSessionTraces('s1')[0];
      expect(trace.status).toBe('error');
      expect(trace.error).toBe('Element not found');
      expect(trace.durationMs).toBe(50);
    });

    it('should be a no-op when session does not exist', () => {
      // Should not throw
      useBrowserTraceStore.getState().resolveTrace('nonexistent', 'no-session', {
        status: 'success',
      });
      expect(useBrowserTraceStore.getState().getSessionTraces('no-session')).toHaveLength(0);
    });
  });

  describe('clearSessionTraces', () => {
    it('should remove only traces for the specified session', () => {
      const store = useBrowserTraceStore.getState();
      store.recordTrace({ sessionId: 'a', action: 'x', description: '', status: 'success' });
      store.recordTrace({ sessionId: 'b', action: 'y', description: '', status: 'success' });

      useBrowserTraceStore.getState().clearSessionTraces('a');

      expect(useBrowserTraceStore.getState().getSessionTraces('a')).toHaveLength(0);
      expect(useBrowserTraceStore.getState().getSessionTraces('b')).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should remove all traces', () => {
      const store = useBrowserTraceStore.getState();
      store.recordTrace({ sessionId: 'a', action: 'x', description: '', status: 'success' });
      store.recordTrace({ sessionId: 'b', action: 'y', description: '', status: 'success' });

      useBrowserTraceStore.getState().clearAll();

      expect(useBrowserTraceStore.getState().traces).toEqual({});
    });
  });

  describe('getSessionTraces', () => {
    it('should return empty array for unknown session', () => {
      expect(useBrowserTraceStore.getState().getSessionTraces('nonexistent')).toEqual([]);
    });
  });

  describe('selector stability (traces[sessionId])', () => {
    it('direct state access returns stable undefined for missing sessions', () => {
      const state = useBrowserTraceStore.getState();
      const ref1 = state.traces['missing'];
      const ref2 = state.traces['missing'];
      // Both are the same reference (undefined), so Object.is passes
      expect(ref1).toBe(ref2);
    });

    it('direct state access returns same reference for existing sessions', () => {
      useBrowserTraceStore.getState().recordTrace({
        sessionId: 's1',
        action: 'click',
        description: '',
        status: 'success',
      });
      const state = useBrowserTraceStore.getState();
      const ref1 = state.traces['s1'];
      const ref2 = state.traces['s1'];
      expect(ref1).toBe(ref2);
    });
  });
});

describe('convenience helpers', () => {
  beforeEach(() => {
    useBrowserTraceStore.getState().clearAll();
  });

  describe('startBrowserTrace', () => {
    it('should create a pending trace and return its ID', () => {
      const id = startBrowserTrace('sess-1', 'navigate', 'Go to site', {
        url: 'https://example.com',
      });
      expect(id).toMatch(/^bt-/);

      const traces = useBrowserTraceStore.getState().getSessionTraces('sess-1');
      expect(traces).toHaveLength(1);
      expect(traces[0].status).toBe('pending');
      expect(traces[0].action).toBe('navigate');
      expect(traces[0].description).toBe('Go to site');
      expect(traces[0].request).toEqual({ url: 'https://example.com' });
    });
  });

  describe('completeBrowserTrace', () => {
    it('should resolve a pending trace with success', () => {
      const id = startBrowserTrace('sess-1', 'click', 'Click button');
      completeBrowserTrace(id, 'sess-1', {
        status: 'success',
        durationMs: 100,
        pageUrl: 'https://example.com/page',
      });

      const trace = useBrowserTraceStore.getState().getSessionTraces('sess-1')[0];
      expect(trace.status).toBe('success');
      expect(trace.durationMs).toBe(100);
      expect(trace.pageUrl).toBe('https://example.com/page');
    });

    it('should resolve a pending trace with error', () => {
      const id = startBrowserTrace('sess-1', 'type', 'Type text');
      completeBrowserTrace(id, 'sess-1', {
        status: 'error',
        error: 'Timeout',
        durationMs: 5000,
      });

      const trace = useBrowserTraceStore.getState().getSessionTraces('sess-1')[0];
      expect(trace.status).toBe('error');
      expect(trace.error).toBe('Timeout');
    });
  });
});
