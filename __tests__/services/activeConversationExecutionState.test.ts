import {
  selectActiveConversationExecutionState,
  selectAgentRunExecutionPresentation,
} from '../../src/services/agents/activeConversationExecutionState';
import {
  createInitialAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../src/services/agents/agentControlGraphState';
import { getRunningConversationRunsForCancellation } from '../../src/services/agents/subAgentRunTracking';
import { makeTestAgentRun, makeTestConversation } from '../helpers/factories';

const pendingOperation = {
  key: 'expo-workflow:workflow-101',
  kind: 'expo-workflow' as const,
  resourceId: 'workflow-101',
  displayName: 'Expo workflow 101',
  status: 'running' as const,
  blocksFinalization: true,
  lastUpdatedByTool: 'expo_eas_build',
  updatedAt: 10,
  monitorToolNames: ['expo_eas_workflow_status'],
};

function conversationWithRun(options: {
  active?: boolean;
  controlGraph?: ReturnType<typeof createInitialAgentRunControlGraphState>;
}) {
  const run = makeTestAgentRun({ controlGraph: options.controlGraph });
  return {
    conversation: makeTestConversation({
      activeAgentRunId: options.active === false ? undefined : run.id,
      agentRuns: [run],
    }),
    run,
  };
}

describe('active conversation execution state', () => {
  it('ignores historical running records without the active run identity', () => {
    const { conversation, run } = conversationWithRun({ active: false });

    const state = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      {},
    );

    expect(state).toEqual({ canStop: false, isBusy: false, kind: 'idle' });
    expect(selectAgentRunExecutionPresentation(run, state)).toBe('needs_attention');
    expect(getRunningConversationRunsForCancellation(conversation)).toEqual([]);
  });

  it('requires liveness evidence even when a persisted active run identity exists', () => {
    const { conversation, run } = conversationWithRun({});

    const state = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      {},
    );

    expect(state).toMatchObject({ activeRun: run, canStop: false, isBusy: false });
    expect(state.kind).toBe('needs_attention');
    expect(selectAgentRunExecutionPresentation(run, state)).toBe('needs_attention');
  });

  it('presents an owned foreground request as running', () => {
    const { conversation, run } = conversationWithRun({});

    const state = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: true },
      {},
    );

    expect(state).toMatchObject({ activeRun: run, canStop: true, isBusy: true });
    expect(state.kind).toBe('foreground');
    expect(selectAgentRunExecutionPresentation(run, state)).toBe('running');
  });

  it('presents a validated pending async operation as background work', () => {
    const controlGraph = updateAgentRunControlGraphAsyncWorkState(
      createInitialAgentRunControlGraphState({ status: 'waiting_async', updatedAt: 1 }),
      {
        awaitingBackgroundWorkers: false,
        pendingOperations: [pendingOperation],
        updatedAt: 10,
      },
    );
    const { conversation, run } = conversationWithRun({ controlGraph });

    const state = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      {},
    );

    expect(state).toMatchObject({
      activeRun: run,
      backgroundEvidence: 'async_operation',
      canStop: true,
      isBusy: true,
      kind: 'background',
    });
    expect(selectAgentRunExecutionPresentation(run, state)).toBe('running');
  });

  it('requires a live worker before background-worker state can present as running', () => {
    const controlGraph = updateAgentRunControlGraphAsyncWorkState(
      createInitialAgentRunControlGraphState({ status: 'waiting_async', updatedAt: 1 }),
      {
        awaitingBackgroundWorkers: true,
        pendingOperations: [],
        updatedAt: 10,
      },
    );
    const { conversation, run } = conversationWithRun({ controlGraph });

    const staleState = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      { hasLiveBackgroundWorker: false },
    );
    const liveState = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      { hasLiveBackgroundWorker: true },
    );

    expect(staleState.kind).toBe('needs_attention');
    expect(liveState).toMatchObject({
      backgroundEvidence: 'live_worker',
      canStop: true,
      isBusy: true,
      kind: 'background',
    });
    expect(selectAgentRunExecutionPresentation(run, liveState)).toBe('running');
  });

  it('labels an awaiting-user run without locking the composer into Running', () => {
    const { conversation, run } = conversationWithRun({
      controlGraph: createInitialAgentRunControlGraphState({
        status: 'awaiting_user',
        updatedAt: 10,
      }),
    });

    const state = selectActiveConversationExecutionState(
      conversation,
      { hasActiveRequest: false },
      {},
    );

    expect(state).toMatchObject({ activeRun: run, canStop: false, isBusy: false });
    expect(state.kind).toBe('waiting_for_user');
    expect(selectAgentRunExecutionPresentation(run, state)).toBe('waiting_for_user');
  });

  it('stays idle through fifty historical-run remount projections', () => {
    const { conversation } = conversationWithRun({ active: false });

    for (let cycle = 0; cycle < 50; cycle += 1) {
      expect(
        selectActiveConversationExecutionState(
          { ...conversation, agentRuns: conversation.agentRuns?.map((run) => ({ ...run })) },
          { hasActiveRequest: false },
          {},
        ),
      ).toMatchObject({ canStop: false, isBusy: false, kind: 'idle' });
    }
  });
});
