// ---------------------------------------------------------------------------
// Tests - useChatStore: Persist Configuration
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('Persist Configuration', () => {
    it('normalizes same-version persisted replay metadata during merge', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'conv-merge',
              title: 'Persisted Conversation',
              messages: [
                {
                  id: 'assistant-1',
                  role: 'assistant',
                  content: 'Recovered assistant output',
                  timestamp: 3,
                  providerReplay: {
                    openaiResponseId: '  resp_merge  ',
                    openaiResponseOutput: [{ id: 'item_1', type: 'reasoning' }, 'bad-item'],
                    geminiParts: [{ text: 'part-1' }, 42],
                    unexpected: 'drop-me',
                  },
                },
              ],
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-merge',
        },
        useChatStore.getState(),
      );

      expect(merged.conversations[0].messages[0].providerReplay).toEqual({
        openaiResponseId: 'resp_merge',
        openaiResponseOutput: [{ id: 'item_1', type: 'reasoning' }],
        geminiParts: [{ text: 'part-1' }],
      });
      expect(merged.activeConversationId).toBe('conv-merge');
    });

    it('hydrates missing and invalid persisted worker termination causes as unknown', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const workerSnapshot = {
        parentConversationId: 'conv-worker-causes',
        depth: 0,
        startedAt: 1,
        updatedAt: 2,
        status: 'error',
        sandboxPolicy: 'inherit',
      };
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'conv-worker-causes',
              title: 'Worker causes',
              messages: [
                {
                  id: 'worker-legacy',
                  role: 'assistant',
                  content: 'نص محفوظ',
                  timestamp: 2,
                  subAgentEvent: {
                    type: 'sub-agent',
                    event: 'error',
                    snapshot: { ...workerSnapshot, sessionId: 'worker-legacy' },
                  },
                },
                {
                  id: 'worker-invalid',
                  role: 'assistant',
                  content: '保存されたテキスト',
                  timestamp: 3,
                  subAgentEvent: {
                    type: 'sub-agent',
                    event: 'error',
                    snapshot: {
                      ...workerSnapshot,
                      sessionId: 'worker-invalid',
                      terminationCause: 'app restarted before completion',
                    },
                  },
                },
              ],
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-worker-causes',
        },
        useChatStore.getState(),
      );

      expect(
        merged.conversations[0].messages.map(
          (message: any) => message.subAgentEvent.snapshot.terminationCause,
        ),
      ).toEqual(['unknown', 'unknown']);
    });

    it('strips legacy persisted async run mirrors without reviving graph async work', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const pendingOperation = {
        key: 'session:legacy-worker',
        kind: 'session',
        resourceId: 'legacy-worker',
        displayName: 'Legacy worker',
        status: 'running',
        lastUpdatedByTool: 'sessions_spawn',
        updatedAt: 1700000004100,
        monitorToolNames: ['sessions_status', 'sessions_wait'],
        waitToolName: 'sessions_wait',
        waitArgs: { sessionId: 'legacy-worker' },
      };
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'conv-legacy-async',
              title: 'Legacy Async',
              messages: [],
              agentRuns: [
                {
                  id: 'run-legacy-async',
                  userMessageId: 'msg-user-legacy-async',
                  goal: 'Continue legacy async work.',
                  status: 'running',
                  awaitingBackgroundWorkers: true,
                  pendingAsyncOperations: [pendingOperation],
                  createdAt: 1700000004000,
                  updatedAt: 1700000004100,
                  currentPhase: 'work',
                  phases: [],
                  checkpoints: [],
                  summary: {
                    assistantTurns: 1,
                    startedTools: 1,
                    completedTools: 0,
                    failedTools: 0,
                    spawnedSubAgents: 1,
                  },
                },
              ],
              activeAgentRunId: 'run-legacy-async',
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-legacy-async',
        },
        useChatStore.getState(),
      );

      const run = merged.conversations[0].agentRuns[0];
      expect(run).not.toHaveProperty('awaitingBackgroundWorkers');
      expect(run).not.toHaveProperty('pendingAsyncOperations');
      expect(run.controlGraph).toBeUndefined();
    });

  });
});
