import { act, renderHook } from '@testing-library/react-native';
import { useRecoveredAsyncRunResume } from '../../src/screens/useRecoveredAsyncRunResume';
import { useTerminalBackgroundReviewQueue } from '../../src/screens/useTerminalBackgroundReviewQueue';
import { useChatStore } from '../../src/store/useChatStore';
import { buildAgentRunMobileControllerAsyncOperation } from '../../src/services/agents/mobileControllerAsyncOperation';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';
import { makeTestAgentRun, makeTestConversation } from '../helpers/factories';

describe('agent run registry cleanup', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('removes an async-resume entry after an early missing-run exit', async () => {
    const pending = new Map<string, Promise<void>>();
    const { result } = renderHook(() =>
      useRecoveredAsyncRunResume({
        activeForegroundConversationIds: new Set(),
        appendConversationLog: jest.fn(),
        conversations: [],
        pendingAgentRunAsyncResumesRef: { current: pending },
        resumeAgentRunRef: { current: null },
        setAgentRunPhase: jest.fn(),
        updateAgentRunSummary: jest.fn(),
      }),
    );

    let resume: Promise<void> | undefined;
    act(() => {
      resume = result.current({
        conversationId: 'missing-conversation',
        runId: 'run-1',
        pendingOperations: [],
      });
    });

    expect(pending.size).toBe(1);
    await act(async () => {
      await resume;
    });
    expect(pending.size).toBe(0);
  });

  it('removes a terminal-review entry after an early missing-run exit', async () => {
    const pending = new Map<string, Promise<void>>();
    const { result } = renderHook(() =>
      useTerminalBackgroundReviewQueue({
        appendConversationLog: jest.fn(),
        completeAgentRun: jest.fn(),
        ensureAgentRunFinalResponseRef: { current: null },
        pendingAgentRunTerminalReviewsRef: { current: pending },
        recordConversationTurnMemory: jest.fn(),
        resolveConversationFinalizationContextRef: { current: null },
        resumeAgentRunRef: { current: null },
        setAgentRunPhase: jest.fn(),
        updateAgentRunAsyncWork: jest.fn(),
        updateAgentRunControlGraph: jest.fn(),
        updateAgentRunSummary: jest.fn(),
        updateMessageAssistantMetadata: jest.fn(),
      }),
    );

    let review: Promise<void> | undefined;
    let duplicateReview: Promise<void> | undefined;
    act(() => {
      review = result.current({
        conversationId: 'missing-conversation',
        runId: 'run-1',
      });
      duplicateReview = result.current({
        conversationId: 'missing-conversation',
        runId: 'run-1',
      });
    });

    expect(pending.size).toBe(1);
    expect(review).toBe(duplicateReview);
    await act(async () => {
      await review;
    });
    expect(pending.size).toBe(0);
  });

  it('leaves a recovered mobile handoff parked until the host submits its outcome', async () => {
    const operation = buildAgentRunMobileControllerAsyncOperation({
      handoff: createPersistedMobileControllerHandoffFixture().handoffRef,
      status: 'running',
      updatedAt: 40,
    });
    if (!operation) throw new Error('expected mobile controller async operation');
    const conversation = makeTestConversation({
      id: 'mobile-conversation',
      agentRuns: [
        makeTestAgentRun({
          id: 'mobile-run',
          status: 'running',
          updatedAt: 40,
          asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [operation] },
        }),
      ],
    });
    useChatStore.setState({ conversations: [conversation] });
    const pending = new Map<string, Promise<void>>();
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecoveredAsyncRunResume({
        activeForegroundConversationIds: new Set(),
        appendConversationLog: jest.fn(),
        conversations: [conversation],
        pendingAgentRunAsyncResumesRef: { current: pending },
        resumeAgentRunRef: { current: resumeAgentRun },
        setAgentRunPhase: jest.fn(),
        updateAgentRunSummary: jest.fn(),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(pending.size).toBe(0);
    expect(resumeAgentRun).not.toHaveBeenCalled();
  });

  it('does not resume a historical async run without the active conversation identity', async () => {
    const operation = {
      key: 'expo-workflow:workflow-101',
      kind: 'expo-workflow' as const,
      resourceId: 'workflow-101',
      displayName: 'Expo workflow 101',
      status: 'running' as const,
      blocksFinalization: true,
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: 40,
      monitorToolNames: ['expo_eas_workflow_status'],
    };
    const conversation = makeTestConversation({
      id: 'historical-conversation',
      activeAgentRunId: undefined,
      agentRuns: [
        makeTestAgentRun({
          id: 'historical-run',
          status: 'running',
          updatedAt: 40,
          controlGraph: {
            version: 1,
            status: 'waiting_async',
            iteration: 1,
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 1,
            lastModelToolNames: [],
            turnDirectives: {
              forceFinalText: false,
              requireDelegationTool: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            },
            audit: [],
            updatedAt: 40,
            asyncWork: {
              awaitingBackgroundWorkers: false,
              pendingOperations: [operation],
              updatedAt: 40,
            },
          },
        }),
      ],
    });
    useChatStore.setState({ conversations: [conversation] });
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecoveredAsyncRunResume({
        activeForegroundConversationIds: new Set(),
        appendConversationLog: jest.fn(),
        conversations: [conversation],
        pendingAgentRunAsyncResumesRef: { current: new Map() },
        resumeAgentRunRef: { current: resumeAgentRun },
        setAgentRunPhase: jest.fn(),
        updateAgentRunSummary: jest.fn(),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(resumeAgentRun).not.toHaveBeenCalled();
  });
});
