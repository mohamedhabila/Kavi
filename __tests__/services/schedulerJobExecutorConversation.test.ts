import type { OrchestratorCallbacks } from '../../src/engine/orchestrator';
import type { ToolCall } from '../../src/types/message';
import {
  abortAllScheduledJobExecutions,
  beginModelProjectionIntent,
  cleanupSchedulerJobExecutorConversationHarness,
  emitSchedulerFailure,
  emitSchedulerFinal,
  emitSchedulerToolTurn,
  executeJob,
  executeScheduledJob,
  findMockConversation,
  getScheduledExecutionLifecycleEpoch,
  mockChatState,
  mockCheckpointScheduledAttemptCompletion,
  mockConversation,
  mockFlushChatStorePersistenceNow,
  mockRunOrchestrator,
  resetSchedulerJobExecutorConversationHarness,
  schedulerToolMessageOutcome,
  scheduledJob,
} from '../helpers/schedulerJobExecutorConversationHarness';

describe('scheduled job conversation transcript', () => {
  beforeEach(resetSchedulerJobExecutorConversationHarness);

  afterEach(cleanupSchedulerJobExecutorConversationHarness);

  it('keeps the assistant tool turn, tool result, and final answer in chronological turns', async () => {
    const toolReplay = { openaiResponseId: 'response-tool-turn' };
    const finalReplay = { openaiResponseId: 'response-final-turn' };
    const runningToolCall: ToolCall = {
      id: 'tool-call-1',
      name: 'web_fetch',
      arguments: '{"urls":["https://example.com/weather"]}',
      status: 'running',
    };
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerToolTurn(
          callbacks,
          'I will check the current forecast.',
          [{ ...runningToolCall, status: 'pending' }],
          toolReplay,
        );
        callbacks.onToolCallStart?.(runningToolCall);
        callbacks.onToolCallComplete?.({
          ...runningToolCall,
          status: 'completed',
          result: 'Sunny, 24 C',
        });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome('tool-call-1', 'Sunny, 24 C'));
        emitSchedulerFinal(callbacks, 'It is sunny and 24 C.', finalReplay);
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).resolves.toEqual({
      output: 'It is sunny and 24 C.',
      conversationId: 'scheduled-conversation',
    });

    const transcript = findMockConversation('scheduled-conversation').messages;
    expect(transcript.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Check the weather' },
      { role: 'assistant', content: 'I will check the current forecast.' },
      { role: 'tool', content: 'Sunny, 24 C' },
      { role: 'assistant', content: 'It is sunny and 24 C.' },
    ]);
    expect(transcript[1]).toMatchObject({
      providerReplay: toolReplay,
      toolCalls: [expect.objectContaining({ id: 'tool-call-1', status: 'completed' })],
    });
    expect(transcript[2]).toMatchObject({ toolCallId: 'tool-call-1', isError: false });
    expect(transcript[3]).toMatchObject({ providerReplay: finalReplay });
    expect(findMockConversation('scheduled-conversation').modelProjectionOwner).toBeUndefined();
  });

  it('pairs a preflight-rejected tool result when tool start and completion are omitted', async () => {
    const unknownTool: ToolCall = {
      id: 'unknown-tool-call',
      name: 'unregistered_weather_tool',
      arguments: '{}',
      status: 'pending',
    };
    const rejectedResult = 'Tool "unregistered_weather_tool" is not registered.';
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerToolTurn(callbacks, 'I will try the requested weather tool.', [unknownTool]);
        callbacks.onToolMessage?.(
          schedulerToolMessageOutcome(unknownTool.id, rejectedResult, 'failed'),
        );
        emitSchedulerFinal(callbacks, 'That weather tool is unavailable.');
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).resolves.toMatchObject({
      output: 'That weather tool is unavailable.',
    });

    const transcript = findMockConversation('scheduled-conversation').messages;
    expect(transcript.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Check the weather' },
      { role: 'assistant', content: 'I will try the requested weather tool.' },
      { role: 'tool', content: rejectedResult },
      { role: 'assistant', content: 'That weather tool is unavailable.' },
    ]);
    expect(transcript[1]).toMatchObject({
      toolCalls: [
        expect.objectContaining({
          id: unknownTool.id,
          status: 'failed',
          error: rejectedResult,
        }),
      ],
    });
    expect(transcript[2]).toMatchObject({
      toolCallId: unknownTool.id,
      isError: true,
    });
  });

  it('defers surfaced output until every sibling tool result is appended', async () => {
    const surfaceTool: ToolCall = {
      id: 'surface-tool-call',
      name: 'sessions_surface_output',
      arguments: '{"sessionId":"worker-1"}',
      status: 'pending',
    };
    const siblingTool: ToolCall = {
      id: 'sibling-tool-call',
      name: 'web_fetch',
      arguments: '{"urls":["https://example.com"]}',
      status: 'pending',
    };
    const surfaceResult = JSON.stringify({
      status: 'surfaced',
      sessionId: 'worker-1',
      output: 'Worker-authored final answer.',
    });
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerToolTurn(callbacks, 'I will gather both results.', [surfaceTool, siblingTool]);
        callbacks.onToolCallComplete?.({
          ...surfaceTool,
          status: 'completed',
          result: surfaceResult,
        });
        callbacks.onToolCallComplete?.({
          ...siblingTool,
          status: 'completed',
          result: 'Sibling evidence',
        });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(surfaceTool.id, surfaceResult));
        expect(
          findMockConversation('scheduled-conversation').messages.some(
            (message) => message.content === 'Worker-authored final answer.',
          ),
        ).toBe(false);
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(siblingTool.id, 'Sibling evidence'));
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).resolves.toMatchObject({
      output: 'Worker-authored final answer.',
    });

    const transcript = findMockConversation('scheduled-conversation').messages;
    expect(transcript.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(transcript[1].toolCalls?.map((toolCall) => toolCall.id)).toEqual([
      surfaceTool.id,
      siblingTool.id,
    ]);
    expect(transcript[2]).toMatchObject({ toolCallId: surfaceTool.id });
    expect(transcript[3]).toMatchObject({
      toolCallId: siblingTool.id,
      content: 'Sibling evidence',
    });
    expect(transcript[4]).toMatchObject({
      role: 'assistant',
      content: 'Worker-authored final answer.',
      assistantMetadata: expect.objectContaining({
        completionStatus: 'complete',
        finishReason: 'graph_finalized',
      }),
    });
  });

  it('preserves replay and chronology across consecutive empty-content tool turns', async () => {
    const firstTool: ToolCall = {
      id: 'tool-call-1',
      name: 'web_fetch',
      arguments: '{}',
      status: 'running',
    };
    const secondTool: ToolCall = {
      id: 'tool-call-2',
      name: 'read_file',
      arguments: '{"path":"forecast.txt"}',
      status: 'running',
    };
    const firstReplay = { openaiResponseId: 'response-tool-1' };
    const secondReplay = { openaiResponseId: 'response-tool-2' };
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerToolTurn(callbacks, 'Fetch the forecast.', [firstTool], firstReplay);
        callbacks.onToolCallStart?.(firstTool);
        callbacks.onToolCallComplete?.({ ...firstTool, status: 'completed', result: 'forecast' });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(firstTool.id, 'forecast'));
        emitSchedulerToolTurn(callbacks, '', [secondTool], secondReplay);
        callbacks.onToolCallStart?.(secondTool);
        callbacks.onToolCallComplete?.({ ...secondTool, status: 'completed', result: 'details' });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(secondTool.id, 'details'));
        emitSchedulerFinal(callbacks, 'Forecast ready.');
        callbacks.onDone?.();
      },
    );

    await executeJob();

    const transcript = findMockConversation('scheduled-conversation').messages;
    expect(transcript.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Check the weather' },
      { role: 'assistant', content: 'Fetch the forecast.' },
      { role: 'tool', content: 'forecast' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'details' },
      { role: 'assistant', content: 'Forecast ready.' },
    ]);
    expect(transcript[1]).toMatchObject({ providerReplay: firstReplay });
    expect(transcript[3]).toMatchObject({
      providerReplay: secondReplay,
      toolCalls: [expect.objectContaining({ id: secondTool.id, status: 'completed' })],
    });
  });

  it('appends an ordinary post-tool terminal failure after its evidence', async () => {
    const tool: ToolCall = {
      id: 'tool-call-1',
      name: 'web_fetch',
      arguments: '{}',
      status: 'running',
    };
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerToolTurn(callbacks, 'Checking first.', [tool]);
        callbacks.onToolCallStart?.(tool);
        callbacks.onToolCallComplete?.({ ...tool, status: 'completed', result: 'partial' });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(tool.id, 'partial'));
        callbacks.onAgentControlGraphStateChange?.({
          status: 'blocked',
          terminalReason: 'missing_required_side_effect',
        });
        emitSchedulerFailure(callbacks, 'The required action was not completed.');
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).rejects.toMatchObject({
      name: 'NonRetryableSchedulerExecutionError',
    });

    const transcript = findMockConversation('scheduled-conversation').messages;
    expect(transcript.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Check the weather' },
      { role: 'assistant', content: 'Checking first.' },
      { role: 'tool', content: 'partial' },
      { role: 'assistant', content: 'The required action was not completed.' },
    ]);
    expect(transcript.at(-1)).toMatchObject({
      isError: true,
      assistantMetadata: expect.objectContaining({
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      }),
    });
    expect(findMockConversation('scheduled-conversation').modelProjectionOwner).toBeUndefined();
  });

  it('resets streamed content and reasoning at a post-tool turn boundary', async () => {
    const tool: ToolCall = {
      id: 'tool-call-1',
      name: 'web_fetch',
      arguments: '{}',
      status: 'running',
    };
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        callbacks.onReasoning?.('first-turn reasoning');
        callbacks.onToken?.('first-turn text');
        emitSchedulerToolTurn(callbacks, 'First turn.', [tool]);
        callbacks.onToolCallStart?.(tool);
        callbacks.onToolCallComplete?.({ ...tool, status: 'completed', result: 'evidence' });
        callbacks.onToolMessage?.(schedulerToolMessageOutcome(tool.id, 'evidence'));
        callbacks.onReasoning?.('second-turn reasoning');
        callbacks.onToken?.('second-turn text');
        emitSchedulerFinal(callbacks, 'Second turn final.');
        callbacks.onDone?.();
      },
    );

    await executeJob();

    const assistantTurns = findMockConversation('scheduled-conversation').messages.filter(
      (message) => message.role === 'assistant',
    );
    expect(assistantTurns).toHaveLength(2);
    expect(assistantTurns[0]).toMatchObject({
      content: 'First turn.',
      reasoning: 'first-turn reasoning',
    });
    expect(assistantTurns[1]).toMatchObject({
      content: 'Second turn final.',
      reasoning: 'second-turn reasoning',
    });
  });

  it("runs with the conversation's own persona without rewriting it", async () => {
    const conversation = {
      ...mockConversation('active-conversation'),
      personaId: 'travel-guide',
      modelOverride: 'conversation-model',
    };
    mockChatState.conversations = [conversation];
    mockChatState.activeConversationId = conversation.id;
    mockRunOrchestrator.mockImplementationOnce(
      async (options: { personaId?: string; model?: string }, callbacks: OrchestratorCallbacks) => {
        expect(options.personaId).toBe('travel-guide');
        expect(options.model).toBe('job-model');
        emitSchedulerFinal(callbacks, 'Persona response.');
        callbacks.onDone?.();
      },
    );

    await executeJob({
      ...scheduledJob(),
      payload: { prompt: 'Say hello', providerId: 'openai', model: 'job-model' },
    });

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(findMockConversation(conversation.id)).toMatchObject({
      personaId: 'travel-guide',
      modelOverride: 'conversation-model',
    });
    expect(mockChatState.updatePersonaInConversation).not.toHaveBeenCalled();
    expect(mockChatState.updateModelInConversation).not.toHaveBeenCalled();
  });

  it('reuses an exact completed occurrence and releases its temporary owner', async () => {
    const conversation = mockConversation('recovered-conversation');
    conversation.messages = [
      {
        id: 'scheduled:occurrence-job-1:user',
        role: 'user',
        content: 'Check the weather',
        timestamp: 2,
      },
      {
        id: 'scheduled:occurrence-job-1:assistant',
        role: 'assistant',
        content: 'Already completed.',
        timestamp: 3,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];
    mockChatState.conversations = [conversation];

    await expect(executeJob()).resolves.toEqual({
      output: 'Already completed.',
      conversationId: conversation.id,
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(findMockConversation(conversation.id).modelProjectionOwner).toBeUndefined();
    expect(findMockConversation(conversation.id).messages).toHaveLength(2);
    expect(mockCheckpointScheduledAttemptCompletion).toHaveBeenCalledTimes(1);
  });

  it('prefers the durable occurrence transcript over a conflicting retry pointer', async () => {
    const projected = mockConversation('projected-conversation');
    projected.messages = [
      {
        id: 'scheduled:occurrence-job-1:user',
        role: 'user',
        content: 'Check the weather',
        timestamp: 2,
      },
      {
        id: 'scheduled:occurrence-job-1:assistant',
        role: 'assistant',
        content: '',
        timestamp: 3,
      },
    ];
    const stalePointer = mockConversation('stale-retry-conversation');
    mockChatState.conversations = [stalePointer, projected];
    mockRunOrchestrator.mockImplementationOnce(
      async (options: { conversationId: string }, callbacks: OrchestratorCallbacks) => {
        expect(options.conversationId).toBe(projected.id);
        emitSchedulerFinal(callbacks, 'Recovered in the durable transcript.');
        callbacks.onDone?.();
      },
    );

    await expect(
      executeJob({ ...scheduledJob(), retryConversationId: stalePointer.id }),
    ).resolves.toMatchObject({
      output: 'Recovered in the durable transcript.',
      conversationId: projected.id,
    });

    expect(findMockConversation(stalePointer.id).messages).toEqual([]);
    expect(findMockConversation(projected.id).modelProjectionOwner).toBeUndefined();
  });

  it('does not configure or append when foreground intent owns the target', async () => {
    const conversation = mockConversation('active-conversation');
    mockChatState.conversations = [conversation];
    mockChatState.activeConversationId = conversation.id;
    const before = JSON.stringify(conversation);
    const intent = beginModelProjectionIntent(conversation.id, 'foreground-request');

    try {
      await expect(
        executeJob({
          ...scheduledJob(),
          payload: {
            prompt: 'Do not interleave.',
            providerId: 'openai',
            model: 'different-model',
          },
        }),
      ).rejects.toMatchObject({
        name: 'SchedulerProjectionBusyError',
        reason: 'model_projection_intent',
      });
    } finally {
      intent.release();
    }

    expect(JSON.stringify(findMockConversation(conversation.id))).toBe(before);
    expect(mockChatState.updatePersonaInConversation).not.toHaveBeenCalled();
    expect(mockChatState.updateModelInConversation).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('aborts and unregisters a safe execution as a retryable failure', async () => {
    mockRunOrchestrator.mockImplementationOnce(
      async (
        options: {
          signal?: AbortController;
          agentRunId?: string;
          executionRunId?: string;
        },
        callbacks: OrchestratorCallbacks,
      ) => {
        expect(options).toMatchObject({
          agentRunId: 'attempt-job-1',
          executionRunId: 'occurrence-job-1',
        });
        expect(options.signal?.signal.aborted).toBe(false);
        expect(abortAllScheduledJobExecutions()).toBe(1);
        expect(options.signal?.signal.aborted).toBe(true);
        callbacks.onToken?.('late streamed token');
        emitSchedulerFinal(callbacks, 'Late answer after background abort.');
        callbacks.onAgentControlGraphStateChange?.({
          status: 'cancelled',
          terminalReason: 'user_cancelled',
        });
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).rejects.toMatchObject({
      name: 'SchedulerAppBackgroundAbortError',
      conversationId: 'scheduled-conversation',
    });
    expect(abortAllScheduledJobExecutions()).toBe(0);
    expect(
      findMockConversation('scheduled-conversation').messages.some((message) =>
        message.content.includes('Late answer'),
      ),
    ).toBe(false);
    expect(findMockConversation('scheduled-conversation').modelProjectionOwner).toBeUndefined();

    mockChatState.conversations.push(mockConversation('delivery-conversation'));
    mockRunOrchestrator.mockImplementationOnce(
      async (options: { conversationId: string }, callbacks: OrchestratorCallbacks) => {
        expect(options.conversationId).toBe('scheduled-conversation');
        emitSchedulerFinal(callbacks, 'Recovered on retry.');
        callbacks.onDone?.();
      },
    );

    await expect(
      executeJob({
        ...scheduledJob(),
        retryConversationId: 'scheduled-conversation',
      }),
    ).resolves.toMatchObject({
      output: 'Recovered on retry.',
      conversationId: 'scheduled-conversation',
    });
    expect(mockChatState.ensureConversation).toHaveBeenCalledTimes(1);
    expect(abortAllScheduledJobExecutions()).toBe(0);
  });

  it('releases its exact owner after an ordinary provider failure', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(executeJob()).rejects.toMatchObject({
      name: 'SchedulerExecutionError',
      message: 'provider unavailable',
    });

    expect(findMockConversation('scheduled-conversation').modelProjectionOwner).toBeUndefined();
  });

  it('releases its claim when the atomic prelude cannot be checkpointed', async () => {
    mockFlushChatStorePersistenceNow
      .mockRejectedValueOnce(new Error('claim flush failed'))
      .mockResolvedValue(undefined);

    await expect(executeJob()).rejects.toMatchObject({
      name: 'SchedulerExecutionError',
      message: 'claim flush failed',
      conversationDurable: false,
    });

    const conversation = findMockConversation('scheduled-conversation');
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages).toMatchObject([
      { id: 'scheduled:occurrence-job-1:user', role: 'user' },
      { id: 'scheduled:occurrence-job-1:assistant', role: 'assistant' },
    ]);
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockChatState.updateModelInConversation).not.toHaveBeenCalled();
  });

  it('preserves completed output when the final owner-release flush fails', async () => {
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        emitSchedulerFinal(callbacks, 'Durable completed output.');
        callbacks.onDone?.();
      },
    );
    mockFlushChatStorePersistenceNow
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('release flush failed'));

    await expect(executeJob()).rejects.toMatchObject({
      name: 'SchedulerProjectionReleaseError',
      message: 'release flush failed',
      completionPreserved: true,
    });

    const conversation = findMockConversation('scheduled-conversation');
    expect(conversation.modelProjectionOwner).toBeUndefined();
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Durable completed output.',
      assistantMetadata: expect.objectContaining({ completionStatus: 'complete' }),
    });
    expect(mockCheckpointScheduledAttemptCompletion).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale lifecycle epoch before mutating the scheduled transcript', async () => {
    const staleEpoch = getScheduledExecutionLifecycleEpoch();
    expect(abortAllScheduledJobExecutions()).toBe(0);

    await expect(
      executeScheduledJob(scheduledJob(), { lifecycleEpoch: staleEpoch }),
    ).rejects.toMatchObject({ name: 'SchedulerAppBackgroundAbortError' });

    expect(mockChatState.ensureConversation).not.toHaveBeenCalled();
    expect(mockChatState.conversations).toEqual([]);
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('surfaces background cancellation for durable effect-journal classification', async () => {
    const effectfulTool: ToolCall = {
      id: 'effectful-tool',
      name: 'calendar_create_event',
      arguments: '{}',
      status: 'running',
    };
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: unknown, callbacks: OrchestratorCallbacks) => {
        callbacks.onToolCallStart?.(effectfulTool);
        expect(abortAllScheduledJobExecutions()).toBe(1);
        callbacks.onAgentControlGraphStateChange?.({
          status: 'cancelled',
          terminalReason: 'user_cancelled',
        });
        callbacks.onDone?.();
      },
    );

    await expect(executeJob()).rejects.toMatchObject({
      name: 'SchedulerAppBackgroundAbortError',
    });
    expect(abortAllScheduledJobExecutions()).toBe(0);
  });
});
