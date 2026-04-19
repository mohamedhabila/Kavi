import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SubAgentActivityCard } from '../../src/components/agents/SubAgentActivityCard';
import type { SubAgentSnapshot } from '../../src/types';

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

const now = Date.now();

function makeSnapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1234567890abcdef',
    parentConversationId: 'conv-1',
    parentSessionId: 'sub-root',
    name: 'Backend Architect',
    depth: 2,
    startedAt: now - 20_000,
    updatedAt: now,
    status: 'completed',
    sandboxPolicy: 'safe-only',
    output: 'Worker finished the implementation and validated the tests.',
    toolsUsed: ['read_file', 'file_edit'],
    iterations: 2,
    ...overrides,
  };
}

describe('SubAgentActivityCard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders a nested transcript card with summary metadata', () => {
    const { getByText, getByTestId } = render(
      <SubAgentActivityCard snapshot={makeSnapshot()} event="completed" visualDepth={2} />,
    );

    expect(getByText('Backend Architect')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Session sub-1234567890abc...')).toBeTruthy();
    expect(getByText('Depth 2')).toBeTruthy();
    expect(getByText('Safe only')).toBeTruthy();
    expect(getByText('2 tools')).toBeTruthy();
    expect(getByTestId('sub-agent-card-depth-2')).toBeTruthy();
    expect(getByTestId('sub-agent-summary')).toBeTruthy();
  });

  it('expands to show parent linkage and full output', () => {
    const { getByTestId, getByText } = render(
      <SubAgentActivityCard snapshot={makeSnapshot()} event="completed" visualDepth={2} />,
    );

    fireEvent.press(getByTestId('sub-agent-toggle'));

    expect(getByTestId('sub-agent-details')).toBeTruthy();
    expect(getByText('Nested under sub-root')).toBeTruthy();
    expect(getByText('Worker finished the implementation and validated the tests.')).toBeTruthy();
    expect(getByText('Worker finished')).toBeTruthy();
  });

  it('renders queue cards without lifecycle event text', () => {
    const { queryByText, getByText } = render(
      <SubAgentActivityCard
        snapshot={makeSnapshot({
          status: 'running',
          output: undefined,
          iterations: undefined,
          toolsUsed: undefined,
          currentActivity: 'Reading repository files',
          activeToolName: 'read_file',
        })}
        visualDepth={0}
        variant="queue"
      />,
    );

    expect(getByText('Running')).toBeTruthy();
    expect(getByText('Reading repository files')).toBeTruthy();
    expect(getByText('read_file')).toBeTruthy();
    expect(queryByText('Worker finished')).toBeNull();
  });

  it('shows explicit timeout lifecycle text instead of a generic failure label', () => {
    const { getAllByText, getByTestId, queryByText } = render(
      <SubAgentActivityCard
        snapshot={makeSnapshot({
          status: 'timeout',
          output: 'Worker hit the deadline while waiting on a remote run.',
        })}
        event="timeout"
      />,
    );

    fireEvent.press(getByTestId('sub-agent-toggle'));

    expect(getAllByText('Timed out').length).toBeGreaterThan(0);
    expect(queryByText('Worker ended with an error')).toBeNull();
  });

  it('updates elapsed time while a worker is still running', () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-04-02T00:00:00.000Z').getTime();
    jest.setSystemTime(startedAt);

    const { getByText } = render(
      <SubAgentActivityCard
        snapshot={makeSnapshot({
          status: 'running',
          startedAt,
          updatedAt: startedAt,
          output: undefined,
        })}
        variant="queue"
      />,
    );

    expect(getByText('1s')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(getByText('3s')).toBeTruthy();
  });

  it('renders inline rollup summaries and opens the detail view action', () => {
    const onOpenDetails = jest.fn();
    const { getByText, getByTestId } = render(
      <SubAgentActivityCard
        snapshot={makeSnapshot({ depth: 0, status: 'running', output: undefined })}
        variant="queue"
        showOpenDetailsAction
        onOpenDetails={onOpenDetails}
        rollup={{
          rootSessionId: 'sub-1234567890abcdef',
          totalAgents: 4,
          descendantCount: 3,
          runningCount: 1,
          completedCount: 2,
          cancelledCount: 0,
          timeoutCount: 0,
          errorCount: 1,
          totalIterations: 5,
          totalToolUses: 6,
          deepestDepth: 2,
          latestUpdatedAt: now,
        }}
      />,
    );

    expect(getByTestId('sub-agent-rollup-strip')).toBeTruthy();
    expect(getByText('4 workers')).toBeTruthy();
    expect(getByText('1 running')).toBeTruthy();
    expect(getByText('2 completed')).toBeTruthy();
    expect(getByText('1 issue')).toBeTruthy();

    fireEvent.press(getByTestId('sub-agent-open-details'));
    expect(onOpenDetails).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sub-1234567890abcdef' }),
    );
  });
});
