import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ProactiveTaskSuggestionBanner } from '../../src/components/chat/ProactiveTaskSuggestionBanner';
import { STORAGE_KEYS } from '../../src/constants/storage';
import { useProactiveProposalStore } from '../../src/services/agents/proactiveProposalStore';
import type { Conversation } from '../../src/types/conversation';

const NOW = 1_800_000_000_000;

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      border: '#333',
      onPrimary: '#fff',
      primary: '#09f',
      surface: '#111',
      text: '#fff',
      textSecondary: '#ccc',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.proactiveTaskSuggestionTitle': 'Pick up unfinished work?',
        'chat.proactiveTaskSuggestionBody':
          'A task you explicitly started in this chat ended before it was complete.',
        'chat.proactiveTaskSuggestionContinue': 'Prepare continuation',
        'chat.proactiveTaskSuggestionDismiss': "Don't suggest this again",
      })[key] ?? key,
  }),
}));

function failedConversation(): Conversation {
  return {
    id: 'conversation-owner',
    title: 'Sensitive medical conversation',
    providerId: 'provider',
    systemPrompt: 'system',
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    messages: [
      {
        id: 'message-user',
        role: 'user',
        content: 'Handle my sensitive medical and financial details.',
        timestamp: NOW - 5_000,
      },
    ],
    agentRuns: [
      {
        id: 'run-failed',
        userMessageId: 'message-user',
        goal: 'Handle my sensitive medical and financial details.',
        status: 'failed',
        createdAt: NOW - 5_000,
        updatedAt: NOW - 1_000,
        completedAt: NOW - 1_000,
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
  };
}

describe('ProactiveTaskSuggestionBanner', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.PROACTIVE_PROPOSALS);
    useProactiveProposalStore.setState({ receipts: {}, presentedThisSession: {} });
    await act(async () => {
      await useProactiveProposalStore.persist.rehydrate();
    });
  });

  it('shows only generic copy and persists dismissal for the exact proposal', async () => {
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ProactiveTaskSuggestionBanner
        conversation={failedConversation()}
        enabled
        now={() => NOW}
        onContinue={jest.fn()}
      />,
    );

    await waitFor(() => expect(getByTestId('proactive-task-suggestion')).toBeTruthy());
    expect(getByText('Pick up unfinished work?')).toBeTruthy();
    expect(queryByText(/medical/i)).toBeNull();
    expect(queryByText(/financial/i)).toBeNull();

    fireEvent.press(getByTestId('proactive-task-suggestion-dismiss'));

    await waitFor(() => expect(queryByTestId('proactive-task-suggestion')).toBeNull());
    expect(Object.values(useProactiveProposalStore.getState().receipts)).toEqual([
      expect.objectContaining({
        conversationId: 'conversation-owner',
        runId: 'run-failed',
        disposition: 'dismissed',
        presentationCount: 1,
      }),
    ]);
  });

  it('requires a user press, records acceptance, and delegates only the draft preparation', async () => {
    const onContinue = jest.fn();
    const { getByTestId } = render(
      <ProactiveTaskSuggestionBanner
        conversation={failedConversation()}
        enabled
        now={() => NOW}
        onContinue={onContinue}
      />,
    );

    await waitFor(() => expect(getByTestId('proactive-task-suggestion')).toBeTruthy());
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('proactive-task-suggestion-continue'));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(Object.values(useProactiveProposalStore.getState().receipts)).toEqual([
      expect.objectContaining({ disposition: 'accepted', respondedAt: NOW }),
    ]);
  });

  it('does not render while disabled by lifecycle or allow a busy action', async () => {
    const onContinue = jest.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <ProactiveTaskSuggestionBanner
        conversation={failedConversation()}
        enabled={false}
        now={() => NOW}
        onContinue={onContinue}
      />,
    );
    expect(queryByTestId('proactive-task-suggestion')).toBeNull();

    rerender(
      <ProactiveTaskSuggestionBanner
        conversation={failedConversation()}
        disabled
        enabled
        now={() => NOW}
        onContinue={onContinue}
      />,
    );
    await waitFor(() => expect(getByTestId('proactive-task-suggestion')).toBeTruthy());

    fireEvent.press(getByTestId('proactive-task-suggestion-continue'));
    expect(onContinue).not.toHaveBeenCalled();
  });
});
