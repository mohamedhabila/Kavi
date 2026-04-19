// ---------------------------------------------------------------------------
// Kavi — Command Poll Backoff
// ---------------------------------------------------------------------------

export interface CommandPollEntry {
  count: number;
  lastPollAt: number;
}

export interface CommandPollState {
  commandPollCounts?: Map<string, CommandPollEntry>;
}

const BACKOFF_SCHEDULE_MS = [5000, 10000, 30000, 60000];

export function calculateBackoffMs(consecutiveNoOutputPolls: number): number {
  const index = Math.min(consecutiveNoOutputPolls, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index] ?? 60000;
}

export function recordCommandPoll(
  state: CommandPollState,
  commandId: string,
  hasNewOutput: boolean,
): number {
  if (!state.commandPollCounts) {
    state.commandPollCounts = new Map();
  }

  const existing = state.commandPollCounts.get(commandId);
  const now = Date.now();

  if (hasNewOutput) {
    state.commandPollCounts.set(commandId, { count: 0, lastPollAt: now });
    return BACKOFF_SCHEDULE_MS[0] ?? 5000;
  }

  const newCount = (existing?.count ?? -1) + 1;
  state.commandPollCounts.set(commandId, { count: newCount, lastPollAt: now });

  return calculateBackoffMs(newCount);
}

export function getCommandPollSuggestion(
  state: CommandPollState,
  commandId: string,
): number | undefined {
  const pollData = state.commandPollCounts?.get(commandId);
  if (!pollData) {
    return undefined;
  }
  return calculateBackoffMs(pollData.count);
}

export function resetCommandPollCount(state: CommandPollState, commandId: string): void {
  state.commandPollCounts?.delete(commandId);
}

export function pruneStaleCommandPolls(state: CommandPollState, maxAgeMs = 3600000): void {
  if (!state.commandPollCounts) {
    return;
  }

  const now = Date.now();
  for (const [commandId, data] of state.commandPollCounts.entries()) {
    if (now - data.lastPollAt > maxAgeMs) {
      state.commandPollCounts.delete(commandId);
    }
  }
}
