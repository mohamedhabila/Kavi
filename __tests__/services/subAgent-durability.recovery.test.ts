jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  detectOrphans,
  getSessionContext,
  getSubAgent,
  getSubAgentsByParent,
  initSubAgentRegistry,
  installSubAgentDurabilityHarness,
  launchSubAgent,
  listActiveSubAgents,
  mockProvider,
  readPersistedJson,
  REGISTRY_CONTEXTS_KEY,
  REGISTRY_KEY,
  runOrchestrator,
  spawnSubAgent,
  type ActiveSubAgent,
  writePersistedJson,
} from '../helpers/subAgentDurabilityHarness';
import { listFacts } from '../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

installSubAgentDurabilityHarness();

describe('getSubAgentsByParent', () => {
  it('filters by parentConversationId', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone();
      return Promise.resolve();
    });

    await spawnSubAgent({ parentConversationId: 'conv-A', prompt: 'task A' }, mockProvider);
    await spawnSubAgent({ parentConversationId: 'conv-B', prompt: 'task B' }, mockProvider);

    const aAgents = getSubAgentsByParent('conv-A');
    const bAgents = getSubAgentsByParent('conv-B');

    expect(aAgents.length).toBeGreaterThanOrEqual(1);
    expect(bAgents.length).toBeGreaterThanOrEqual(1);
    expect(aAgents[0].parentConversationId).toBe('conv-A');
    expect(bAgents[0].parentConversationId).toBe('conv-B');
  });
});

