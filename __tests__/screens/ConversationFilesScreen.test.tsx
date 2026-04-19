import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ConversationFilesScreen } from '../../src/screens/ConversationFilesScreen';

const mockNavigate = jest.fn();
const mockHandleBack = jest.fn();
const mockUseBackToChat = jest.fn(() => mockHandleBack);
const mockUseFocusEffect = jest.fn();
const mockListActiveSubAgents = jest.fn(() => []);
const mockOnSubAgentEvent = jest.fn(() => jest.fn());
let capturedFocusEffect: (() => void | (() => void)) | undefined;
let capturedSubAgentListener: ((agent: any, event: any) => void) | undefined;
let mockRouteParams: any = {};
let mockActiveConversationId: string | null = 'conv-active';
let mockConversations: any[] = [];
let capturedConversationFilesProps: any = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (effect: any) => {
    capturedFocusEffect = effect;
    return mockUseFocusEffect(effect);
  },
}));

jest.mock('@react-navigation/drawer', () => ({
  DrawerNavigationProp: {},
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: (...args: any[]) => mockUseBackToChat(...args),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: () => mockListActiveSubAgents(),
  onSubAgentEvent: (listener: any) => {
    capturedSubAgentListener = listener;
    return mockOnSubAgentEvent(listener);
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: any) =>
    selector({ activeConversationId: mockActiveConversationId, conversations: mockConversations }),
}));

jest.mock('../../src/components/files/ConversationFiles', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  return {
    ConversationFiles: (props: any) => {
      capturedConversationFilesProps = props;
      return (
        <View>
          <Text>{props.conversationId ?? 'no-conversation'}</Text>
          {props.initialFilePath ? <Text>{`file:${props.initialFilePath}`}</Text> : null}
          {props.initialDirectoryPath !== undefined ? (
            <Text>{`dir:${props.initialDirectoryPath}`}</Text>
          ) : null}
          <TouchableOpacity
            onPress={() => props.onOpenTextFile?.('src/App.tsx', 'console.log(1);')}
          >
            <Text>open-text-file</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => props.onOpenTextFile?.('README.md', '# readme')}>
            <Text>open-root-file</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => props.onClose?.()}>
            <Text>close-files</Text>
          </TouchableOpacity>
        </View>
      );
    },
  };
});

