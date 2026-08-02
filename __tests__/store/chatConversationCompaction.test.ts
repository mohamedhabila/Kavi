import { selectDurableCompactionMessages } from '../../src/store/chatConversationCompaction';
import type { Message } from '../../src/types/message';

describe('chat conversation compaction durability', () => {
  it('repairs a stale candidate summary from the latest durable continuation state', () => {
    const sha256 = 'b'.repeat(64);
    const durableMessages: Message[] = [
      {
        id: 'compact-current',
        role: 'system',
        content:
          '[Conversation Summary]\n\n## Tool Continuation State (code-owned)\n' +
          `- {"version":1,"tool":"read_file","path":"attachments/source.txt","sha256":"${sha256}","offset":90,"nextOffset":null,"totalChars":100,"complete":true}`,
        timestamp: 1,
        compactionProvenance: { version: 1, dependency: 'transcript_only' },
      },
    ];
    const candidate: Message = {
      id: 'compact-stale',
      role: 'system',
      content:
        '[Conversation Summary]\n\n## Tool Continuation State (code-owned)\n' +
        `- {"version":1,"tool":"read_file","path":"attachments/source.txt","sha256":"${sha256}","offset":10,"nextOffset":20,"totalChars":100,"complete":false}`,
      timestamp: 2,
      compactionProvenance: { version: 1, dependency: 'transcript_only' },
    };

    const selected = selectDurableCompactionMessages({ messages: durableMessages }, [candidate]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.content).toContain('"complete":true');
    expect(selected[0]?.content).not.toContain('"nextOffset":20');
  });
});
