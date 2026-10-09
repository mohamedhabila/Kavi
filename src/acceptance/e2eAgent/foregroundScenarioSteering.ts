// ---------------------------------------------------------------------------
// Kavi — Foreground scenario steering
// ---------------------------------------------------------------------------
// Sends a scenario's mid-run message through the composer exactly when the person in
// the scenario would: after the turn's run has returned a given number of tool results.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../store/useChatStore';
import type { ForegroundScenarioSteerDirective } from './foregroundScenarioDriverTypes';

export type ForegroundScenarioSteer = {
  /** Stop watching; resolves once a message already sent has been handled. */
  settle: () => Promise<void>;
};

function countToolResults(conversationId: string, messageStartIndex: number): number {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return (conversation?.messages ?? [])
    .slice(messageStartIndex)
    .filter((message) => message.role === 'tool').length;
}

export function scheduleForegroundScenarioSteer(params: {
  conversationId: string;
  messageStartIndex: number;
  steer: ForegroundScenarioSteerDirective;
  send: (text: string) => Promise<void>;
}): ForegroundScenarioSteer {
  let sending: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  const stopWatching = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const check = () => {
    if (sending) return;
    if (
      countToolResults(params.conversationId, params.messageStartIndex) <
      params.steer.afterToolResults
    ) {
      return;
    }
    stopWatching();
    sending = params.send(params.steer.content.trim());
  };
  unsubscribe = useChatStore.subscribe(check);
  check();
  return {
    settle: () => {
      stopWatching();
      return sending ?? Promise.resolve();
    },
  };
}
