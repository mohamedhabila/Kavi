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
        'chat.agentPlan.header': 'Plan ({count} steps)',
        'chat.agentPlan.status.running': 'Running',
        'chat.agentPlan.status.waitingForYou': 'Waiting for you',
        'chat.agentPlan.status.needsAttention': 'Needs attention',
        'chat.agentPlan.status.completed': 'Completed',
        'chat.agentPlan.status.failed': 'Failed',
        'chat.agentPlan.status.cancelled': 'Cancelled',
        'chat.agentPlan.stepStatus.pending': 'Pending',
        'chat.agentPlan.stepStatus.inProgress': 'In progress',
        'chat.agentPlan.stepStatus.completed': 'Done',
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
  plan: [
    { step: 'Audit the repository', status: 'in_progress' },
    { step: 'Apply the fix', status: 'pending' },
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
      detail: 'decision:hold,reason:async_waiting_finalization_hold',
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
  expect(StyleSheet.flatten(node.props.style)).toEqual(expect.objectContaining({ minHeight: 48 }));
};

describe('AgentWorkflowSummary', () => {
  it('never shows the engine trace', () => {
    // Regression: the trace listed raw graph event names such as MODEL_TURN_STARTED in
    // every agentic chat.
    const screen = render(<AgentWorkflowSummary run={makeRun()} />);
    expect(screen.queryByTestId('agent-run-trace-widget')).toBeNull();
  });

  it("shows the plan in the model's words and titles the card with the current step", () => {
    const screen = render(<AgentWorkflowSummary run={makeRun()} />);

    expect(screen.getByText('Audit the repository')).toBeTruthy();
    expect(screen.getByTestId('agent-plan-toggle').props.accessibilityLabel).toBe('Plan (2 steps)');
    expect(screen.getByText('0/2')).toBeTruthy();
    expect(screen.queryByText('Apply the fix')).toBeNull();
    expectMobileToggle(screen.getByTestId('agent-plan-toggle'));

    fireEvent.press(screen.getByTestId('agent-plan-toggle'));
    expect(screen.getByTestId('agent-plan-step-1')).toBeTruthy();
    expect(screen.getByText('Apply the fix')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('shows no plan card for work that kept no plan', () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({ controlGraph: makeControlGraph({ plan: undefined }) })}
      />,
    );

    expect(screen.queryByTestId('agent-plan-widget')).toBeNull();
  });

  it('adds nothing to a finished reply that kept no plan', () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({ status: 'completed', controlGraph: makeControlGraph({ plan: undefined }) })}
      />,
    );

    expect(screen.queryByTestId('agent-workflow-summary')).toBeNull();
  });

  it('keeps the plan, without a status row, once the work is finished', () => {
    const screen = render(<AgentWorkflowSummary run={makeRun({ status: 'completed' })} />);

    expect(screen.getByTestId('agent-plan-widget')).toBeTruthy();
    expect(screen.queryByTestId('agent-workflow-current')).toBeNull();
  });

  it.each([
    [
      'waiting for the person',
      { status: 'running' as const },
      'waiting_for_user' as const,
      'Waiting for you',
    ],
    ['stopped before finishing', { status: 'failed' as const }, undefined, 'Failed'],
  ])(
    'shows the status of a run %s, even without a plan',
    (_case, overrides, presentation, label) => {
      const screen = render(
        <AgentWorkflowSummary
          run={makeRun({ ...overrides, controlGraph: makeControlGraph({ plan: undefined }) })}
          executionPresentation={presentation}
        />,
      );

      expect(screen.getByTestId('agent-workflow-current')).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it('adds nothing while plan-less work is under way, which the reply already shows', () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({ controlGraph: makeControlGraph({ plan: undefined }) })}
      />,
    );

    expect(screen.queryByTestId('agent-workflow-summary')).toBeNull();
  });
});
