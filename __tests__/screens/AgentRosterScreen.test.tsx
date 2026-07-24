import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { AgentRosterScreen } from '../../src/screens/AgentRosterScreen';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

const mockOpenDrawer = jest.fn();
const mockNavigate = jest.fn();
const mockSetActiveConversation = jest.fn();
const mockCancelSubAgent = jest.fn();
let mockRouteParams: Record<string, unknown> = {};
let mockConversations: Array<{ id: string; title: string; agentRuns?: any[] }> = [
  { id: 'conv-1', title: 'Trip research' },
];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    openDrawer: mockOpenDrawer,
    navigate: mockNavigate,
    goBack: jest.fn(),
  }),
  useRoute: () => ({ name: 'AgentRoster', params: mockRouteParams }),
  useFocusEffect: jest.fn(),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: (selector: (state: any) => any) =>
    selector({
      conversations: mockConversations,
      setActiveConversation: mockSetActiveConversation,
    }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      panel: '#111',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      onDanger: '#fff',
      dangerSoft: '#300',
      success: '#0f0',
      overlay: 'rgba(0,0,0,0.5)',
      userBubble: '#060',
      assistantBubble: '#111',
      inputBackground: '#222',
      inputBorder: '#444',
      toolCard: '#111',
      toolCardHeader: '#222',
      codeBackground: '#000',
      link: '#0f0',
      onPrimaryLink: '#bfb',
      warning: '#ff0',
      warningBackground: '#332800',
      accent: '#0f0',
      info: '#0af',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/services/agents/personas', () => ({
  BUILT_IN_PERSONAS: [
    {
      id: 'default',
      name: 'Assistant',
      description: 'General assistant',
      systemPrompt: 'You are helpful.',
      icon: '🤖',
    },
  ],
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: (selector: (state: any) => any) =>
    selector({
      overrides: {},
      customPersonas: [],
      upsertCustomPersona: jest.fn(),
      removeCustomPersona: jest.fn(),
      setOverride: jest.fn(),
      clearOverride: jest.fn(),
    }),
}));

let mockSubAgents: SubAgentSnapshot[] = [];
let mockSubAgentListener:
  | ((agent: SubAgentSnapshot, event: 'started' | 'completed' | 'error') => void)
  | null = null;

jest.mock('../../src/services/agents/subAgent', () => ({
  cancelSubAgent: (...args: unknown[]) => mockCancelSubAgent(...args),
  listActiveSubAgents: jest.fn(() => mockSubAgents),
  onSubAgentEvent: jest.fn(
    (listener: (agent: SubAgentSnapshot, event: 'started' | 'completed' | 'error') => void) => {
      mockSubAgentListener = listener;
      return () => {
        if (mockSubAgentListener === listener) {
          mockSubAgentListener = null;
        }
      };
    },
  ),
}));

const now = Date.now();

