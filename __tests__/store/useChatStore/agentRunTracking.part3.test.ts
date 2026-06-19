// ---------------------------------------------------------------------------
// Tests - useChatStore: agent run tracking part 3
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('agent run tracking part 3', () => {
    it('should persist pending async operations on a running run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-async',
        goal: 'Monitor the workflow.',
        timestamp: 1700000003650,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          pendingOperations: [
            {
              key: 'expo-workflow:123',
              kind: 'expo-workflow',
              resourceId: '123',
              displayName: 'Expo workflow 123',
              status: 'running',
              lastUpdatedByTool: 'expo_eas_workflow_status',
              updatedAt: 1700000003700,
              monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
              statusArgs: {
                projectId: 'proj-1',
                workflowRunId: '123',
              },
              waitToolName: 'expo_eas_workflow_wait',
              waitArgs: {
                projectId: 'proj-1',
                workflowRunId: '123',
              },
            },
          ],
          latestSummary: 'Waiting for Expo workflow 123 to finish.',
          timestamp: 1700000003700,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run).not.toHaveProperty('pendingAsyncOperations');
      expect(run.controlGraph?.asyncWork.pendingOperations).toEqual([
        expect.objectContaining({
          key: 'expo-workflow:123',
          kind: 'expo-workflow',
          resourceId: '123',
          status: 'running',
        }),
      ]);
      expect(run.controlGraph?.pendingAsyncCount).toBe(1);
      expect(run.latestSummary).toBe('Waiting for Expo workflow 123 to finish.');
    });

    it('should update a specific historical run without mutating the active run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const oldRunId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-5',
        goal: 'First workflow.',
        timestamp: 1700000004000,
      });

      const activeRunId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-6',
        goal: 'Second workflow.',
        timestamp: 1700000005000,
      });

      useChatStore.getState().appendAgentRunCheckpoint(
        convId,
        {
          kind: 'sub-agent',
          title: 'Worker completed: Old worker',
          detail: 'The original worker finished after the next user turn started.',
          timestamp: 1700000005100,
        },
        oldRunId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Late worker completion recorded on the superseded run.',
          timestamp: 1700000005100,
        },
        oldRunId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const oldRun = conv.agentRuns?.find((run) => run.id === oldRunId)!;
      const activeRun = conv.agentRuns?.find((run) => run.id === activeRunId)!;

      expect(conv.activeAgentRunId).toBe(activeRunId);
      expect(oldRun.status).toBe('cancelled');
      expect(oldRun.latestSummary).toBe('Late worker completion recorded on the superseded run.');
      expect(oldRun.checkpoints[oldRun.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Worker completed: Old worker',
        }),
      );
      expect(activeRun.latestSummary).toBeUndefined();
      expect(activeRun.checkpoints[activeRun.checkpoints.length - 1]).not.toEqual(
        expect.objectContaining({
          title: 'Worker completed: Old worker',
        }),
      );
    });

    it('should recover interrupted foreground runs on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-7',
        role: 'user',
        content: 'Keep working on the patch.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-7',
        goal: 'Finish the patch.',
        timestamp: 1700000006000,
      });

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000007000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('failed');
      expect(run.latestSummary).toBe(
        'The run was interrupted because the app restarted before completion.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Run interrupted on app restart',
          detail: 'The run was interrupted because the app restarted before completion.',
        }),
      );
    });

    it('should recover pending async-operation runs on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-async-restart',
        role: 'user',
        content: 'Keep monitoring the deployment.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-async-restart',
        goal: 'Monitor the deployment until it completes.',
        timestamp: 1700000007050,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          pendingOperations: [
            {
              key: 'ssh-background-job:bg-1',
              kind: 'ssh-background-job',
              resourceId: 'bg-1',
              displayName: 'SSH background job bg-1',
              status: 'running',
              lastUpdatedByTool: 'ssh_background_job_status',
              updatedAt: 1700000007100,
              monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
              statusArgs: { jobId: 'bg-1' },
              waitToolName: 'ssh_background_job_wait',
              waitArgs: { jobId: 'bg-1' },
            },
          ],
          latestSummary: 'Waiting for SSH background job bg-1 to finish.',
          timestamp: 1700000007100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000007200,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run.status).toBe('running');
      expect(run.latestSummary).toBe(
        'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered async workflow monitoring',
          detail:
            'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.',
        }),
      );
    });

    it('should recover background-worker runs from terminal worker state on app restart', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-8',
        role: 'user',
        content: 'Wait for the worker results.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-8',
        goal: 'Coordinate the delegated workers.',
        timestamp: 1700000008000,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          awaitingBackgroundWorkers: true,
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000008100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-1',
            parentConversationId: convId,
            depth: 0,
            startedAt: 1700000008200,
            updatedAt: 1700000009000,
            status: 'completed',
            sandboxPolicy: 'inherit',
            completionState: 'verified_success',
            output: 'Worker completed the delegated task.',
          },
        ],
        {
          timestamp: 1700000009100,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('completed');
      expect(run.latestSummary).toBe(
        'Background workers finished before the app restarted. Recovering the final response from verified results.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered background completion',
        }),
      );
    });

    it('should clear stale pending async operations when recovery terminalizes a run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-8b',
        role: 'user',
        content: 'Wait for the worker results.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-8b',
        goal: 'Coordinate the delegated workers.',
        timestamp: 1700000008050,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          pendingOperations: [
            {
              key: 'ssh-background-job:bg-stale',
              kind: 'ssh-background-job',
              resourceId: 'bg-stale',
              displayName: 'SSH background job bg-stale',
              status: 'running',
              lastUpdatedByTool: 'ssh_background_job_status',
              updatedAt: 1700000008075,
              monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
              statusArgs: { jobId: 'bg-stale' },
              waitToolName: 'ssh_background_job_wait',
              waitArgs: { jobId: 'bg-stale' },
            },
          ],
          latestSummary: 'Waiting for SSH background job bg-stale to finish.',
          timestamp: 1700000008075,
        },
        runId,
      );

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          awaitingBackgroundWorkers: true,
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000008100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-1b',
            parentConversationId: convId,
            depth: 0,
            startedAt: 1700000008200,
            updatedAt: 1700000009000,
            status: 'completed',
            sandboxPolicy: 'inherit',
            completionState: 'verified_success',
            output: 'Worker completed the delegated task.',
          },
        ],
        {
          timestamp: 1700000009100,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.status).toBe('completed');
      expect(run).not.toHaveProperty('pendingAsyncOperations');
      expect(run.controlGraph?.asyncWork).toEqual(
        expect.objectContaining({
          awaitingBackgroundWorkers: false,
          pendingOperations: [],
        }),
      );
    });
  });
});
