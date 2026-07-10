import {
  buildUntrackedExternalToolResult,
  observeExternalToolResultDurability,
} from '../../src/services/executionJournal/externalToolDurabilityLifecycle';

const input = {
  toolName: 'expo_eas_build',
  toolCallId: 'tool-call-1',
  argumentsText: '{"projectId":"project-1"}',
  resultText: '{"mode":"eas-workflow"}',
  conversationId: 'conversation-1',
  parentAgentRunId: 'agent-run-1',
  observedAt: 100,
};

const externalResolution = {
  kind: 'external' as const,
  observedStatus: 'pending' as const,
  remote: {
    provider: 'expo' as const,
    target: 'project-1',
    workflowRunId: 'workflow-1',
  },
  handle: {
    version: 1 as const,
    kind: 'expo_workflow_run' as const,
    sourceToolName: 'expo_eas_build',
    projectId: 'project-1',
    workflowRunId: 'workflow-1',
    credentialRef: 'EXPO_TOKEN',
  },
};

describe('external tool durability lifecycle', () => {
  it('persists before immediately scheduling a nonterminal observation', async () => {
    const order: string[] = [];
    const persist = jest.fn(async () => {
      order.push('persist');
      return {
        kind: 'created' as const,
        runId: 'run-1',
        handleId: 'handle-1',
        status: 'pending' as const,
        terminal: false,
      };
    });
    const schedule = jest.fn(async (runId: string) => {
      order.push('schedule');
      return { kind: 'scheduled', runId };
    });

    await expect(
      observeExternalToolResultDurability(input, {
        resolve: () => externalResolution,
        persist,
        schedule,
      }),
    ).resolves.toMatchObject({
      kind: 'persisted',
      observation: { kind: 'created', runId: 'run-1' },
      scheduling: { kind: 'scheduled', runId: 'run-1' },
    });
    expect(order).toEqual(['persist', 'schedule']);
  });

  it('does not schedule an already-terminal observation', async () => {
    const schedule = jest.fn();
    await expect(
      observeExternalToolResultDurability(input, {
        resolve: () => ({ ...externalResolution, observedStatus: 'succeeded' }),
        persist: async () => ({
          kind: 'created',
          runId: 'run-1',
          handleId: 'handle-1',
          status: 'succeeded',
          terminal: true,
        }),
        schedule,
      }),
    ).resolves.toMatchObject({
      kind: 'persisted',
      scheduling: { kind: 'not_required' },
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('fails closed when durable persistence is unavailable', async () => {
    const outcome = await observeExternalToolResultDurability(input, {
      resolve: () => externalResolution,
      persist: async () => {
        throw new Error('sqlite-unavailable');
      },
      schedule: jest.fn(),
    });
    expect(outcome).toEqual({
      kind: 'persistence_failed',
      reason: 'journal_unavailable',
      remote: externalResolution.remote,
    });
    if (outcome.kind !== 'persistence_failed') throw new Error('expected failure');
    expect(buildUntrackedExternalToolResult(outcome)).toContain(
      'Do not retry this launch automatically',
    );
  });

  it('preserves an unidentified launch as an explicit no-retry failure', async () => {
    const outcome = await observeExternalToolResultDurability(input, {
      resolve: () => ({
        kind: 'untracked_external',
        reason: 'external_run_unidentified',
        remote: null,
      }),
      persist: jest.fn(),
      schedule: jest.fn(),
    });
    expect(outcome).toMatchObject({
      kind: 'untracked_external',
      reason: 'external_run_unidentified',
    });
    if (outcome.kind !== 'untracked_external') throw new Error('expected untracked');
    expect(buildUntrackedExternalToolResult(outcome)).toContain('remote workflow may already');
  });

  it('keeps Android scheduling failure recoverable from the persisted journal', async () => {
    await expect(
      observeExternalToolResultDurability(input, {
        resolve: () => externalResolution,
        persist: async () => ({
          kind: 'created',
          runId: 'run-1',
          handleId: 'handle-1',
          status: 'pending',
          terminal: false,
        }),
        schedule: async () => {
          throw new Error('native-down');
        },
      }),
    ).resolves.toMatchObject({
      kind: 'persisted',
      scheduling: { kind: 'deferred', reason: 'native_bridge_unavailable' },
    });
  });
});
