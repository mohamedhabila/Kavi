import { shouldTrackForegroundAgentRun } from '../../src/engine/graph/runTracking';
import type { Message } from '../../src/types/message';

const userMessage = (content: string, attachmentCount = 0): Message => ({
  id: 'user-1',
  role: 'user',
  content,
  timestamp: 1,
  attachments: Array.from({ length: attachmentCount }, (_, index) => ({
    id: `attachment-${index}`,
    name: `attachment-${index}.txt`,
    type: 'text/plain',
    uri: `file:///attachment-${index}.txt`,
    size: 1,
  })),
});

describe('agent control graph run tracking', () => {
  it('tracks actionable agentic turns', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'agentic',
        latestUserMessage: userMessage('Create a file and verify it.'),
        messageCount: 1,
      }),
    ).toBe(true);
  });

  it('tracks short requests on the normal agentic path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'agentic',
        latestUserMessage: userMessage('hi'),
        messageCount: 1,
      }),
    ).toBe(true);
  });

  it('does not track chitchat turns even when the text is actionable', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'chitchat',
        latestUserMessage: userMessage('Create a file and verify it.'),
        messageCount: 1,
      }),
    ).toBe(false);
  });

  it('tracks agentic run resumes regardless of direct-request assessment', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'agentic',
        latestUserMessage: userMessage('ok'),
        messageCount: 3,
        reuseAgentRunId: 'run-1',
      }),
    ).toBe(true);
  });

  it('tracks standalone literal-token requests on the normal workflow path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'agentic',
        latestUserMessage: userMessage('CHECKNO42'),
        messageCount: 1,
      }),
    ).toBe(true);
  });

  it('tracks standalone literal-token replies even inside an existing conversation', () => {
    expect(
      shouldTrackForegroundAgentRun({
        conversationMode: 'agentic',
        latestUserMessage: userMessage('PINGC718'),
        messageCount: 6,
      }),
    ).toBe(true);
  });
});
