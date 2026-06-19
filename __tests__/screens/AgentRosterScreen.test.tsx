import { act, fireEvent, render } from '@testing-library/react-native';
import { AgentRosterScreen } from '../../src/screens/AgentRosterScreen';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

const mockOpenDrawer = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    openDrawer: mockOpenDrawer,
    navigate: jest.fn(),
    goBack: jest.fn(),
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
  });

  it('renders a nested sub-agent queue using hierarchy cards', () => {
    mockSubAgents = [
      makeSubAgent({ sessionId: 'sub-root', name: 'Planner', depth: 0 }),
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

    const { getByText, getByTestId } = render(<AgentRosterScreen />);

    fireEvent.press(getByText('Queue (2)'));

    expect(getByText('Planner')).toBeTruthy();
    expect(getByText('Implementer')).toBeTruthy();
    expect(getByTestId('sub-agent-card-depth-0')).toBeTruthy();
    expect(getByTestId('sub-agent-card-depth-1')).toBeTruthy();
  });

  it('refreshes the queue when sub-agent events arrive', () => {
    mockSubAgents = [makeSubAgent({ sessionId: 'sub-root', name: 'Planner' })];

    const { getByText, queryByText } = render(<AgentRosterScreen />);
    fireEvent.press(getByText('Queue (1)'));

    expect(queryByText('Reviewer')).toBeNull();
    expect(typeof mockSubAgentListener).toBe('function');

    mockSubAgents = [
      makeSubAgent({ sessionId: 'sub-root', name: 'Planner' }),
      makeSubAgent({
        sessionId: 'sub-review',
        parentSessionId: 'sub-root',
        name: 'Reviewer',
        depth: 1,
        status: 'running',
      }),
    ];

    act(() => {
      mockSubAgentListener?.(mockSubAgents[1], 'started');
    });

    expect(getByText('Reviewer')).toBeTruthy();
  });

  it('opens a filtered worker detail modal from the queue', () => {
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

    const { getAllByText, getAllByTestId, getByText } = render(<AgentRosterScreen />);
    fireEvent.press(getByText('Queue (2)'));

    fireEvent.press(getAllByTestId('sub-agent-open-details')[0]);

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
  });
});
