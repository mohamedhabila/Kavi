import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
  memoizedChatInputType,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState } from '../../../testSupport/chatScreen/state';
import { createDefaultConversations } from '../../../testSupport/chatScreen/fixtures';
import {
  mockAddMessage,
  mockGetOrCreateCanonicalThread,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockGetProviderApiKey,
  mockRunOrchestrator,
  mockImportConversationWorkspaceAttachment,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen composer send flow', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('sends message and trigger orchestrator', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test message');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalled();
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('imports attachments into the workspace before storing the user turn', async () => {
    const attachment = {
      id: 'att-1',
      type: 'file',
      uri: 'file:///inbox/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    };
    mockImportConversationWorkspaceAttachment.mockImplementationOnce(
      async (_conversationId: string, candidate: any) => ({
        imported: true,
        attachment: {
          ...candidate,
          uri: 'file:///docs/workspace/attachments/files/att-1-report.pdf',
          workspacePath: 'attachments/files/att-1-report.pdf',
        },
      }),
    );

    const { UNSAFE_getByType } = render(<ChatScreen />);

    await act(async () => {
      await UNSAFE_getByType(memoizedChatInputType).props.onSend('Review this attachment', [
        attachment,
      ]);
    });

    await waitFor(() => {
      expect(mockImportConversationWorkspaceAttachment).toHaveBeenCalledWith('conv1', attachment);
      expect(mockAddMessage).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          role: 'user',
          content: 'Review this attachment',
          attachments: [
            expect.objectContaining({
              uri: 'file:///docs/workspace/attachments/files/att-1-report.pdf',
              workspacePath: 'attachments/files/att-1-report.pdf',
            }),
          ],
        }),
      );
      expect(mockRunOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
        }),
        expect.any(Object),
      );
    });
  });

  it('shows an error and aborts the send when attachment workspace import fails', async () => {
    mockImportConversationWorkspaceAttachment.mockRejectedValueOnce(new Error('boom'));
    const attachment = {
      id: 'att-2',
      type: 'file',
      uri: 'file:///inbox/broken.pdf',
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      size: 128,
    };

    const { UNSAFE_getByType, findByText } = render(<ChatScreen />);

    await act(async () => {
      await UNSAFE_getByType(memoizedChatInputType).props.onSend('Review this attachment', [
        attachment,
      ]);
    });

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(
      await findByText('Unable to add attached files to the workspace. Try again.'),
    ).toBeTruthy();
  });

  it('uses the canonical conversation when none is active', async () => {
    mockChatScreenState.activeConversationId = null;
    mockGetOrCreateCanonicalThread.mockReturnValueOnce('conv1');
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Hello');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockGetOrCreateCanonicalThread).toHaveBeenCalledWith(
        'openai',
        'You are helpful',
        'gpt-5.4',
        {
          activate: undefined,
          personaId: 'super-agent',
          mode: 'agentic',
        },
      );
      expect(mockAddMessage).toHaveBeenCalled();
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('shows error when no provider configured', async () => {
    mockChatScreenState.providersList = [];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No provider configured/);
    expect(error).toBeTruthy();
  });

  it('shows error when no API key configured', async () => {
    mockGetProviderApiKey.mockResolvedValue('');
    mockChatScreenState.providersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '', // no embedded key either
        model: 'gpt-5.4',
        enabled: true,
      },
    ];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No API key configured/);
    expect(error).toBeTruthy();
  });

  it('allows an on-device provider without requiring an API key', async () => {
    mockChatScreenState.activeConversationId = null;
    mockChatScreenState.activeProviderId = 'local-qwen';
    mockChatScreenState.activeModel = 'qwen-2.5-1.5b-instruct';
    mockChatScreenState.providersList = [
      {
        id: 'local-qwen',
        name: 'On-device models',
        kind: 'on-device',
        baseUrl: '',
        apiKey: '',
        model: 'qwen-2.5-1.5b-instruct',
        enabled: true,
        availableModels: ['qwen-2.5-1.5b-instruct'],
        local: { runtime: 'litert-lm' },
      },
    ];
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        id: 'conv1',
        providerId: 'local-qwen',
        model: 'qwen-2.5-1.5b-instruct',
      },
    ];
    mockGetOrCreateCanonicalThread.mockReturnValueOnce('conv1');
    mockGetProviderApiKey.mockResolvedValue('');

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Run locally');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockGetOrCreateCanonicalThread).toHaveBeenCalledWith(
        'local-qwen',
        'You are helpful',
        'qwen-2.5-1.5b-instruct',
        {
          activate: undefined,
          personaId: 'super-agent',
          mode: 'agentic',
        },
      );
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('shows error when no model selected', async () => {
    mockChatScreenState.activeModel = null;
    mockChatScreenState.providersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: '', // no model
        enabled: true,
      },
    ];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No model selected/);
    expect(error).toBeTruthy();
  });
});
