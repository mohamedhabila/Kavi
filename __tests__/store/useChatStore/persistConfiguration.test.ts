// ---------------------------------------------------------------------------
// Tests - useChatStore: Persist Configuration
// ---------------------------------------------------------------------------

import { useChatStore } from '../../helpers/chatStoreHarness';

describe('useChatStore', () => {
  describe('Persist Configuration', () => {
    it('collapses pre-v7 conversations into one canonical thread per persona', async () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const migrated = await persistOptions.migrate(
        {
          conversations: [
            {
              id: 'r-old',
              title: 'Old',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'researcher',
              createdAt: 1,
              updatedAt: 100,
            },
            {
              id: 'r-new',
              title: 'Newer',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'researcher',
              createdAt: 2,
              updatedAt: 300,
            },
            {
              id: 'side',
              title: 'Side',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'researcher',
              parentConversationId: 'r-old',
              isSideThread: true,
              createdAt: 3,
              updatedAt: 400,
            },
          ],
          activeConversationId: 'r-new',
        },
        6,
      );

      const byId = Object.fromEntries(migrated.conversations.map((c: any) => [c.id, c]));
      expect(byId['r-new'].isCanonical).toBe(true);
      expect(byId['r-old'].archivedFromMigration).toBe(true);
      expect(byId['r-old'].isCanonical).not.toBe(true);
      expect(byId['side'].isSideThread).toBe(true);
      expect(byId['side'].archivedFromMigration).not.toBe(true);
    });

    it('migrates legacy assistant messages to explicit assistant metadata', async () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const migrated = await persistOptions.migrate(
        {
          conversations: [
            {
              id: 'conv-legacy',
              title: 'Legacy Conversation',
              messages: [
                { id: 'user-1', role: 'user', content: 'Audit the repository', timestamp: 1 },
                {
                  id: 'assistant-tool',
                  role: 'assistant',
                  content: 'Inspecting the repository now.',
                  timestamp: 2,
                  toolCalls: [
                    { id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' },
                  ],
                },
                {
                  id: 'assistant-final',
                  role: 'assistant',
                  content: 'The audit is complete.',
                  timestamp: 3,
                },
              ],
              createdAt: 1,
              updatedAt: 3,
              providerId: 'p1',
              systemPrompt: 'sys',
            },
          ],
          activeConversationId: 'conv-legacy',
        },
        3,
      );

      expect(migrated.conversations[0].messages[1].assistantMetadata).toEqual(
        expect.objectContaining({
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'legacy_migration',
        }),
      );
      expect(migrated.conversations[0].messages[2].assistantMetadata).toEqual(
        expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'legacy_migration',
        }),
      );
    });

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

    it('collapses same-version persisted conversations during merge', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'r-old',
              title: 'Old',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'researcher',
              createdAt: 1,
              updatedAt: 100,
            },
            {
              id: 'r-new',
              title: 'Newer',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'researcher',
              createdAt: 2,
              updatedAt: 300,
            },
          ],
          activeConversationId: 'r-old',
        },
        useChatStore.getState(),
      );

      const byId = Object.fromEntries(merged.conversations.map((c: any) => [c.id, c]));
      expect(byId['r-new'].isCanonical).toBe(true);
      expect(byId['r-old'].archivedFromMigration).toBe(true);
      expect(byId['r-old'].isCanonical).not.toBe(true);
      expect(merged.activeConversationId).toBe('r-new');
    });

    it('redirects the active conversation to the newest canonical when persisted state contains malformed archived canonicals', () => {
      const persistOptions = (useChatStore as any).persist.getOptions();
      const merged = persistOptions.merge(
        {
          conversations: [
            {
              id: 'legacy-main',
              title: 'Legacy Main',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'super-agent',
              isCanonical: true,
              createdAt: 1,
              updatedAt: 100,
            },
            {
              id: 'fresh-main',
              title: 'Fresh Main',
              messages: [],
              providerId: 'openai',
              systemPrompt: 'sys',
              personaId: 'super-agent',
              isCanonical: true,
              archivedFromMigration: true,
              createdAt: 2,
              updatedAt: 300,
            },
          ],
          activeConversationId: 'legacy-main',
        },
        useChatStore.getState(),
      );

      const byId = Object.fromEntries(merged.conversations.map((c: any) => [c.id, c]));
      expect(byId['fresh-main'].isCanonical).toBe(true);
      expect(byId['fresh-main'].archivedFromMigration).toBe(false);
      expect(byId['legacy-main'].archivedFromMigration).toBe(true);
      expect(byId['legacy-main'].isCanonical).toBe(false);
      expect(merged.activeConversationId).toBe('fresh-main');
    });
  });
});