describe('ConversationFilesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedFocusEffect = undefined;
    capturedSubAgentListener = undefined;
    mockRouteParams = {};
    mockActiveConversationId = 'conv-active';
    mockConversations = [];
    capturedConversationFilesProps = null;
    mockUseFocusEffect.mockImplementation(() => undefined);
    mockListActiveSubAgents.mockReturnValue([]);
    mockOnSubAgentEvent.mockReset();
    mockOnSubAgentEvent.mockImplementation(() => jest.fn());
    mockUseBackToChat.mockReset();
    mockUseBackToChat.mockImplementation(() => mockHandleBack);
    mockHandleBack.mockReset();
  });

  it('falls back to the active conversation and wires the shared back handler', () => {
    const { getByText } = render(<ConversationFilesScreen />);

    expect(capturedConversationFilesProps).toEqual(
      expect.objectContaining({
        visible: true,
        presentation: 'screen',
        conversationId: 'conv-active',
        onClose: mockHandleBack,
      }),
    );

    fireEvent.press(getByText('close-files'));
    expect(mockHandleBack).toHaveBeenCalledTimes(1);
  });

  it('passes fallback workspace session ids derived from the conversation history', () => {
    mockConversations = [
      {
        id: 'conv-active',
        messages: [
          {
            id: 'msg-sub-agent',
            role: 'assistant',
            content: 'Worker update',
            timestamp: 1,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId: 'session-1',
                parentConversationId: 'conv-active',
                depth: 1,
                startedAt: 1,
                updatedAt: 1,
                status: 'running',
                sandboxPolicy: 'inherit',
              },
            },
          },
        ],
        usage: {
          entries: [{ sessionId: 'session-2' }],
        },
        agentRuns: [
          {
            id: 'run-1',
            evidence: [{ id: 'e1', workerSessionId: 'session-3' }],
          },
        ],
      },
    ];

    render(<ConversationFilesScreen />);

    expect(capturedConversationFilesProps).toEqual(
      expect.objectContaining({
        conversationId: 'conv-active',
        fallbackConversationIds: ['session-1', 'session-2', 'session-3'],
      }),
    );
  });

  it('includes live sub-agent workspace ids and passes a refresh token to the explorer', () => {
    mockConversations = [
      {
        id: 'conv-active',
        messages: [],
        usage: { entries: [] },
        updatedAt: 123,
      },
    ];
    mockListActiveSubAgents.mockReturnValue([
      {
        sessionId: 'session-live',
        parentConversationId: 'conv-active',
        depth: 1,
        startedAt: 1,
        updatedAt: 2,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ]);

    render(<ConversationFilesScreen />);

    expect(capturedConversationFilesProps).toEqual(
      expect.objectContaining({
        conversationId: 'conv-active',
        fallbackConversationIds: ['session-live'],
        refreshToken: '123:0',
      }),
    );
  });

  it('bumps the refresh token when the screen regains focus', () => {
    mockConversations = [
      {
        id: 'conv-active',
        messages: [],
        usage: { entries: [] },
        updatedAt: 123,
      },
    ];

    render(<ConversationFilesScreen />);

    expect(capturedConversationFilesProps.refreshToken).toBe('123:0');
    expect(capturedFocusEffect).toBeDefined();

    act(() => {
      capturedFocusEffect?.();
    });

    expect(capturedConversationFilesProps.refreshToken).toBe('123:1');
  });

  it('bumps the refresh token when a live worker event targets the active conversation', () => {
    mockConversations = [
      {
        id: 'conv-active',
        messages: [],
        usage: { entries: [] },
        updatedAt: 123,
      },
    ];
    mockListActiveSubAgents.mockReturnValue([
      {
        sessionId: 'session-live',
        parentConversationId: 'conv-active',
        depth: 1,
        startedAt: 1,
        updatedAt: 2,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ]);

    render(<ConversationFilesScreen />);

    expect(capturedConversationFilesProps.refreshToken).toBe('123:0');
    expect(capturedSubAgentListener).toBeDefined();

    act(() => {
      capturedSubAgentListener?.(
        {
          sessionId: 'session-live',
          parentConversationId: 'conv-active',
        },
        'progress',
      );
    });

    expect(capturedConversationFilesProps.refreshToken).toBe('123:1');
  });

  it('ignores worker events owned by a different conversation', () => {
    mockConversations = [
      {
        id: 'conv-active',
        messages: [],
        usage: { entries: [] },
        updatedAt: 123,
      },
    ];
    mockListActiveSubAgents.mockReturnValue([
      {
        sessionId: 'session-other',
        parentConversationId: 'conv-other',
        depth: 1,
        startedAt: 1,
        updatedAt: 2,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ]);

    render(<ConversationFilesScreen />);

    act(() => {
      capturedSubAgentListener?.(
        {
          sessionId: 'session-other',
          parentConversationId: 'conv-other',
        },
        'progress',
      );
    });

    expect(capturedConversationFilesProps.refreshToken).toBe('123:0');
  });

  it('opens the editor with a return target for the current directory', () => {
    mockRouteParams = {
      conversationId: 'conv-1',
      initialDirectoryPath: 'src',
    };

    const { getByText } = render(<ConversationFilesScreen />);

    fireEvent.press(getByText('open-text-file'));

    expect(mockNavigate).toHaveBeenCalledWith('CodeEditor', {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'src/App.tsx',
      content: 'console.log(1);',
      returnToConversationFiles: {
        conversationId: 'conv-1',
        initialDirectoryPath: 'src',
      },
    });
  });

  it('opens root-level files with an empty return directory path', () => {
    mockRouteParams = {
      conversationId: 'conv-1',
    };

    const { getByText } = render(<ConversationFilesScreen />);

    fireEvent.press(getByText('open-root-file'));

    expect(mockNavigate).toHaveBeenCalledWith('CodeEditor', {
      source: 'local',
      conversationId: 'conv-1',
      filePath: 'README.md',
      content: '# readme',
      returnToConversationFiles: {
        conversationId: 'conv-1',
        initialDirectoryPath: '',
      },
    });
  });

  it('does not navigate to the editor when no conversation workspace is available', () => {
    mockActiveConversationId = null;

    const { getByText } = render(<ConversationFilesScreen />);

    fireEvent.press(getByText('open-text-file'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(capturedConversationFilesProps).toEqual(
      expect.objectContaining({
        conversationId: null,
        fallbackConversationIds: [],
      }),
    );
  });
});
