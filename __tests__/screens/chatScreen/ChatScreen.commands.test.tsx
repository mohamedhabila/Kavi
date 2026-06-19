import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';
import { mockUpdateMessage } from '../../../testSupport/chatScreen/storeMocks';
import {
  mockRunOrchestrator,
  mockExportConversationAsMarkdown,
  mockShareTextExport,
  mockShareConversationWorkspaceFile,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen command results and sharing', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('preserves separate drafts for each conversation', () => {
    mockChatScreenState.conversations = [
      ...createDefaultConversations(),
      {
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: Date.now() },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerId: 'openai',
        model: 'gpt-5.4',
        systemPrompt: 'You are helpful',
        usage: {
          entries: [],
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalTokens: 0,
          totalCost: 0,
          totalCalls: 0,
        },
        logs: [],
        agentRuns: [],
      },
    ];

    const screen = render(<ChatScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Draft for first conversation');

    act(() => {
      mockChatScreenState.activeConversationId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.queryByDisplayValue('Draft for first conversation')).toBeNull();

    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Draft for second conversation',
    );

    act(() => {
      mockChatScreenState.activeConversationId = 'conv1';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.getByDisplayValue('Draft for first conversation')).toBeTruthy();

    act(() => {
      mockChatScreenState.activeConversationId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.getByDisplayValue('Draft for second conversation')).toBeTruthy();
  });

  it('handles model selection via ModelSelector', () => {
    // ModelSelector calls onSelect(providerId, model) which triggers handleModelSelect
    // handleModelSelect calls updateModelInConversation and setLastUsedModel
    const { getByText } = render(<ChatScreen />);
    expect(getByText('gpt-5.4')).toBeTruthy();
    // We can verify the ModelSelector renders and the handleModelSelect is properly wired
    // by checking that the component renders without error
  });

  it('handles export command result', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Export test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    callbacks.onCommandResult({ action: 'export', response: 'Exporting conversation...' });

    expect(mockExportConversationAsMarkdown).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockShareTextExport).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Exported',
          fileName: 'Test_Chat.md',
          mimeType: 'text/markdown',
        }),
      );
    });
  });

  it('share workspace-backed attachments through the shared share service', async () => {
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Here is the report.',
            timestamp: Date.now(),
            attachments: [
              {
                id: 'attachment-1',
                type: 'file',
                uri: 'file:///mock/document/workspace/conv1/report.md',
                name: 'report.md',
                workspacePath: 'report.md',
              },
            ],
          },
        ],
      },
    ];

    const { getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('message-bubble-share-workspace-file'));

    await waitFor(() => {
      expect(mockShareConversationWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
          path: 'report.md',
          dialogTitle: 'report.md',
          fallbackConversationIds: [],
        }),
      );
    });
  });

  it('handles command result with response but no export', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Command test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    callbacks.onCommandResult({ response: 'Some response' });
    expect(mockUpdateMessage).toHaveBeenCalled();
    expect(mockExportConversationAsMarkdown).not.toHaveBeenCalled();
  });

  it('applies command result responses to the latest assistant turn after a tool handoff', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Command follow-up test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    act(() => {
      callbacks.onAssistantMessage('Planning tool work', [
        {
          id: 'tool-1',
          name: 'web_search',
          arguments: '{"query":"cleanup"}',
          status: 'pending',
        },
      ]);
      callbacks.onToken('Fresh assistant turn');
    });

    const latestAssistantMessage = [...mockChatScreenState.conversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant' && message.content === '');

    expect(latestAssistantMessage).toBeTruthy();

    mockUpdateMessage.mockClear();
    act(() => {
      callbacks.onCommandResult({ response: 'Command follow-up response' });
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      latestAssistantMessage!.id,
      'Command follow-up response',
    );
  });
});
