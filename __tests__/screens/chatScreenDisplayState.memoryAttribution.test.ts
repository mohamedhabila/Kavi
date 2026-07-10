import {
  createChatDisplayStateCache,
  getStableDisplayMessages,
} from '../../src/screens/chatScreenDisplayState';
import type { Message } from '../../src/types/message';

function makeAssistant(memoryRetrievalEventId?: string): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Remembered answer',
    timestamp: 1,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      ...(memoryRetrievalEventId ? { memoryRetrievalEventId } : {}),
    },
  };
}

describe('chat display memory attribution', () => {
  it('invalidates a cached message when code-owned retrieval attribution arrives', () => {
    const cache = createChatDisplayStateCache();
    const first = getStableDisplayMessages([makeAssistant()], cache);
    const second = getStableDisplayMessages([makeAssistant('retrieval_event_m123_1_abc')], cache);

    expect(second[0]).not.toBe(first[0]);
    expect(second[0].message.assistantMetadata?.memoryRetrievalEventId).toBe(
      'retrieval_event_m123_1_abc',
    );
  });
});