describe('detectOrphans', () => {
  it('hydrates missing and invalid persisted termination causes as unknown', async () => {
    const now = Date.now();
    await writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'legacy-terminal',
        parentConversationId: 'conv-old',
        depth: 0,
        startedAt: now - 2,
        updatedAt: now - 1,
        status: 'completed',
        sandboxPolicy: 'inherit',
      },
      {
        sessionId: 'invalid-terminal',
        parentConversationId: 'conv-old',
        depth: 0,
        startedAt: now - 2,
        updatedAt: now - 1,
        status: 'error',
        terminationCause: 'app restarted before completion',
        sandboxPolicy: 'inherit',
      },
    ]);

    await initSubAgentRegistry();

    expect(getSubAgent('legacy-terminal')?.terminationCause).toBe('unknown');
    expect(getSubAgent('invalid-terminal')?.terminationCause).toBe('unknown');
  });

  it('marks stale running agents as error', async () => {
    // Simulate a stale agent in storage
    const staleAgent: ActiveSubAgent = {
      sessionId: 'stale-1',
      parentConversationId: 'conv-old',
      depth: 0,
      startedAt: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
      updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    await writePersistedJson(REGISTRY_KEY, [staleAgent]);

    const orphanCount = await detectOrphans();
    expect(orphanCount).toBe(1);

    const agent = getSubAgent('stale-1');
    expect(agent?.status).toBe('error');
    expect(agent?.terminationCause).toBe('app_restart');
    expect(agent?.output).toContain('app restarted');
  });

  it('marks unresolved running agents as interrupted on app restart even when recently updated', async () => {
    const recentAgent: ActiveSubAgent = {
      sessionId: 'recent-1',
      parentConversationId: 'conv-new',
      depth: 0,
      startedAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    await writePersistedJson(REGISTRY_KEY, [recentAgent]);

    const orphanCount = await detectOrphans();
    expect(orphanCount).toBeGreaterThanOrEqual(1);

    const agent = getSubAgent('recent-1');
    expect(agent?.status).toBe('error');
    expect(agent?.terminationCause).toBe('app_restart');
    expect(agent?.output).toContain('app restarted');
  });

  it('resumes the same worker when the only unmatched operation is an explicit wait', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'wait-restart-1',
      parentConversationId: 'conv-wait-restart',
      depth: 0,
      startedAt: now - 120_000,
      updatedAt: now - 30_000,
      status: 'running',
      sandboxPolicy: 'safe-only',
      iterations: 1,
      toolsUsed: ['wait'],
      activeToolName: 'wait',
      activeToolStartedAt: now - 30_000,
    };
    const prompt = 'Wait for two explicit checkpoints and report only verified results.';

    await writePersistedJson(REGISTRY_KEY, [runningAgent]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'wait-restart-1': {
        config: {
          parentConversationId: 'conv-wait-restart',
          prompt,
          sandboxPolicy: 'safe-only',
          tools: ['wait'],
        },
        provider: {
          ...mockProvider,
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
        },
        systemPrompt: 'You are a focused worker.',
        conversationSummary: '',
        transcriptRetainedFromStart: true,
        messages: [
          { id: 'user-wait', role: 'user', content: prompt, timestamp: now - 119_000 },
          {
            id: 'assistant-wait',
            role: 'assistant',
            content: '',
            timestamp: now - 30_000,
            toolCalls: [
              {
                id: 'call-wait-restart',
                name: 'wait',
                arguments: '{"ms":60000,"reason":"checkpoint 01/02"}',
                status: 'running',
              },
            ],
          },
        ],
      },
    });
    (runOrchestrator as jest.Mock).mockImplementation(() => new Promise(() => undefined));

    const orphanCount = await detectOrphans();
    for (
      let attempt = 0;
      attempt < 20 && !(runOrchestrator as jest.Mock).mock.calls.length;
      attempt++
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }

    expect(orphanCount).toBe(0);
    expect(runOrchestrator).toHaveBeenCalledTimes(1);
    expect((runOrchestrator as jest.Mock).mock.calls[0][0]).toMatchObject({
      conversationId: 'wait-restart-1',
      executionRunId: 'wait-restart-1',
    });
    const resumedMessages = (runOrchestrator as jest.Mock).mock.calls[0][0].messages;
    expect(resumedMessages.at(-2)).toMatchObject({
      role: 'tool',
      toolCallId: 'call-wait-restart',
      isError: true,
    });
    expect(JSON.parse(resumedMessages.at(-2).content)).toMatchObject({
      status: 'interrupted',
      code: 'app_restart',
      successful: false,
    });
    expect(resumedMessages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(prompt),
    });
    expect(getSubAgent('wait-restart-1')).toMatchObject({
      status: 'running',
      iterations: 1,
      toolsUsed: ['wait'],
    });
  });

  it('does not recover or orphan a worker already owned by this process on a repeated sweep', async () => {
    (runOrchestrator as jest.Mock).mockImplementation(() => new Promise(() => undefined));

    const launched = await launchSubAgent(
      {
        parentConversationId: 'conv-live-retry',
        prompt: 'Continue reading the assigned source.',
        tools: ['read_file'],
      },
      mockProvider,
    );
    for (
      let attempt = 0;
      attempt < 20 && !(runOrchestrator as jest.Mock).mock.calls.length;
      attempt++
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
    expect(getSubAgent(launched.sessionId)).toMatchObject({ status: 'running' });

    const orphanCount = await detectOrphans();

    expect(orphanCount).toBe(0);
    expect(runOrchestrator).toHaveBeenCalledTimes(1);
    expect(getSubAgent(launched.sessionId)).toMatchObject({
      status: 'running',
      terminationCause: 'unknown',
    });
  });

  it('restores persisted session context for interrupted workers so follow-up runs can resume with prior context', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'recoverable-1',
      parentConversationId: 'conv-recover',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 30_000,
      status: 'running',
      sandboxPolicy: 'safe-only',
    };

    await writePersistedJson(REGISTRY_KEY, [runningAgent]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'recoverable-1': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Inspect the API surface',
          systemPrompt: 'You are a focused worker.',
          sandboxPolicy: 'safe-only',
          tools: ['read_file', 'list_files'],
        },
        provider: mockProvider,
        systemPrompt: 'You are a focused worker.',
        conversationSummary: '',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            content: 'Inspect the API surface',
            timestamp: now - 59_000,
          },
        ],
      },
    });

    await detectOrphans();

    expect(getSubAgent('recoverable-1')?.status).toBe('error');
    expect(getSessionContext('recoverable-1')).toEqual(
      expect.objectContaining({
        systemPrompt: 'You are a focused worker.',
        config: expect.objectContaining({
          prompt: 'Inspect the API surface',
          sandboxPolicy: 'safe-only',
          tools: ['read_file', 'list_files'],
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Inspect the API surface' }),
        ]),
      }),
    );
  });

  it('redacts legacy persisted provider API keys when reloading session context snapshots', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'redacted-1',
      parentConversationId: 'conv-redacted',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 30_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    await writePersistedJson(REGISTRY_KEY, [runningAgent]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'redacted-1': {
        config: {
          parentConversationId: 'conv-redacted',
          prompt: 'Resume prior work',
        },
        provider: {
          ...mockProvider,
          apiKey: 'persisted-secret',
        },
        allProviders: [
          {
            ...mockProvider,
            apiKey: 'persisted-secret',
          },
        ],
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'Prior result',
        messages: [
          {
            id: 'msg-user-1',
            role: 'user',
            content: 'Resume prior work',
            timestamp: now - 59_000,
          },
        ],
      },
    });

    await detectOrphans();

    expect(getSessionContext('redacted-1')).toEqual(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: mockProvider.id,
          apiKey: '',
        }),
        allProviders: [
          expect.objectContaining({
            id: mockProvider.id,
            apiKey: '',
          }),
        ],
      }),
    );
  });

  it('restores terminal worker state from persisted conversation history before interrupting it', async () => {
    const now = Date.now();
    const runningAgent: ActiveSubAgent = {
      sessionId: 'recovered-1',
      parentConversationId: 'conv-recovered',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 45_000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };
    const completedSnapshot: ActiveSubAgent = {
      ...runningAgent,
      updatedAt: now - 1_000,
      status: 'completed',
      output: 'Recovered final worker output.',
      toolsUsed: ['read_file'],
    };

    await writePersistedJson(REGISTRY_KEY, [runningAgent]);

    await initSubAgentRegistry([
      {
        id: 'conv-recovered',
        title: 'Recovered conversation',
        messages: [
          {
            id: 'msg-worker-complete',
            role: 'assistant',
            content: 'Worker finished the recovery path.',
            timestamp: completedSnapshot.updatedAt,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: completedSnapshot,
            },
          },
        ],
        providerId: 'test',
        systemPrompt: 'system',
        createdAt: now - 120_000,
        updatedAt: completedSnapshot.updatedAt,
      } as any,
    ]);

    const agent = getSubAgent('recovered-1');
    expect(agent?.status).toBe('completed');
    expect(agent?.output).toBe('Recovered final worker output.');
  });

  it('durably removes stale execution fields from a newer cancelled registry record', async () => {
    const now = Date.now();
    const cancellationOutput = 'Cancelled because the supervising turn was stopped by the user.';
    const cancelledSnapshot: ActiveSubAgent = {
      sessionId: 'recovered-cancelled-1',
      parentConversationId: 'conv-recovered-cancelled',
      depth: 0,
      startedAt: now - 60_000,
      updatedAt: now - 2_000,
      status: 'cancelled',
      terminationCause: 'cancelled',
      sandboxPolicy: 'inherit',
      launchState: 'terminal',
      output: cancellationOutput,
      currentActivity: cancellationOutput,
      activityLog: [{ timestamp: now - 2_000, kind: 'status', text: cancellationOutput }],
    };
    const staleRegistryRecord: ActiveSubAgent = {
      ...cancelledSnapshot,
      updatedAt: now - 1_000,
      launchState: 'active',
      deadlineAt: now + 60_000,
      modelResponsePendingSince: now - 1_500,
      currentActivity: 'Tool read_file failed',
      activeToolName: 'read_file',
      activeToolStartedAt: now - 1_500,
      activityLog: [
        ...(cancelledSnapshot.activityLog ?? []),
        { timestamp: now - 1_000, kind: 'status', text: 'Tool read_file failed' },
      ],
    };

    await writePersistedJson(REGISTRY_KEY, [staleRegistryRecord]);

    await initSubAgentRegistry([
      {
        id: 'conv-recovered-cancelled',
        title: 'Recovered cancelled conversation',
        messages: [
          {
            id: 'msg-worker-cancelled',
            role: 'assistant',
            content: cancellationOutput,
            timestamp: cancelledSnapshot.updatedAt,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'cancelled',
              snapshot: cancelledSnapshot,
            },
          },
        ],
        providerId: 'test',
        systemPrompt: 'system',
        createdAt: now - 120_000,
        updatedAt: cancelledSnapshot.updatedAt,
      } as any,
    ]);

    const expectedTerminalState = expect.objectContaining({
      status: 'cancelled',
      terminationCause: 'cancelled',
      launchState: 'terminal',
      output: cancellationOutput,
      currentActivity: cancellationOutput,
      deadlineAt: undefined,
      modelResponsePendingSince: undefined,
      activeToolName: undefined,
      activeToolStartedAt: undefined,
    });
    expect(getSubAgent('recovered-cancelled-1')).toEqual(expectedTerminalState);
    const persistedRecord = readPersistedJson<ActiveSubAgent[]>(REGISTRY_KEY)?.[0];
    expect(persistedRecord).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        terminationCause: 'cancelled',
        launchState: 'terminal',
        output: cancellationOutput,
        currentActivity: cancellationOutput,
      }),
    );
    expect(persistedRecord).not.toHaveProperty('deadlineAt');
    expect(persistedRecord).not.toHaveProperty('modelResponsePendingSince');
    expect(persistedRecord).not.toHaveProperty('activeToolName');
    expect(persistedRecord).not.toHaveProperty('activeToolStartedAt');
  });
});

