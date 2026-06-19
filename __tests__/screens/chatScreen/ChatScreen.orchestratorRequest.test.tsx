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
import {
  mockSetAgentRunPhase,
  mockAppendAgentRunCheckpoint,
  mockUpdateAgentRunControlGraph,
} from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen orchestrator requests', () => {
  beforeEach(resetChatScreenTestEnvironment);
  afterEach(cleanupChatScreenTestEnvironment);

  it('calls orchestrator with correct callbacks', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Run orchestrator');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    // Verify the callbacks object structure
    const [options, callbacks] = mockRunOrchestrator.mock.calls[0];
    expect(options.provider).toBeDefined();
    expect(options.model).toBe('gpt-5.4');
    expect(options.systemPrompt).toBe('You are helpful');
    expect(typeof callbacks.onToken).toBe('function');
    expect(typeof callbacks.onReasoning).toBe('function');
    expect(typeof callbacks.onAssistantStreamReset).toBe('function');
    expect(typeof callbacks.onUserMessageEnriched).toBe('function');
    expect(typeof callbacks.onToolCallQueued).toBe('function');
    expect(typeof callbacks.onToolCallStart).toBe('function');
    expect(typeof callbacks.onToolCallComplete).toBe('function');
    expect(typeof callbacks.onAssistantMessage).toBe('function');
    expect(typeof callbacks.onToolMessage).toBe('function');
    expect(typeof callbacks.onError).toBe('function');
    expect(typeof callbacks.onDone).toBe('function');
    expect(typeof callbacks.onUsage).toBe('function');
    expect(typeof callbacks.onStateChange).toBe('function');
  });

  it('syncs lean graph state without workflow route presentation side effects', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Run with graph goals');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockAppendAgentRunCheckpoint.mockClear();
    mockSetAgentRunPhase.mockClear();
    mockUpdateAgentRunControlGraph.mockClear();

    const baseGraph = {
      version: 1,
      status: 'ready',
      iteration: 1,
      expectedToolCalls: [],
      observedToolResults: [],
      pendingAsyncCount: 0,
      lastModelToolNames: [],
      activeTaskId: 'goal-persist',
      goals: [
        {
          id: 'goal-persist',
          title: 'Persist artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_100,
        },
      ],
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
      audit: [],
      updatedAt: 1_700_000_000_100,
    };

    act(() => {
      callbacks.onAgentControlGraphStateChange(baseGraph);
    });

    expect(mockUpdateAgentRunControlGraph).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        activeTaskId: 'goal-persist',
        goals: expect.arrayContaining([
          expect.objectContaining({ id: 'goal-persist', status: 'active' }),
        ]),
      }),
      'run-1',
    );
    expect(mockSetAgentRunPhase).not.toHaveBeenCalled();
    expect(mockAppendAgentRunCheckpoint).not.toHaveBeenCalled();
  });

  it('uses the active selected model when the conversation has no stored model override', async () => {
    mockChatScreenState.activeModel = 'gpt-4o-mini';
    mockChatScreenState.providersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.4',
        enabled: true,
        availableModels: ['gpt-5.4', 'gpt-4o-mini'],
      },
    ];
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        providerId: 'openai',
        modelOverride: undefined,
      },
    ];

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Use selected model');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [options] = mockRunOrchestrator.mock.calls[0];
    expect(options.model).toBe('gpt-4o-mini');
  });

  it('keeps the active selected model when provider availableModels is stale', async () => {
    mockChatScreenState.activeModel = 'gpt-5.5';
    mockChatScreenState.providersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.4',
        enabled: true,
        availableModels: ['gpt-5.4', 'gpt-5-mini'],
      },
    ];
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        providerId: 'openai',
        modelOverride: undefined,
      },
    ];

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Use latest selected model');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [options] = mockRunOrchestrator.mock.calls[0];
    expect(options.model).toBe('gpt-5.5');
  });

  it('passes the selected thinking level into the orchestrator request', async () => {
    mockChatScreenState.defaultConversationMode = 'chitchat';
    mockChatScreenState.thinkingLevel = 'high';

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Use direct mode thinking');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [options] = mockRunOrchestrator.mock.calls[0];
    expect(options.thinkingLevel).toBe('high');
  });
});
