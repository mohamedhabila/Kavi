import { scheduleForegroundScenarioSteer } from '../../src/acceptance/e2eAgent/foregroundScenarioSteering';
import { useChatStore } from '../../src/store/useChatStore';

function addToolResult(conversationId: string, id: string) {
  useChatStore.getState().addMessage(conversationId, {
    id,
    role: 'tool',
    toolCallId: `call-${id}`,
    content: 'ok',
  });
}

describe('scheduleForegroundScenarioSteer', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
  });

  it('sends the steer once the turn has returned enough tool results, and only once', async () => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'system');
    addToolResult(conversationId, 'earlier');
    const messageStartIndex = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId)!.messages.length;
    const send = jest.fn().mockResolvedValue(undefined);

    const steer = scheduleForegroundScenarioSteer({
      conversationId,
      messageStartIndex,
      steer: { afterToolResults: 2, content: '  Also remember this.  ' },
      send,
    });
    addToolResult(conversationId, 'first');
    expect(send).not.toHaveBeenCalled();
    addToolResult(conversationId, 'second');
    addToolResult(conversationId, 'third');
    await steer.settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Also remember this.');
  });

  it('sends nothing when the turn ends before reaching the count', async () => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'system');
    const send = jest.fn().mockResolvedValue(undefined);

    const steer = scheduleForegroundScenarioSteer({
      conversationId,
      messageStartIndex: 0,
      steer: { afterToolResults: 1, content: 'Too late.' },
      send,
    });
    await steer.settle();
    addToolResult(conversationId, 'after-settle');

    expect(send).not.toHaveBeenCalled();
  });
});
