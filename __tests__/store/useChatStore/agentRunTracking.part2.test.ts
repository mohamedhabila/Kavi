// ---------------------------------------------------------------------------
// Tests - useChatStore: agent run tracking part 2
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('agent run tracking part 2', () => {
    it('preserves the current phase by default when late worker updates target an earlier phase', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-phase-regression',
        goal: 'Keep later workflow phases stable.',
        timestamp: 1700000002100,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'review',
        {
          status: 'active',
          detail: 'Verifying the worker output.',
          checkpointTitle: 'Review started',
          checkpointDetail: 'Verifying the worker output.',
          timestamp: 1700000002200,
        },
        runId,
      );

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Worker status update arrived late.',
          checkpointTitle: 'Worker completed: Final verifier',
          checkpointDetail: 'Worker status update arrived late.',
          timestamp: 1700000002300,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.currentPhase).toBe('review');
      expect(run.phases.find((phase) => phase.key === 'review')).toEqual(
        expect.objectContaining({
          status: 'active',
          detail: 'Verifying the worker output.',
        }),
      );
      expect(run.phases.find((phase) => phase.key === 'work')).toEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Review started' }),
          expect.objectContaining({ title: 'Worker completed: Final verifier' }),
        ]),
      );
    });

    it('allows work to reclaim the current phase when regression is explicitly permitted', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-phase-regression-allowed',
        goal: 'Let resumed execution move back into work.',
        timestamp: 1700000002400,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'review',
        {
          status: 'active',
          detail: 'Review is inspecting the current output.',
          checkpointTitle: 'Review started',
          checkpointDetail: 'Review is inspecting the current output.',
          timestamp: 1700000002500,
        },
        runId,
      );

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Execution resumed after pilot requested another work step.',
          checkpointTitle: 'Work resumed',
          checkpointDetail: 'Execution resumed after pilot requested another work step.',
          timestamp: 1700000002600,
          allowRegression: true,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.currentPhase).toBe('work');
      expect(run.phases.find((phase) => phase.key === 'work')).toEqual(
        expect.objectContaining({
          status: 'active',
          detail: 'Execution resumed after pilot requested another work step.',
        }),
      );
      expect(run.phases.find((phase) => phase.key === 'review')).toEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Review started' }),
          expect.objectContaining({ title: 'Work resumed' }),
        ]),
      );
    });

    it('records and upserts structured workflow evidence on a specific run', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-evidence',
        goal: 'Capture structured workflow evidence.',
        timestamp: 1700000002050,
      });

      const firstEntries = useChatStore.getState().recordAgentRunEvidence(
        convId,
        {
          kind: 'fact',
          status: 'candidate',
          title: 'Repository scan',
          content: 'glob_search found 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
        },
        {
          timestamp: 1700000002060,
        },
        runId,
      );

      const secondEntries = useChatStore.getState().recordAgentRunEvidence(
        convId,
        {
          kind: 'fact',
          status: 'verified',
          content: 'glob_search confirmed 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
        },
        {
          timestamp: 1700000002070,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(firstEntries).toHaveLength(1);
      expect(secondEntries).toHaveLength(1);
      expect(run.evidence).toEqual([
        expect.objectContaining({
          kind: 'fact',
          status: 'verified',
          title: 'Repository scan',
          content: 'glob_search confirmed 12 files relevant to the fix.',
          dedupeKey: 'repo-scan',
          sourceName: 'glob_search',
          toolName: 'glob_search',
          createdAt: 1700000002060,
          updatedAt: 1700000002070,
        }),
      ]);
    });

    it('skips redundant progress-only phase and summary updates', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-progress',
        goal: 'Track worker progress efficiently.',
        timestamp: 1700000003000,
      });

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Scanning repository files',
          timestamp: 1700000003100,
        },
        runId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Scanning repository files',
          timestamp: 1700000003100,
        },
        runId,
      );

      const conversationBefore = useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)!;
      const runBefore = conversationBefore.agentRuns?.find((run) => run.id === runId)!;

      useChatStore.getState().setAgentRunPhase(
        convId,
        'work',
        {
          status: 'active',
          detail: 'Scanning repository files',
          timestamp: 1700000003200,
        },
        runId,
      );
      useChatStore.getState().updateAgentRunSummary(
        convId,
        {
          latestSummary: 'Scanning repository files',
          timestamp: 1700000003200,
        },
        runId,
      );

      const conversationAfter = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const runAfter = conversationAfter.agentRuns?.find((run) => run.id === runId)!;

      expect(conversationAfter).toBe(conversationBefore);
      expect(runAfter).toBe(runBefore);
      expect(runAfter.updatedAt).toBe(1700000003100);
      expect(runAfter.latestSummary).toBe('Scanning repository files');
    });

    it('should retain the initial checkpoint anchor for long-running sessions while trimming the oldest middle entries', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-long',
        goal: 'Keep a durable execution timeline.',
        timestamp: 1700000002500,
      });

      for (let index = 0; index < 80; index += 1) {
        useChatStore.getState().appendAgentRunCheckpoint(convId, {
          kind: 'tool',
          title: `Tool completed: checkpoint-${index}`,
          detail: `Checkpoint ${index}`,
          timestamp: 1700000002600 + index,
        });
      }

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(run.checkpoints).toHaveLength(64);
      expect(run.checkpoints[0]).toEqual(
        expect.objectContaining({
          title: 'Turn started',
          detail: 'Keep a durable execution timeline.',
        }),
      );
      expect(run.checkpoints[1]).toEqual(
        expect.objectContaining({
          title: 'Tool completed: checkpoint-17',
        }),
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Tool completed: checkpoint-79',
        }),
      );
    });

    it('should complete the active run and clear the active run id', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-3',
        goal: 'Finish the work.',
      });

      useChatStore.getState().completeAgentRun(convId, {
        status: 'completed',
        latestSummary: 'duration 12s · assistant turns 2 · tools 1/1',
        checkpointTitle: 'Turn completed',
        summary: {
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          durationMs: 12000,
        },
        timestamp: 1700000003000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('completed');
      expect(run.currentPhase).toBe('deliver');
      expect(run.completedAt).toBe(1700000003000);
      expect(run.phases.find((phase) => phase.key === 'deliver')).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(run.summary).toEqual(
        expect.objectContaining({
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
          durationMs: 12000,
        }),
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Turn completed',
          timestamp: 1700000003000,
        }),
      );
    });

    it('should keep a run active while waiting for background workers', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-4',
        goal: 'Wait for the delegated workers.',
        timestamp: 1700000003500,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          awaitingBackgroundWorkers: true,
          latestSummary: 'Waiting for 2 background workers to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 2 background workers to finish.',
          timestamp: 1700000003600,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run).not.toHaveProperty('awaitingBackgroundWorkers');
      expect(run.controlGraph?.asyncWork.awaitingBackgroundWorkers).toBe(true);
      expect(run.latestSummary).toBe('Waiting for 2 background workers to finish.');
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Waiting for background workers',
          detail: 'Waiting for 2 background workers to finish.',
        }),
      );
    });
  });
});
