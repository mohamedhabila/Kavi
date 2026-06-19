// ---------------------------------------------------------------------------
// Kavi — Chitchat memory ingestion fixtures (structural)
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';

export interface MemoryChitchatIngestionFixture {
  id: string;
  threadId: string;
  threadTitle: string;
  messages: Message[];
  expectedFocusToken: string;
}

function closedAssistant(id: string, content: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  };
}

export const MEMORY_CHITCHAT_INGESTION_FIXTURES: ReadonlyArray<MemoryChitchatIngestionFixture> = [
  {
    id: 'chitchat-episode-focus',
    threadId: 'conv-chitchat-r',
    threadTitle: 'weekend-planning',
    messages: [
      { id: 'u-1', role: 'user', content: 'plan-weekend-trip-42', timestamp: 1 },
      closedAssistant('a-1', 'acknowledged', 2),
    ],
    expectedFocusToken: 'weekend-planning',
  },
];
