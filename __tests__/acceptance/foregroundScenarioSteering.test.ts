import { scheduleForegroundScenarioSteer } from '../../src/acceptance/e2eAgent/foregroundScenarioSteering';
import { useChatStore } from '../../src/store/useChatStore';
import { addConversation } from '../helpers/chatConversationFixtures';

function addUserMessage(conversationId: string, id: string) {
  useChatStore.getState().addMessage(conversationId, { id, role: 'user', content: 'Do it.' });
}

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
    const conversationId = addConversation('provider-1', 'system');
    addUserMessage(conversationId, 'earlier-turn');
    addToolResult(conversationId, 'earlier');
    addUserMessage(conversationId, 'this-turn');
    const send = jest.fn().mockResolvedValue(undefined);

    const steer = scheduleForegroundScenarioSteer({
      conversationId,
      userMessageId: 'this-turn',
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
    const conversationId = addConversation('provider-1', 'system');
    addUserMessage(conversationId, 'this-turn');
    const send = jest.fn().mockResolvedValue(undefined);

    const steer = scheduleForegroundScenarioSteer({
      conversationId,
      userMessageId: 'this-turn',
      steer: { afterToolResults: 1, content: 'Too late.' },
      send,
    });
    await steer.settle();
    addToolResult(conversationId, 'after-settle');

    expect(send).not.toHaveBeenCalled();
  });
});
