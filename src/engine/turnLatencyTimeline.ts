// ---------------------------------------------------------------------------
// Kavi — Foreground turn latency timeline
// ---------------------------------------------------------------------------
// Records when a foreground turn reaches each send-to-first-output milestone so a
// slow turn can be attributed to the stage that cost the time instead of guessed at.
// The timeline is in-memory for one turn; the breakdown it produces is persisted on
// the agent run's performance record through the graph's own metrics event.

import type { AgentRunTurnLatency, AgentRunTurnLatencyStage } from '../types/agentRun';

export interface TurnLatencyTimeline {
  /**
   * Records `stage` the first time the turn reaches it. Returns the breakdown so far
   * when this call recorded the stage, and `undefined` when it had already been marked,
   * so a caller that persists the breakdown does so once per stage.
   */
  mark(stage: AgentRunTurnLatencyStage): AgentRunTurnLatency | undefined;
}

export function createTurnLatencyTimeline(now: () => number = Date.now): TurnLatencyTimeline {
  const startedAt = now();
  const offsets: AgentRunTurnLatency = {};
  return {
    mark(stage) {
      if (offsets[stage] !== undefined) {
        return undefined;
      }
      offsets[stage] = Math.max(0, now() - startedAt);
      return { ...offsets };
    },
  };
}
