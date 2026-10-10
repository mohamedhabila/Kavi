import { fireEvent, render, waitFor, ChatScreen } from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockArchivedTranscript } from '../../../testSupport/chatScreen/serviceMocks';

function renderedTexts(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => renderedTexts(child, out));
    return out;
  }
  renderedTexts(node.children, out);
  return out;
}

// History older than the persisted window used to be gone after a restart. It is now
// archived and paged back in when the person scrolls up their one conversation.

describe('ChatScreen archived history', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('offers older history and shows it read-only, before the messages held in memory', async () => {
    mockArchivedTranscript.messages = [
      { id: 'old-user', role: 'user', content: 'Plan my first week', timestamp: 1 },
      {
        id: 'old-assistant',
        role: 'assistant',
        content: 'Here is week one.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];
    const screen = render(<ChatScreen />);

    const showEarlier = await waitFor(() => screen.getByTestId('chat-show-earlier-messages'));
    expect(screen.queryByText('Plan my first week')).toBeNull();
    const editableBefore = screen.queryAllByTestId('icon-Edit2').length;

    fireEvent.press(showEarlier);

    await waitFor(() => expect(screen.getByText('Plan my first week')).toBeTruthy());
    expect(screen.getByText('Here is week one.')).toBeTruthy();
    const texts = renderedTexts(screen.toJSON());
    expect(texts.indexOf('Plan my first week')).toBeLessThan(texts.indexOf('Hello'));
    expect(screen.queryAllByTestId('icon-Edit2')).toHaveLength(editableBefore);
    expect(screen.queryByTestId('chat-show-earlier-messages')).toBeNull();
  });

  it('offers nothing when there is no older history', () => {
    const screen = render(<ChatScreen />);

    expect(screen.queryByTestId('chat-show-earlier-messages')).toBeNull();
  });
});
