import {
  planForegroundModelRestartRecovery,
  recoverInterruptedForegroundModelExecutions,
} from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import { AMBIGUOUS_EFFECT_RESTART_ERROR } from '../../src/services/executionJournal/toolEffectRestartProjection';
import { createForegroundModelGenerationChangedError } from '../../src/services/runtimeError';
import { conversation, harness, lease } from '../helpers/foregroundModelRecoveryFixtures';

describe('foreground model restart recovery execution', () => {
  // Nothing ever settles an ordinary tool's interrupted effect, so retaining the generation
  // kept the conversation's projection owner forever and every later send was refused.
  it('closes a generation whose effect was interrupted and releases the conversation', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
          },
        ],
      }),
      [lease()],
      () => ({
        kind: 'reconciliation_required',
        observedAt: 10,
        reason: 'ambiguous_effect',
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'failed' },
    ]);
    expect(test.getConversation().messages[1]?.toolCalls?.[0]).toMatchObject({
      status: 'failed',
      failureKind: 'reconciliation_required',
      error: AMBIGUOUS_EFFECT_RESTART_ERROR,
    });
    expect(test.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(test.releaseProjection).toHaveBeenCalled();
    expect(test.getConversation().modelProjectionOwner).toBeUndefined();
  });

  it('leaves task-owned tool projection and counting to AgentRun recovery', async () => {
    const taskLease = lease({ taskId: 'agent-run-1' });
    const test = harness(
      conversation({
        agentRuns: [
          {
            id: 'agent-run-1',
            userMessageId: 'request-1',
            goal: 'Send the email.',
            status: 'running',
            createdAt: 1,
            updatedAt: 2,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
          },
        ],
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [{ id: 'tool-1', name: 'send_email', arguments: '{}', status: 'running' }],
          },
        ],
      }),
      [taskLease],
      () => ({ kind: 'verified', observedAt: 10 }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'failed' },
    ]);
    expect(test.getConversation().messages[1]?.toolCalls?.[0]?.status).toBe('running');
    expect(test.getConversation().agentRuns?.[0]?.summary).toMatchObject({
      completedTools: 0,
      failedTools: 0,
    });
  });

  it('persists an interrupted projection before atomically closing its generation', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [
              {
                id: 'tool-1',
                name: 'send_email',
                arguments: '{}',
                status: 'running',
              },
            ],
          },
        ],
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'failed' },
    ]);

    expect(test.mutateProjection).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      20,
    );
    expect(test.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({ runId: 'run-1' }),
        status: 'failed',
        projectionMessageId: 'assistant-1',
        projectionState: expect.objectContaining({ recovery: 'app_restart_projection' }),
      }),
    );
    expect(test.flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      test.complete.mock.invocationCallOrder[0],
    );
    expect(test.complete.mock.invocationCallOrder[0]).toBeLessThan(
      test.releaseProjection.mock.invocationCallOrder[0],
    );
    expect(test.flushChatState).toHaveBeenCalledTimes(2);
    expect(test.getConversation().messages[1]).toEqual(
      expect.objectContaining({
        content: 'Response interrupted because the app restarted before completion.',
        assistantMetadata: expect.objectContaining({ finishReason: 'app_restarted' }),
        toolCalls: [expect.objectContaining({ status: 'failed', completedAt: 20 })],
      }),
    );
  });

  it('closes an already durable complete response without rewriting it', async () => {
    const test = harness(
      conversation({
        messages: [
          { id: 'request-1', role: 'user', content: 'Do the work.', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Done.',
            timestamp: 2,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
          },
        ],
      }),
    );

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'succeeded' },
    ]);
    expect(test.mutateProjection).toHaveBeenCalledTimes(1);
    expect(test.flushChatState).toHaveBeenCalledTimes(2);
    expect(test.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(test.releaseProjection).toHaveBeenCalledTimes(1);
  });

  it('does not close the journal when the repaired chat projection cannot be flushed', async () => {
    const test = harness(conversation());
    test.flushChatState.mockRejectedValueOnce(new Error('disk full'));

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'journal_unavailable' },
    ]);
    expect(test.complete).not.toHaveBeenCalled();
    expect(test.releaseProjection).not.toHaveBeenCalled();
  });

  it('reports a stale generation without retrying model or tool execution', async () => {
    const test = harness(conversation());
    test.complete.mockRejectedValueOnce(createForegroundModelGenerationChangedError());

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'generation_changed' },
    ]);
    expect(test.complete).toHaveBeenCalledTimes(1);
    expect(test.releaseProjection).not.toHaveBeenCalled();
  });

  it('does not infer a stale generation from untyped error text', async () => {
    const test = harness(conversation());
    test.complete.mockRejectedValueOnce(new Error('foreground_model_journal_generation_changed'));

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'blocked', runId: 'run-1', reason: 'journal_unavailable' },
    ]);
    expect(test.releaseProjection).not.toHaveBeenCalled();
  });

  it('propagates an unavailable candidate query instead of claiming no recovery work', async () => {
    const test = harness(conversation());
    test.dependencies.listPending = () => {
      throw new Error('journal unavailable');
    };
    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).rejects.toThrow(
      'journal unavailable',
    );
  });

  it('cancels an unclaimed queued generation without mutating or flushing chat state', async () => {
    const queuedLease = lease({ expectedStatus: 'queued' });
    const test = harness(conversation({ modelProjectionOwner: undefined }), [queuedLease]);

    await expect(recoverInterruptedForegroundModelExecutions(test.dependencies)).resolves.toEqual([
      { kind: 'recovered', runId: 'run-1', status: 'cancelled' },
    ]);
    expect(test.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(test.flushChatState).not.toHaveBeenCalled();
    expect(test.releaseProjection).toHaveBeenCalledTimes(1);
  });

  it('advances a fair cursor past a full blocked page to recover later generations', async () => {
    const leases = Array.from({ length: 33 }, (_, index) =>
      lease({ runId: `run-${index + 1}`, createdAt: index + 1 }),
    );
    const last = leases.at(-1)!;
    const ownedConversation = conversation({
      modelProjectionOwner: {
        surface: 'foreground',
        runId: last.runId,
        requestMessageId: last.requestMessageId,
        assistantMessageId: last.assistantMessageId,
        controlEpoch: last.controlEpoch,
      },
    });
    const test = harness(ownedConversation, leases);
    test.dependencies.mutateProjection = async (candidate) => {
      if (candidate.runId !== last.runId) {
        return { kind: 'blocked', runId: candidate.runId, reason: 'projection_owner_changed' };
      }
      const plan = planForegroundModelRestartRecovery(candidate, ownedConversation);
      if ('kind' in plan) return plan;
      return { kind: 'applied', plan, conversation: ownedConversation };
    };

    const results = await recoverInterruptedForegroundModelExecutions(test.dependencies);

    expect(test.listPending).toHaveBeenCalledTimes(2);
    expect(results).toContainEqual({
      kind: 'recovered',
      runId: last.runId,
      status: 'failed',
    });
  });
});
