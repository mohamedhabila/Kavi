// ---------------------------------------------------------------------------
// Tests - useChatStore: agent run tracking part 4
// ---------------------------------------------------------------------------

import { AMBIGUOUS_EFFECT_RESTART_ERROR } from '../../../src/services/executionJournal/toolEffectRestartProjection';
import { useChatStore } from '../../helpers/chatStoreHarness';
import { addConversation } from '../../helpers/chatConversationFixtures';

describe('useChatStore', () => {
  describe('agent run tracking part 4', () => {
    it('keeps typed provider failures in review even when arbitrary output contains restart prose', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-9',
        role: 'user',
        content: 'Recover the failed worker workflow.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-9',
        goal: 'Recover the failed worker workflow.',
        timestamp: 1700000010000,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          awaitingBackgroundWorkers: true,
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000010100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-err-1',
            parentConversationId: convId,
            agentRunId: runId,
            depth: 0,
            startedAt: 1700000010200,
            updatedAt: 1700000010900,
            status: 'error',
            terminationCause: 'provider_failure',
            sandboxPolicy: 'inherit',
            output: 'تعذّر الاتصال. app restarted before completion. Это только текст вывода.',
          },
        ],
        {
          timestamp: 1700000011000,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBe(runId);
      expect(run.status).toBe('running');
      expect(run.controlGraph?.asyncWork.awaitingBackgroundWorkers).toBe(true);
      expect(run.currentPhase).toBe('review');
      expect(run.latestSummary).toContain('continue with a different approach');
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Recovered background failure',
        }),
      );
    });

    it('should fail app-restart-interrupted background-worker runs instead of reopening them for pilot review', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-10',
        role: 'user',
        content: 'Recover the interrupted worker workflow.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-10',
        goal: 'Recover the interrupted worker workflow.',
        timestamp: 1700000012000,
      });

      useChatStore.getState().updateAgentRunAsyncWork(
        convId,
        {
          awaitingBackgroundWorkers: true,
          latestSummary: 'Waiting for 1 background worker to finish.',
          checkpointTitle: 'Waiting for background workers',
          checkpointDetail: 'Waiting for 1 background worker to finish.',
          timestamp: 1700000012100,
        },
        runId,
      );

      useChatStore.getState().recoverInterruptedAgentRuns(
        [
          {
            sessionId: 'sub-interrupted-1',
            parentConversationId: convId,
            agentRunId: runId,
            depth: 0,
            startedAt: 1700000012200,
            updatedAt: 1700000012900,
            status: 'error',
            terminationCause: 'app_restart',
            sandboxPolicy: 'inherit',
            output: 'توقف العامل قبل اكتمال المهمة.',
            currentActivity: 'プロセスは終了しました。',
          },
        ],
        {
          timestamp: 1700000013000,
        },
      );

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('failed');
      expect(run.controlGraph?.asyncWork.awaitingBackgroundWorkers).toBe(false);
      expect(run.latestSummary).toBe(
        'Background workers were interrupted because the app restarted before completion.',
      );
      expect(run.checkpoints[run.checkpoints.length - 1]).toEqual(
        expect.objectContaining({
          title: 'Background workers interrupted on app restart',
        }),
      );
    });

    // Without its execution owner the effect cannot be looked up, so the call is reported as
    // possibly applied and the run settles; holding it `recovering` blocked the conversation.
    it('settles in-flight tool calls whose exact execution ownership is unavailable', () => {
      const convId = addConversation('p1', 's');
      useChatStore.getState().addMessage(convId, {
        id: 'msg-user-11',
        role: 'user',
        content: 'Keep fetching sources.',
      });
      const runId = useChatStore.getState().startAgentRun(convId, {
        userMessageId: 'msg-user-11',
        goal: 'Keep fetching sources.',
        timestamp: 1700000014000,
      });

      useChatStore.getState().addMessage(convId, {
        id: 'assistant-tools-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tc-fetch-1',
            name: 'web_fetch',
            arguments: '{}',
            status: 'running',
            startedAt: 1700000014100,
            updatedAt: 1700000014100,
          },
        ],
      });

      useChatStore.getState().recoverInterruptedAgentRuns([], {
        timestamp: 1700000015000,
      });

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      const assistantMessage = conv.messages.find((message) => message.id === 'assistant-tools-1')!;
      const toolCall = assistantMessage.toolCalls?.[0];
      const run = conv.agentRuns?.find((candidate) => candidate.id === runId)!;

      expect(conv.activeAgentRunId).toBeUndefined();
      expect(run.status).toBe('failed');
      expect(run.controlGraph?.status).toBe('failed');
      expect(toolCall).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: AMBIGUOUS_EFFECT_RESTART_ERROR,
        }),
      );
    });
  });
});