function makeSubAgent(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-root',
    parentConversationId: 'conv-1',
    depth: 0,
    startedAt: now - 10_000,
    updatedAt: now,
    status: 'running',
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

describe('AgentRosterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubAgentListener = null;
    mockSubAgents = [];
    mockRouteParams = {};
    mockConversations = [{ id: 'conv-1', title: 'Trip research' }];
  });

  it('opens directly to guided delegated work when requested by Activity', () => {
    mockRouteParams = { initialTab: 'queue' };

    const { getByTestId, getByText, queryByTestId } = render(<AgentRosterScreen />);

    expect(getByText('No delegated work yet')).toBeTruthy();
    expect(getByTestId('delegated-work-tab').props.accessibilityState).toEqual({ selected: true });
    expect(queryByTestId('assistant-style-create')).toBeNull();
  });

  it('keeps style actions and tabs at accessible touch sizes', () => {
    const { getByLabelText, getByTestId } = render(<AgentRosterScreen />);

    expect(StyleSheet.flatten(getByTestId('assistant-styles-tab').props.style).minHeight).toBe(48);
    expect(StyleSheet.flatten(getByLabelText('Edit: Assistant').props.style).minHeight).toBe(44);
    expect(StyleSheet.flatten(getByLabelText('Reset: Assistant').props.style).minHeight).toBe(44);
  });

  it('groups a worker tree into one human-readable work card', () => {
    mockConversations = [
      {
        id: 'conv-1',
        title: 'Trip research',
        agentRuns: [
          {
            id: 'run-1',
            plan: {
              workstreams: [{ id: 'compare-options', title: 'Compare destinations' }],
            },
          },
        ],
      },
    ];
    mockSubAgents = [
      makeSubAgent({
        sessionId: 'sub-root',
        name: 'Planner',
        depth: 0,
        agentRunId: 'run-1',
        workstreamId: 'compare-options',
        currentActivity: 'Comparing the strongest options.',
      }),
      makeSubAgent({
        sessionId: 'sub-child',
        parentSessionId: 'sub-root',
        name: 'Implementer',
        depth: 1,
        status: 'completed',
        sandboxPolicy: 'safe-only',
        output: 'Done.',
      }),
    ];

    const { getByTestId, getByText, queryByText } = render(<AgentRosterScreen />);

    fireEvent.press(getByTestId('delegated-work-tab'));

    expect(getByText('Delegated work (1)')).toBeTruthy();
    expect(getByText('Compare destinations')).toBeTruthy();
    expect(getByText('From Trip research')).toBeTruthy();
    expect(getByText('2 delegated steps')).toBeTruthy();
    expect(getByText('Comparing the strongest options.')).toBeTruthy();
    expect(getByTestId('delegated-work-sub-root')).toBeTruthy();
    expect(queryByText('Planner')).toBeNull();
    expect(queryByText('Implementer')).toBeNull();
  });

  it('refreshes grouped work when lifecycle events arrive', () => {
    mockSubAgents = [makeSubAgent({ sessionId: 'sub-root', name: 'Planner' })];

    const { getByTestId, getByText, queryByTestId } = render(<AgentRosterScreen />);
    fireEvent.press(getByTestId('delegated-work-tab'));

    expect(getByText('Delegated work (1)')).toBeTruthy();
    expect(queryByTestId('delegated-work-sub-review')).toBeNull();
    expect(typeof mockSubAgentListener).toBe('function');

    mockSubAgents = [
      makeSubAgent({ sessionId: 'sub-root', name: 'Planner' }),
      makeSubAgent({
        sessionId: 'sub-review',
        name: 'Reviewer',
        depth: 0,
        status: 'running',
      }),
    ];

    act(() => {
      mockSubAgentListener?.(mockSubAgents[1], 'started');
    });

    expect(getByText('Delegated work (2)')).toBeTruthy();
    expect(getByTestId('delegated-work-sub-review')).toBeTruthy();
  });

  it('keeps worker and session details behind an explicit details action', () => {
    mockSubAgents = [
      makeSubAgent({
        sessionId: 'sub-root',
        name: 'Planner',
        depth: 0,
        iterations: 1,
        toolsUsed: ['sessions_spawn'],
      }),
      makeSubAgent({
        sessionId: 'sub-child',
        parentSessionId: 'sub-root',
        name: 'Implementer',
        depth: 1,
        status: 'completed',
        sandboxPolicy: 'safe-only',
        output: 'Done.',
        iterations: 2,
        toolsUsed: ['read_file'],
      }),
    ];

    const { getAllByText, getByTestId } = render(<AgentRosterScreen />);
    fireEvent.press(getByTestId('delegated-work-tab'));

    fireEvent.press(getByTestId('delegated-work-details-sub-root'));

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
  });

  it('returns completed work to its source conversation', () => {
    mockSubAgents = [
      makeSubAgent({
        status: 'completed',
        launchState: 'terminal',
        output: 'The comparison is ready.',
      }),
    ];
    const { getByTestId } = render(<AgentRosterScreen />);
    fireEvent.press(getByTestId('delegated-work-tab'));

    fireEvent.press(getByTestId('delegated-work-open-chat-sub-root'));

    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-1');
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('prepares failed work as an editable chat retry instead of running it directly', () => {
    mockSubAgents = [makeSubAgent({ status: 'error', launchState: 'terminal' })];
    const { getByTestId } = render(<AgentRosterScreen />);
    fireEvent.press(getByTestId('delegated-work-tab'));

    fireEvent.press(getByTestId('delegated-work-retry-sub-root'));

    expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-1');
    expect(mockNavigate).toHaveBeenCalledWith('Chat', {
      preparedDraft: expect.objectContaining({
        conversationId: 'conv-1',
        source: 'delegated-work-retry',
      }),
    });
    expect(mockCancelSubAgent).not.toHaveBeenCalled();
  });

  it('confirms before stopping every running step, deepest first', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockSubAgents = [
      makeSubAgent({ sessionId: 'sub-root', depth: 0 }),
      makeSubAgent({ sessionId: 'sub-child', parentSessionId: 'sub-root', depth: 1 }),
    ];
    const { getByTestId } = render(<AgentRosterScreen />);
    fireEvent.press(getByTestId('delegated-work-tab'));

    fireEvent.press(getByTestId('delegated-work-stop-sub-root'));
    expect(mockCancelSubAgent).not.toHaveBeenCalled();

    const destructiveAction = alertSpy.mock.calls[0]?.[2]?.find(
      (action) => action.style === 'destructive',
    );
    act(() => destructiveAction?.onPress?.());

    expect(mockCancelSubAgent.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      'sub-child',
      'sub-root',
    ]);
    alertSpy.mockRestore();
  });
});
