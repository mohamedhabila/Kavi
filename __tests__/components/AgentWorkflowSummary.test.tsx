import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AgentWorkflowSummary } from '../../src/components/chat/AgentWorkflowSummary';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../src/engine/graph/graphObservability';
import type { AgentRun, AgentRunControlGraphState } from '../../src/types/agentRun';

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'chat.agentWorkflow.currentWork': 'Current work',
        'chat.agentGoals.header': 'Goals ({count})',
        'chat.agentGoals.bootstrapPending': 'Goals pending bootstrap',
        'chat.agentGoals.evidenceCount': '{count} evidence',
        'chat.agentGoals.status.running': 'Running',
        'chat.agentGoals.status.completed': 'Completed',
        'chat.agentGoals.status.failed': 'Failed',
        'chat.agentGoals.status.cancelled': 'Cancelled',
        'chat.agentGoals.goalStatus.pending': 'Pending',
        'chat.agentGoals.goalStatus.active': 'Active',
        'chat.agentGoals.goalStatus.completed': 'Completed',
        'chat.agentGoals.goalStatus.blocked': 'Blocked',
        'chat.agentRunTrace.header': 'Run trace',
        'chat.agentRunTrace.preview': 'Iteration {iteration} · {count} events',
        'chat.agentRunTrace.iteration': 'Iteration {iteration}',
      };
      return Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, String(value)),
        translations[key] ?? key,
      );
    },
  }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      surface: '#111',
      surfaceAlt: '#222',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
    },
  }),
}));

const makeControlGraph = (
  overrides: Partial<AgentRunControlGraphState> = {},
): AgentRunControlGraphState => ({
  version: 1,
  status: 'ready',
  iteration: 2,
  expectedToolCalls: [],
  observedToolResults: [],
  pendingAsyncCount: 0,
  lastModelToolNames: [],
  goals: [
    {
      id: 'goal-audit',
      title: 'Audit the repository',
      status: 'active',
      dependencies: [],
      evidence: ['read_file'],
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'goal-fix',
      title: 'Apply the fix',
      status: 'pending',
      dependencies: ['goal-audit'],
      evidence: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  asyncWork: {
    awaitingBackgroundWorkers: false,
    pendingOperations: [],
    updatedAt: 2,
  },
  performance: {
    modelTurnCount: 1,
    modelDurationMs: 10,
    toolExecutionCount: 1,
    toolExecutionDurationMs: 10,
    lastCandidateToolCount: 2,
    lastActiveToolCount: 2,
    maxActiveToolCount: 2,
    lastActiveToolTokenEstimate: 120,
    maxActiveToolTokenEstimate: 120,
    updatedAt: 2,
  },
  turnDirectives: {
    forceFinalText: false,
    requireWorkflowTool: false,
    incompleteFinalTextRecoveryCount: 0,
  },
  audit: [
    {
      type: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED,
      iteration: 1,
      timestamp: 100,
      detail: 'count:2,tokens:100,tools:read_file,web_search',
    },
    {
      type: GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE,
      iteration: 2,
      timestamp: 200,
      detail: 'decision:hold,reason:goals_incomplete',
    },
  ],
  updatedAt: 2,
  ...overrides,
});

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  userMessageId: 'user-1',
  goal: 'Audit the repository and apply the fix.',
  status: 'running',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  currentPhase: 'work',
  phases: [
    { key: 'assess', title: 'Assess', status: 'completed', updatedAt: 1 },
    { key: 'work', title: 'Work', status: 'active', detail: 'Inspect and patch.', updatedAt: 2 },
    { key: 'review', title: 'Review', status: 'pending', updatedAt: 3 },
    { key: 'deliver', title: 'Deliver', status: 'pending', updatedAt: 4 },
  ],
  checkpoints: [],
  controlGraph: makeControlGraph(),
  summary: {
    assistantTurns: 1,
    startedTools: 1,
    completedTools: 0,
    failedTools: 0,
    spawnedSubAgents: 0,
  },
  ...overrides,
});

const expectMobileToggle = (node: { props: { style: unknown } }) => {
  expect(StyleSheet.flatten(node.props.style)).toEqual(expect.objectContaining({ minHeight: 44 }));
};

describe('AgentWorkflowSummary', () => {
  it('keeps current work primary while goals and trace details stay collapsed by default', () => {
    const screen = render(<AgentWorkflowSummary run={makeRun()} />);

    expect(screen.getByTestId('agent-workflow-summary')).toBeTruthy();
    expect(screen.getByText('Current work')).toBeTruthy();
    expect(screen.getByText('Audit the repository')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByText('Apply the fix')).toBeNull();
    expect(screen.queryByTestId('agent-goals-details')).toBeNull();
    expect(screen.queryByTestId('agent-run-trace-details')).toBeNull();
    expectMobileToggle(screen.getByTestId('agent-goals-toggle'));
    expectMobileToggle(screen.getByTestId('agent-run-trace-toggle'));

    fireEvent.press(screen.getByTestId('agent-goals-toggle'));
    expect(screen.getByTestId('agent-goals-item-goal-audit')).toBeTruthy();
    expect(screen.getByText('Apply the fix')).toBeTruthy();

    fireEvent.press(screen.getByTestId('agent-run-trace-toggle'));
    expect(screen.getByTestId('agent-run-trace-iteration-1')).toBeTruthy();
    expect(screen.getByTestId('agent-run-trace-iteration-2')).toBeTruthy();
    expect(screen.getByText(GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED)).toBeTruthy();
    expect(screen.getByText(GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE)).toBeTruthy();
  });

  it('keeps completed work compact while preserving expandable evidence', () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({
          status: 'completed',
          currentPhase: 'deliver',
          phases: [
            { key: 'work', title: 'Work', status: 'completed', updatedAt: 2 },
            { key: 'deliver', title: 'Deliver', status: 'completed', updatedAt: 3 },
          ],
          controlGraph: makeControlGraph({
            goals: [
              {
                id: 'goal-done',
                title: 'Verified the answer',
                status: 'completed',
                dependencies: [],
                evidence: ['review'],
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          }),
        })}
      />,
    );

    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText('Verified the answer')).toBeTruthy();
    expect(screen.queryByTestId('agent-goals-details')).toBeNull();

    fireEvent.press(screen.getByTestId('agent-goals-toggle'));
    expect(screen.getByText(/1 evidence/)).toBeTruthy();
  });

  it('renders bootstrap state without opening an empty details surface', () => {
    const screen = render(
      <AgentWorkflowSummary run={makeRun({ controlGraph: makeControlGraph({ goals: [] }) })} />,
    );

    expect(screen.getByTestId('agent-goals-widget')).toBeTruthy();
    expect(screen.getAllByText('Goals pending bootstrap')).toHaveLength(1);
    expect(screen.queryByTestId('agent-goals-toggle')).toBeNull();
    expect(screen.queryByTestId('agent-goals-details')).toBeNull();
  });
});
