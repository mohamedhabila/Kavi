import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { mockAddMessage } from '../../../testSupport/chatScreen/storeMocks';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';
import { useProactiveProposalStore } from '../../../src/services/agents/proactiveProposalStore';

describe('ChatScreen proactive failed-task suggestion', () => {
  beforeEach(() => {
    resetChatScreenTestEnvironment();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    useProactiveProposalStore.setState({ receipts: {}, presentedThisSession: {} });
  });

  afterEach(() => {
    cleanupChatScreenTestEnvironment();
    useProactiveProposalStore.setState({ receipts: {}, presentedThisSession: {} });
  });

  it('prepares an editable continuation request without starting work automatically', async () => {
    const now = Date.now();
    mockChatScreenState.conversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'failed-task-user',
            role: 'user',
            content: 'Sensitive task details remain private.',
            timestamp: now - 5_000,
          },
          {
            id: 'failed-task-assistant',
            role: 'assistant',
            content: 'The task did not finish.',
            timestamp: now - 1_000,
          },
        ],
        agentRuns: [
          {
            id: 'failed-run',
            userMessageId: 'failed-task-user',
            goal: 'Sensitive task details remain private.',
            status: 'failed',
            createdAt: now - 5_000,
            updatedAt: now - 1_000,
            completedAt: now - 1_000,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 1,
              spawnedSubAgents: 0,
            },
          },
        ],
        activeAgentRunId: undefined,
      },
    ];
    await act(async () => {
      await useProactiveProposalStore.persist.rehydrate();
    });

    const screen = render(<ChatScreen />);
    await waitFor(() => expect(screen.getByTestId('proactive-task-suggestion')).toBeTruthy());

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('proactive-task-suggestion-continue'));

    expect(
      screen.getByDisplayValue(
        'Continue the unfinished task from this conversation. Review its current state before taking any new action.',
      ),
    ).toBeTruthy();
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
});
