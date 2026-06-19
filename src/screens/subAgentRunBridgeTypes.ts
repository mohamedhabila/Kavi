import { Message } from '../types/message';

export type SubAgentSnapshot = NonNullable<Message['subAgentEvent']>['snapshot'];

export type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

export type PendingAgentRunProgressUpdate = {
  conversationId: string;
  runId: string;
  detail: string;
  timestamp: number;
};