describe('initSubAgentRegistry', () => {
  it('loads from storage and detects orphans', async () => {
    await writePersistedJson(REGISTRY_KEY, []);
    await initSubAgentRegistry();
    expect(listActiveSubAgents()).toEqual([]);
  });

  it('skips only malformed persisted session contexts and keeps valid siblings', async () => {
    const now = Date.now();
    await writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'recover-good',
        parentConversationId: 'conv-recover',
        depth: 0,
        startedAt: now - 60_000,
        updatedAt: now - 30_000,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
      {
        sessionId: 'recover-bad',
        parentConversationId: 'conv-recover',
        depth: 0,
        startedAt: now - 55_000,
        updatedAt: now - 25_000,
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'recover-good': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Recover the valid worker',
        },
        provider: mockProvider,
        systemPrompt: 'You are a worker.',
        conversationSummary: 'Recovered summary',
        messages: [
          {
            id: 'msg-good',
            role: 'user',
            content: 'Recover the valid worker',
            timestamp: now - 59_000,
          },
        ],
      },
      'recover-bad': {
        config: {
          parentConversationId: 'conv-recover',
          prompt: 'Broken entry',
        },
        provider: mockProvider,
        systemPrompt: 'broken',
        conversationSummary: 'broken',
        messages: 'not-an-array',
      },
    });

    await initSubAgentRegistry();

    expect(getSessionContext('recover-good')).toEqual(
      expect.objectContaining({
        conversationSummary: 'Recovered summary',
        messages: [expect.objectContaining({ role: 'user', content: 'Recover the valid worker' })],
      }),
    );
    expect(getSessionContext('recover-bad')).toBeUndefined();
  });

  it('reconciles a durable pending worker outcome after restart without trusting prose alone', async () => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    const now = Date.now();

    await writePersistedJson(REGISTRY_KEY, [
      {
        sessionId: 'reconcile-worker-1',
        parentConversationId: 'reconcile-thread-1',
        agentRunId: 'reconcile-parent-run-1',
        workstreamId: 'reconcile-task-1',
        depth: 1,
        startedAt: now - 60_000,
        updatedAt: now - 1_000,
        status: 'completed',
        sandboxPolicy: 'safe-only',
        launchState: 'terminal',
        output: 'The requested file was created.',
        completionState: 'verified_success',
        outcomeReconciliation: {
          status: 'pending',
          code: 'pending',
          attemptCount: 0,
          updatedAt: now - 1_000,
        },
      },
    ]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      'reconcile-worker-1': {
        config: {
          parentConversationId: 'reconcile-thread-1',
          prompt: 'Create the requested file.',
          agentRunId: 'reconcile-parent-run-1',
          workstreamId: 'reconcile-task-1',
          memorySelectionScope: {
            memoryConversationId: 'reconcile-memory-root-1',
            sourceThreadId: 'reconcile-thread-1',
            personaId: 'super-agent',
            taskId: 'reconcile-task-1',
          },
        },
        provider: mockProvider,
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'The requested file was created.',
        messages: [
          {
            id: 'reconcile-turn-1',
            role: 'assistant',
            content: '',
            timestamp: now - 2_000,
            toolCalls: [
              {
                id: 'reconcile-tool-call-1',
                name: 'write_file',
                arguments: '{"path":"deliverables/result.md"}',
                status: 'completed',
                result: '{"status":"ok","observation":"deliverables/result.md exists"}',
              },
            ],
          },
        ],
      },
    });

    await initSubAgentRegistry();

    const recovered = getSubAgent('reconcile-worker-1');
    expect(recovered?.outcomeReconciliation).toEqual(
      expect.objectContaining({
        status: 'completed',
        code: 'recorded_verified',
        attemptCount: 1,
      }),
    );
    expect(
      listFacts({ originTaskId: 'reconcile-task-1' }).map((fact) => ({
        kind: fact.memoryKind,
        actor: fact.sourceActorId,
        run: fact.sourceRunId,
        parentRun: fact.attributes.parentRunId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: 'agent_run',
          actor: 'reconcile-worker-1',
          run: 'reconcile-worker-1',
          parentRun: 'reconcile-parent-run-1',
        },
        {
          kind: 'evidence_span',
          actor: 'reconcile-worker-1',
          run: 'reconcile-worker-1',
          parentRun: 'reconcile-parent-run-1',
        },
      ]),
    );
    closeMemoryDb();
  });
});
