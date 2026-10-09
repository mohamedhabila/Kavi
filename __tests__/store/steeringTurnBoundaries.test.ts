import { getAgentRunMessageSlice } from '../../src/services/agents/lifecycle/agentRunStateMachine';
import { planForegroundModelRestartRecovery } from '../../src/services/executionJournal/foregroundModelExecutionRecovery';
import {
  getProtectedExecutionMessageIds,
  preserveProtectedExecutionMessages,
} from '../../src/store/chatExecutionMessageProtection';
import { getMemoryPublicationMutationLockedMessageIds } from '../../src/store/chatMessageMemoryPublicationGuards';
import { sanitizeMessage } from '../../src/store/chatPersistenceMessages';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

// A user message sent while a run works is read by that run at its next step. Every
// place that finds where a turn begins must keep such a "steering" message inside the
// run's turn, or the run's own rows look like they belong to a newer request.

const TOOL_STEP = {
  kind: 'intermediate',
  completionStatus: 'complete',
  finishReason: 'tool_calls',
} as const;

function steeredRun(): Message[] {
  return [
    { id: 'request', role: 'user', content: 'Plan a dinner for my team.', timestamp: 1 },
    {
      id: 'step-1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      assistantMetadata: TOOL_STEP,
      toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{}', status: 'completed' }],
    },
    { id: 'call-1-result', role: 'tool', toolCallId: 'call-1', content: 'ok', timestamp: 3 },
    {
      id: 'steer',
      role: 'user',
      content: 'Make it vegetarian.',
      timestamp: 4,
      steerOfRunId: 'run-1',
    },
    { id: 'step-2', role: 'assistant', content: 'Looking for vegetarian places', timestamp: 5 },
  ];
}

function owner(runId: string) {
  return {
    surface: 'foreground' as const,
    runId,
    requestMessageId: 'request',
    assistantMessageId: 'step-2',
    controlEpoch: 0,
  };
}

describe('execution protection', () => {
  it("protects the messages that steered the projecting run, with the run's own rows", () => {
    const ids = getProtectedExecutionMessageIds({
      messages: steeredRun(),
      agentRuns: [],
      modelProjectionOwner: owner('run-1'),
    });

    expect([...ids].sort()).toEqual(['request', 'steer', 'step-2']);
  });

  it('releases them with the projection, and ignores steers of another run', () => {
    expect(
      getProtectedExecutionMessageIds({
        messages: steeredRun(),
        agentRuns: [],
        modelProjectionOwner: undefined,
      }).size,
    ).toBe(0);
    expect(
      getProtectedExecutionMessageIds({
        messages: steeredRun(),
        agentRuns: [],
        modelProjectionOwner: owner('run-2'),
      }).has('steer'),
    ).toBe(false);
  });

  it("keeps the projecting run's steer when compaction drops it", () => {
    const messages = steeredRun();
    const kept = preserveProtectedExecutionMessages(
      { messages, agentRuns: [], modelProjectionOwner: owner('run-1') },
      messages.filter((message) => message.id === 'step-2'),
    );

    expect(kept.map((message) => message.id)).toEqual(['request', 'steer', 'step-2']);
  });
});

describe('persistence', () => {
  it('keeps the steering marker on a user message only', () => {
    const options = { preserveReplay: false, preserveReasoning: false };
    const steer = steeredRun()[3]!;

    expect(sanitizeMessage(steer, options).steerOfRunId).toBe('run-1');
    expect(
      sanitizeMessage({ ...steeredRun()[4]!, steerOfRunId: 'run-1' }, options).steerOfRunId,
    ).toBeUndefined();
  });
});

describe('memory publication locks', () => {
  it('locks the whole steered turn once its final answer is enqueued', () => {
    const messages: Message[] = [
      ...steeredRun(),
      {
        id: 'final',
        role: 'assistant',
        content: 'Here is the plan.',
        timestamp: 6,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
        memoryPublication: { version: 1, disposition: 'enqueued' },
      },
    ];

    expect([...getMemoryPublicationMutationLockedMessageIds(messages)]).toEqual([
      'request',
      'step-1',
      'call-1-result',
      'steer',
      'step-2',
      'final',
    ]);
  });
});

describe('agent run message slice', () => {
  it('continues past a steer and stops at the next request', () => {
    const messages: Message[] = [
      ...steeredRun(),
      { id: 'next-request', role: 'user', content: 'Thanks', timestamp: 7 },
    ];

    expect(getAgentRunMessageSlice(messages, 'request').map((message) => message.id)).toEqual([
      'request',
      'step-1',
      'call-1-result',
      'steer',
      'step-2',
    ]);
  });
});

describe('foreground restart recovery', () => {
  it('finds the run’s projection after a steer', () => {
    const conversation: Conversation = {
      id: 'conversation-1',
      title: 'Conversation',
      providerId: 'provider-1',
      systemPrompt: 'Be helpful.',
      createdAt: 1,
      updatedAt: 2,
      messages: steeredRun(),
      modelProjectionOwner: {
        surface: 'foreground',
        runId: 'execution-1',
        requestMessageId: 'request',
        assistantMessageId: 'step-2',
        controlEpoch: 0,
      },
    };

    const plan = planForegroundModelRestartRecovery(
      {
        runId: 'execution-1',
        conversationId: 'conversation-1',
        requestMessageId: 'request',
        assistantMessageId: 'step-2',
        taskId: null,
        createdAt: 1,
        expectedStatus: 'running',
        controlEpoch: 0,
        updatedAt: 10,
        checkpointId: 'checkpoint-1',
        checkpointStateDigest: 'a'.repeat(64),
      },
      conversation,
    );

    expect(plan).toMatchObject({ status: 'failed', projectionMessageId: 'step-2' });
  });
});
