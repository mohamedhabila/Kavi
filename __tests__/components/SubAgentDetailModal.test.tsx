import React from 'react';
import { render } from '@testing-library/react-native';
import { SubAgentDetailModal } from '../../src/components/agents/SubAgentDetailModal';
import type { SubAgentSnapshot } from '../../src/types';

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

const now = Date.now();

function makeSnapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-root',
    parentConversationId: 'conv-1',
    name: 'Planner',
    depth: 0,
    startedAt: now - 10_000,
    updatedAt: now,
    status: 'running',
    sandboxPolicy: 'inherit',
    ...overrides,
  };
}

describe('SubAgentDetailModal', () => {
  it('renders the selected worker subtree and rollup summary', () => {
    const selected = makeSnapshot({ sessionId: 'sub-root', name: 'Planner' });
    const snapshots = [
      selected,
      makeSnapshot({
        sessionId: 'sub-child-a',
        parentSessionId: 'sub-root',
        name: 'Implementer',
        depth: 1,
        status: 'completed',
        sandboxPolicy: 'safe-only',
        output: 'Done.',
        iterations: 2,
        toolsUsed: ['read_file', 'file_edit'],
      }),
      makeSnapshot({
        sessionId: 'sub-child-b',
        parentSessionId: 'sub-root',
        name: 'Reviewer',
        depth: 1,
        status: 'error',
        sandboxPolicy: 'inherit',
      }),
    ];

    const { getAllByText, getByText, getByTestId } = render(
      <SubAgentDetailModal
        visible
        selectedSnapshot={selected}
        availableSnapshots={snapshots}
        onClose={jest.fn()}
      />,
    );

    expect(getAllByText('Planner').length).toBeGreaterThan(0);
    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getByTestId('sub-agent-rollup-card')).toBeTruthy();
    expect(getByText('Implementer')).toBeTruthy();
    expect(getByText('Reviewer')).toBeTruthy();
    expect(getByText('Workers')).toBeTruthy();
    expect(getByText('Issues')).toBeTruthy();
  });

  it('shows an empty state when there are no child workers', () => {
    const selected = makeSnapshot({ sessionId: 'sub-solo', name: 'Solo Worker' });
    const { getByText } = render(
      <SubAgentDetailModal
        visible
        selectedSnapshot={selected}
        availableSnapshots={[selected]}
        onClose={jest.fn()}
      />,
    );

    expect(getByText('No child workers yet.')).toBeTruthy();
  });
});
