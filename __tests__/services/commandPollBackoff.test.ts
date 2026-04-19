// ---------------------------------------------------------------------------
// Tests — Command Poll Backoff
// ---------------------------------------------------------------------------

import {
  calculateBackoffMs,
  getCommandPollSuggestion,
  pruneStaleCommandPolls,
  recordCommandPoll,
  resetCommandPollCount,
  type CommandPollState,
} from '../../src/services/agents/commandPollBackoff';

describe('commandPollBackoff', () => {
  describe('calculateBackoffMs', () => {
    it('returns 5s for first poll', () => {
      expect(calculateBackoffMs(0)).toBe(5000);
    });

    it('returns 10s for second poll', () => {
      expect(calculateBackoffMs(1)).toBe(10000);
    });

    it('returns 30s for third poll', () => {
      expect(calculateBackoffMs(2)).toBe(30000);
    });

    it('returns 60s for fourth and later polls', () => {
      expect(calculateBackoffMs(3)).toBe(60000);
      expect(calculateBackoffMs(8)).toBe(60000);
    });
  });

  describe('recordCommandPoll', () => {
    it('returns 5s on first no-output poll', () => {
      const state: CommandPollState = {};
      const retryMs = recordCommandPoll(state, 'cmd-123', false);

      expect(retryMs).toBe(5000);
      expect(state.commandPollCounts?.get('cmd-123')?.count).toBe(0);
    });

    it('increments count on consecutive no-output polls', () => {
      const state: CommandPollState = {};

      expect(recordCommandPoll(state, 'cmd-123', false)).toBe(5000);
      expect(recordCommandPoll(state, 'cmd-123', false)).toBe(10000);
      expect(recordCommandPoll(state, 'cmd-123', false)).toBe(30000);
      expect(recordCommandPoll(state, 'cmd-123', false)).toBe(60000);
      expect(state.commandPollCounts?.get('cmd-123')?.count).toBe(3);
    });

    it('resets count when a poll returns new output', () => {
      const state: CommandPollState = {};

      recordCommandPoll(state, 'cmd-123', false);
      recordCommandPoll(state, 'cmd-123', false);
      const retryMs = recordCommandPoll(state, 'cmd-123', true);

      expect(retryMs).toBe(5000);
      expect(state.commandPollCounts?.get('cmd-123')?.count).toBe(0);
    });
  });

  describe('getCommandPollSuggestion', () => {
    it('returns undefined for unknown commands', () => {
      const state: CommandPollState = {};
      expect(getCommandPollSuggestion(state, 'missing')).toBeUndefined();
    });

    it('returns the current suggestion for tracked commands', () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, 'cmd-123', false);
      recordCommandPoll(state, 'cmd-123', false);

      expect(getCommandPollSuggestion(state, 'cmd-123')).toBe(10000);
    });
  });

  describe('resetCommandPollCount', () => {
    it('removes tracked commands', () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, 'cmd-123', false);

      resetCommandPollCount(state, 'cmd-123');
      expect(state.commandPollCounts?.has('cmd-123')).toBe(false);
    });
  });

  describe('pruneStaleCommandPolls', () => {
    it('removes polls older than maxAge', () => {
      const state: CommandPollState = {
        commandPollCounts: new Map([
          ['old', { count: 1, lastPollAt: Date.now() - 7200000 }],
          ['new', { count: 2, lastPollAt: Date.now() - 1000 }],
        ]),
      };

      pruneStaleCommandPolls(state, 3600000);

      expect(state.commandPollCounts?.has('old')).toBe(false);
      expect(state.commandPollCounts?.has('new')).toBe(true);
    });
  });
});
