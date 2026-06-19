// ---------------------------------------------------------------------------
// Tests - useChatStore: agent run tracking part 1
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('agent run tracking part 1', () => {
    it('should start a structured agent run with initial phases and checkpoint', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');

      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-1',
        goal: 'Audit the repository and apply the fix.',
        timestamp: 1700000002000,
        summary: { assistantTurns: 1 },
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(conv.activeAgentRunId).toBe(runId);
      expect(conv.agentRuns).toHaveLength(1);
      expect(conv.agentRuns?.[0]).toEqual(
        expect.objectContaining({
          id: runId,
          userMessageId: 'msg-user-1',
          goal: 'Audit the repository and apply the fix.',
          status: 'running',
          currentPhase: 'assess',
          plan: expect.objectContaining({
            objective: 'Audit the repository and apply the fix.',
            successCriteria: expect.arrayContaining(['Produce the requested deliverable.']),
            stopConditions: expect.arrayContaining([
              'Stop when the deliverable is complete and the success criteria are satisfied.',
            ]),
          }),
          summary: expect.objectContaining({
            assistantTurns: 1,
            startedTools: 0,
            completedTools: 0,
          }),
          controlGraph: expect.objectContaining({
            status: 'ready',
            expectedToolCalls: [],
            observedToolResults: [],
          }),
        }),
      );
      expect(conv.agentRuns?.[0].phases).toEqual([
        expect.objectContaining({ key: 'assess', status: 'active' }),
        expect.objectContaining({ key: 'plan', status: 'pending' }),
        expect.objectContaining({ key: 'work', status: 'pending' }),
        expect.objectContaining({ key: 'review', status: 'pending' }),
        expect.objectContaining({ key: 'pilot', status: 'pending' }),
        expect.objectContaining({ key: 'deliver', status: 'pending' }),
      ]);
      expect(conv.agentRuns?.[0].checkpoints[0]).toEqual(
        expect.objectContaining({
          title: 'Turn started',
          detail: 'Audit the repository and apply the fix.',
          kind: 'run',
          timestamp: 1700000002000,
        }),
      );
    });

    it('should update the active run phase, summary, and checkpoints', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-2',
        goal: 'Ship the patch.',
      });

      useChatStore.getState().setAgentRunPhase(convId, 'plan', {
        status: 'completed',
        detail: 'Inspect, patch, and verify.',
        checkpointTitle: 'Plan captured',
      });
      useChatStore.getState().updateAgentRunPlan(convId, {
        objective: 'Ship the patch with verified workflow state.',
        successCriteria: ['Persist the plan', 'Render the timeline'],
        stopConditions: ['Stop when verified'],
        workstreams: [
          {
            id: 'ws-1',
            title: 'Store model',
            goal: 'Persist semantic planning data',
          },
        ],
        rawPlan: 'Objective: Ship the patch with verified workflow state.',
      });
      useChatStore.getState().updateAgentRunSummary(convId, {
        assistantTurns: 2,
        startedTools: 1,
        completedTools: 1,
        latestSummary: 'Completed read_file',
      });
      useChatStore.getState().appendAgentRunCheckpoint(convId, {
        kind: 'tool',
        title: 'Tool completed: read_file',
        detail: 'Inspected the target file.',
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.[0]!;

      expect(run.currentPhase).toBe('plan');
      expect(run.phases.find((phase) => phase.key === 'assess')).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(run.phases.find((phase) => phase.key === 'plan')).toEqual(
        expect.objectContaining({
          status: 'completed',
          detail: 'Inspect, patch, and verify.',
        }),
      );
      expect(run.plan).toEqual(
        expect.objectContaining({
          objective: 'Ship the patch with verified workflow state.',
          successCriteria: ['Persist the plan', 'Render the timeline'],
          stopConditions: ['Stop when verified'],
          workstreams: [
            expect.objectContaining({
              id: 'ws-1',
              title: 'Store model',
              goal: 'Persist semantic planning data',
            }),
          ],
          rawPlan: 'Objective: Ship the patch with verified workflow state.',
        }),
      );
      expect(run.summary).toEqual(
        expect.objectContaining({
          assistantTurns: 2,
          startedTools: 1,
          completedTools: 1,
        }),
      );
      expect(run.latestSummary).toBe('Completed read_file');
      expect(run.checkpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Plan captured' }),
          expect.objectContaining({ title: 'Tool completed: read_file', kind: 'tool' }),
        ]),
      );
    });

    it('stores lean graph goals and active task state inside the durable control graph', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-route-state',
        goal: 'Complete the active goal.',
        timestamp: 1700000002500,
      });

      useChatStore.getState().updateAgentRunControlGraph(
        convId,
        {
          version: 1,
          status: 'ready',
          iteration: 1,
          expectedToolCalls: [],
          observedToolResults: [],
          pendingAsyncCount: 0,
          lastModelToolNames: [],
          activeTaskId: 'goal-mutate-remote',
          goals: [
            {
              id: 'goal-prepare',
              title: 'Prepare artifacts',
              status: 'completed',
              dependencies: [],
              evidence: ['prepared'],
              createdAt: 1700000002500,
              updatedAt: 1700000002600,
              completedAt: 1700000002600,
            },
            {
              id: 'goal-mutate-remote',
              title: 'Apply remote side effects',
              status: 'active',
              dependencies: ['goal-prepare'],
              evidence: [],
              createdAt: 1700000002500,
              updatedAt: 1700000002600,
            },
          ],
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 0,
          },
          audit: [],
          updatedAt: 1700000002600,
        },
        runId,
      );
      useChatStore.getState().completeAgentRun(
        convId,
        {
          status: 'failed',
          terminalReason: 'terminal_blocked',
          checkpointTitle: 'Pilot blocked finalization',
          latestSummary: 'Missing required remote evidence.',
          timestamp: 1700000002700,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.controlGraph?.activeTaskId).toBe('goal-mutate-remote');
      expect(run.controlGraph?.goals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'goal-mutate-remote',
            status: 'active',
          }),
        ]),
      );
      expect(run.controlGraph?.workflowRoute).toBeUndefined();
      expect(run.controlGraph?.workflowProgress).toBeUndefined();
      expect(run.terminalReason).toBe('terminal_blocked');
      expect(run.status).toBe('failed');
    });

    it('stores durable agent control graph state for resumed tool boundaries', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-control-graph',
        goal: 'Resume only after tool results are recorded.',
        timestamp: 1700000002800,
      });

      useChatStore.getState().updateAgentRunControlGraph(
        convId,
        {
          version: 1,
          status: 'awaiting_tool_results',
          iteration: 4,
          expectedToolCalls: [
            { id: 'call-1', name: 'mcp__generic__mutate_resource' },
            { id: 'call-1', name: 'duplicate_should_drop' },
          ],
          observedToolResults: [],
          pendingAsyncCount: 0,
          lastModelToolNames: ['mcp__generic__mutate_resource'],
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 0,
          },
          audit: [
            {
              type: 'MODEL_TURN_COMPLETED',
              timestamp: 1700000002900,
              iteration: 4,
              detail: '1 tool call(s) expected',
            },
          ],
          updatedAt: 1700000002900,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run.controlGraph).toEqual(
        expect.objectContaining({
          status: 'awaiting_tool_results',
          iteration: 4,
          expectedToolCalls: [{ id: 'call-1', name: 'mcp__generic__mutate_resource' }],
          observedToolResults: [],
          lastModelToolNames: ['mcp__generic__mutate_resource'],
        }),
      );
      expect(run.updatedAt).toBe(1700000002900);
    });

    it('keeps async wait state graph-owned when control graph is updated', () => {
      const convId = useChatStore.getState().createConversation('p1', 's');
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-control-graph-async',
        goal: 'Resume async work from graph state.',
        timestamp: 1700000003000,
      });

      useChatStore.getState().updateAgentRunControlGraph(
        convId,
        {
          version: 1,
          status: 'waiting_async',
          iteration: 2,
          expectedToolCalls: [],
          observedToolResults: [],
          pendingAsyncCount: 1,
          lastModelToolNames: ['sessions_spawn'],
          asyncWork: {
            awaitingBackgroundWorkers: true,
            pendingOperations: [
              {
                key: 'session:sub-store',
                kind: 'session',
                resourceId: 'sub-store',
                displayName: 'Session sub-store',
                status: 'running',
                lastUpdatedByTool: 'sessions_spawn',
                updatedAt: 1700000003050,
                monitorToolNames: ['sessions_status', 'sessions_wait'],
                waitToolName: 'sessions_wait',
                waitArgs: { sessionId: 'sub-store' },
              },
            ],
            updatedAt: 1700000003050,
          },
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 0,
          },
          audit: [],
          updatedAt: 1700000003050,
        },
        runId,
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(run).not.toHaveProperty('awaitingBackgroundWorkers');
      expect(run).not.toHaveProperty('pendingAsyncOperations');
      expect(run.controlGraph?.asyncWork.awaitingBackgroundWorkers).toBe(true);
      expect(run.controlGraph?.asyncWork.pendingOperations).toEqual([
        expect.objectContaining({
          key: 'session:sub-store',
          resourceId: 'sub-store',
          waitToolName: 'sessions_wait',
        }),
      ]);
    });
  });
});
