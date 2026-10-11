import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AgentWorkflowSummary } from '../../src/components/chat/AgentWorkflowSummary';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../src/engine/graph/graphObservability';
import type { AgentRun, AgentRunControlGraphState } from '../../src/types/agentRun';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER } from '../../src/engine/goals/types';

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
  expect(StyleSheet.flatten(node.props.style)).toEqual(expect.objectContaining({ minHeight: 48 }));
};

describe('AgentWorkflowSummary for everyday use', () => {
  beforeEach(() => {
    useSettingsStore.setState({ developerModeEnabled: false });
  });

  it('hides the run trace outside developer mode', () => {
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

  it("never shows the engine's bookkeeping goals", () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({
          controlGraph: makeControlGraph({
            plan: undefined,
            goals: [
              {
                id: 'effect-write-file',
                title: 'Verify write_file effect',
                status: 'active',
                owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
                dependencies: [],
                evidence: ['receipt'],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        })}
      />,
    );

    expect(screen.queryByText('Verify write_file effect')).toBeNull();
    expect(screen.queryByTestId('agent-plan-widget')).toBeNull();
    expect(screen.getByText('Work')).toBeTruthy();
  });

  it('shows no plan card for work that kept no plan', () => {
    const screen = render(
      <AgentWorkflowSummary
        run={makeRun({ controlGraph: makeControlGraph({ plan: undefined }) })}
      />,
    );

    expect(screen.queryByTestId('agent-plan-widget')).toBeNull();
  });
});

describe('AgentWorkflowSummary in developer mode', () => {
  beforeEach(() => {
    useSettingsStore.setState({ developerModeEnabled: true });
  });

  afterAll(() => {
    useSettingsStore.setState({ developerModeEnabled: false });
  });

  it('keeps current work primary while plan and trace details stay collapsed by default', () => {
    const screen = render(<AgentWorkflowSummary run={makeRun()} />);

    expect(screen.getByTestId('agent-workflow-summary')).toBeTruthy();
    expect(screen.getByText('Current work')).toBeTruthy();
    expect(screen.getByText('Audit the repository')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByTestId('agent-plan-details')).toBeNull();
    expect(screen.queryByTestId('agent-run-trace-details')).toBeNull();
    expectMobileToggle(screen.getByTestId('agent-run-trace-toggle'));
    expect(screen.getByTestId('agent-run-trace-toggle').props.accessibilityLabel).toBe('Run trace');

    fireEvent.press(screen.getByTestId('agent-run-trace-toggle'));
    expect(screen.getByTestId('agent-run-trace-iteration-1')).toBeTruthy();
    expect(screen.getByTestId('agent-run-trace-iteration-2')).toBeTruthy();
    expect(screen.getByText(GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_SELECTED)).toBeTruthy();
    expect(screen.getByText(GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE)).toBeTruthy();
  });

  it('keeps a finished plan compact and counts its completed steps', () => {
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
            plan: [
              { step: 'Check the answer', status: 'completed' },
              { step: 'Send it', status: 'completed' },
            ],
          }),
        })}
      />,
    );

    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.queryByTestId('agent-plan-details')).toBeNull();

    fireEvent.press(screen.getByTestId('agent-plan-toggle'));
    expect(screen.getAllByText('Done')).toHaveLength(2);
  });

  it.each([
    ['waiting_for_user', 'Waiting for you'],
    ['needs_attention', 'Needs attention'],
  ] as const)('does not present %s workflow state as Running', (executionPresentation, label) => {
    const screen = render(
      <AgentWorkflowSummary run={makeRun()} executionPresentation={executionPresentation} />,
    );

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Running')).toBeNull();
  });
});
