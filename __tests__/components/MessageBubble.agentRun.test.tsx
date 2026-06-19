import { render, fireEvent } from '@testing-library/react-native';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../src/engine/graph/graphObservability';
import { MessageBubble, installMessageBubbleTestHarness, makeAgentRun, makeMessage } from '../helpers/messageBubbleHarness';

describe('MessageBubble agent run widgets', () => {
  installMessageBubbleTestHarness();

  it('shows a review footer while the run is being reviewed', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { getByTestId, getByText } = render(
      <MessageBubble message={msg} agentRun={makeAgentRun()} />,
    );

    expect(getByTestId('assistant-bubble-review-indicator')).toBeTruthy();
    expect(getByText('Reviewing the work')).toBeTruthy();
  });

  it('hides the review footer while the run is still in the work stage', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { queryByTestId } = render(
      <MessageBubble
        message={msg}
        agentRun={makeAgentRun({
          currentPhase: 'work',
          phases: [
            { key: 'assess', title: 'Assess', status: 'completed', updatedAt: 1_700_000_000_100 },
            {
              key: 'plan',
              title: 'Plan',
              status: 'completed',
              detail: 'Inspect, patch, and verify.',
              updatedAt: 1_700_000_000_150,
            },
            { key: 'work', title: 'Work', status: 'active', updatedAt: 1_700_000_000_200 },
            { key: 'review', title: 'Review', status: 'pending', updatedAt: 1_700_000_000_400 },
            { key: 'deliver', title: 'Deliver', status: 'pending', updatedAt: 1_700_000_000_500 },
          ],
        })}
      />,
    );

    expect(queryByTestId('assistant-bubble-review-indicator')).toBeNull();
  });

  it('should render a compact goals widget and toggle its details', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { getByTestId, getByText, queryByTestId } = render(
      <MessageBubble
        message={msg}
        agentRun={makeAgentRun({
          controlGraph: {
            version: 1,
            status: 'ready',
            iteration: 2,
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
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            turnDirectives: {
              forceFinalText: false,
              requireDelegationTool: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            },
            audit: [],
            updatedAt: 2,
            asyncWork: {
              awaitingBackgroundWorkers: false,
              pendingOperations: [],
              updatedAt: 2,
            },
          },
        })}
      />,
    );

    expect(getByTestId('agent-goals-widget')).toBeTruthy();
    expect(getByText('Goals (2)')).toBeTruthy();
    expect(getByText('Audit the repository')).toBeTruthy();
    expect(queryByTestId('agent-goals-details')).toBeNull();

    fireEvent.press(getByTestId('agent-goals-toggle'));

    expect(getByTestId('agent-goals-details')).toBeTruthy();
    expect(getByTestId('agent-goals-item-goal-audit')).toBeTruthy();
    expect(getByTestId('agent-goals-item-goal-fix')).toBeTruthy();
    expect(getByText('Apply the fix')).toBeTruthy();

    fireEvent.press(getByTestId('agent-goals-toggle'));
    expect(queryByTestId('agent-goals-details')).toBeNull();
  });

  it('should render a compact run trace widget and toggle its details', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { getByTestId, getByText, queryByTestId } = render(
      <MessageBubble
        message={msg}
        agentRun={makeAgentRun({
          controlGraph: {
            version: 1,
            status: 'ready',
            iteration: 2,
            goals: [],
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            turnDirectives: {
              forceFinalText: false,
              requireDelegationTool: false,
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
                type: GRAPH_OBSERVABILITY_AUDIT_TYPES.MEMORY_RETRIEVAL,
                iteration: 1,
                timestamp: 110,
                detail: 'facts:2,episodes:1,sections:1',
              },
              {
                type: GRAPH_OBSERVABILITY_AUDIT_TYPES.COMPLETION_GATE,
                iteration: 2,
                timestamp: 200,
                detail: 'decision:hold,reason:goals_incomplete',
              },
            ],
            updatedAt: 2,
            asyncWork: {
              awaitingBackgroundWorkers: false,
              pendingOperations: [],
              updatedAt: 2,
            },
          },
        })}
      />,
    );

    expect(getByTestId('agent-run-trace-widget')).toBeTruthy();
    expect(getByText('Run trace')).toBeTruthy();
    expect(queryByTestId('agent-run-trace-details')).toBeNull();

    fireEvent.press(getByTestId('agent-run-trace-toggle'));

    expect(getByTestId('agent-run-trace-details')).toBeTruthy();
    expect(getByTestId('agent-run-trace-iteration-1')).toBeTruthy();
    expect(getByTestId('agent-run-trace-iteration-2')).toBeTruthy();
    expect(getByText('TOOL_SURFACE_SELECTED')).toBeTruthy();
    expect(getByText('MEMORY_RETRIEVAL')).toBeTruthy();
    expect(getByText('COMPLETION_GATE')).toBeTruthy();

    fireEvent.press(getByTestId('agent-run-trace-toggle'));
    expect(queryByTestId('agent-run-trace-details')).toBeNull();
  });

  it('renders a bootstrap placeholder when the run has no goals yet', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { getByTestId, getByText } = render(
      <MessageBubble
        message={msg}
        agentRun={makeAgentRun({
          controlGraph: {
            version: 1,
            status: 'ready',
            iteration: 0,
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            turnDirectives: {
              forceFinalText: false,
              requireDelegationTool: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            },
            audit: [],
            updatedAt: 1,
            asyncWork: {
              awaitingBackgroundWorkers: false,
              pendingOperations: [],
              updatedAt: 1,
            },
          },
        })}
      />,
    );

    expect(getByTestId('agent-goals-widget')).toBeTruthy();
    expect(getByText('Goals pending bootstrap')).toBeTruthy();
  });

  it('should render structured sub-agent activity cards instead of raw lifecycle text', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Fallback lifecycle text that should not be rendered inline.',
      subAgentEvent: {
        type: 'sub-agent',
        event: 'completed',
        snapshot: {
          sessionId: 'sub-1234567890abcdef',
          parentConversationId: 'conv-1',
          parentSessionId: 'sub-root',
          name: 'Backend Architect',
          depth: 2,
          startedAt: Date.now() - 15_000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'safe-only',
          output: 'Worker finished the implementation.',
          toolsUsed: ['read_file', 'file_edit'],
          iterations: 2,
        },
      },
    });

    const { getByText, getByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Backend Architect')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Session sub-1234567890abc...')).toBeTruthy();
    expect(getByTestId('sub-agent-card-depth-2')).toBeTruthy();
    expect(queryByText('Fallback lifecycle text that should not be rendered inline.')).toBeNull();
  });

  it('should render current sub-agent activity from resolved transcript segments', () => {
    const sessionId = 'sub-1234567890abcdef';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Fallback lifecycle text that should not be rendered inline.',
    });

    const { getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-sub-agent',
            messageId: 'assistant-sub-agent',
            content: '',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Reading repository files',
                activeToolName: 'read_file',
              },
            },
          },
        ]}
      />,
    );

    expect(getByText('Reading repository files')).toBeTruthy();
    expect(getByText('read_file')).toBeTruthy();
  });

  it('should update a same-session transcript worker card in place instead of duplicating it', () => {
    const sessionId = 'sub-1234567890abcdef';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Worker lifecycle update',
    });

    const { getAllByTestId, getByText, queryByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-started',
            messageId: 'assistant-started',
            content: '',
            timestamp: Date.now() - 1,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now() - 1,
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Inspecting repository files',
              },
            },
          },
          {
            id: 'segment-completed',
            messageId: 'assistant-completed',
            content: '',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'completed',
                sandboxPolicy: 'safe-only',
                output: 'Worker finished the implementation.',
              },
            },
          },
        ]}
      />,
    );

    expect(getAllByTestId('sub-agent-card-depth-1')).toHaveLength(1);
    expect(getByText('Completed')).toBeTruthy();
    expect(queryByText('Inspecting repository files')).toBeNull();
    expect(getByText('Worker finished the implementation.')).toBeTruthy();
  });

  it('should append same-session worker tool calls beneath the collapsed activity card', () => {
    const sessionId = 'sub-append-tool-history';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Worker lifecycle update',
    });

    const { getAllByTestId, getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-started',
            messageId: 'assistant-started',
            content: '',
            timestamp: Date.now() - 1,
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"src/store/useChatStore.ts"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now() - 1,
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Inspecting repository files',
              },
            },
          },
          {
            id: 'segment-completed',
            messageId: 'assistant-completed',
            content: '',
            timestamp: Date.now(),
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"src/store/useChatStore.ts"}',
                status: 'completed',
                result: 'updated file contents',
              },
              {
                id: 'tc2',
                name: 'write_file',
                arguments: '{"path":"src/components/chat/assistantBubbleModel.ts"}',
                status: 'completed',
                result: 'write complete',
              },
            ],
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'completed',
                sandboxPolicy: 'safe-only',
                output: 'Worker finished the implementation.',
              },
            },
          },
        ]}
      />,
    );

    expect(getAllByTestId('sub-agent-card-depth-1')).toHaveLength(1);
    expect(getByText('Read File')).toBeTruthy();
    expect(getByText('Write File')).toBeTruthy();
  });
});
