import {
  countPendingIngestionJobs,
  drainIngestionQueue,
} from '../../src/services/memory/ingestionQueue';
import { loadIngestionJobRuntimeContext } from '../../src/services/memory/lifecycle';
import type { Message } from '../../src/types/message';

export const messages: Message[] = [
  {
    id: 'u-1',
    role: 'user',
    content:
      'My project title is Android Release Build Validation. Please remember the release follow-up.',
    timestamp: 1,
  },
  {
    id: 'a-1',
    role: 'assistant',
    content: 'Done. Next: validate the Android release build.',
    timestamp: 2,
    assistantMetadata: { kind: 'final', completionStatus: 'complete' },
  },
];

export async function drainRecordedTurn(
  threadId: string,
  recordedMessages: Message[],
): Promise<Awaited<ReturnType<typeof drainIngestionQueue>>> {
  const result = await drainIngestionQueue({
    loadMessagesForThread: (id) => (id === threadId ? recordedMessages : []),
    loadRuntimeContextForJob: loadIngestionJobRuntimeContext,
  });
  for (let round = 0; round < 50 && countPendingIngestionJobs() > 0; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return result;
}
