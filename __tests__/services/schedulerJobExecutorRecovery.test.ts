import type { CronJob } from '../../src/services/cron/types';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
import { resolveScheduledOccurrenceCompletedOutput } from '../../src/services/scheduler/jobExecutorSetup';

const occurrenceId = 'occurrence-1';
const userId = `scheduled:${occurrenceId}:user`;
const assistantId = `scheduled:${occurrenceId}:assistant`;

function job(): CronJob {
  return {
    id: 'job-1',
    definitionRevision: 1,
    name: 'Recovery test',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated',
    wakeMode: 'new',
    payload: { prompt: 'Run recovery test', mode: 'agentic' },
    runningAttemptId: 'attempt-1',
    runningOccurrenceId: occurrenceId,
  };
}

function message(value: Omit<Message, 'timestamp'>): Message {
  return { ...value, timestamp: 1 };
}

function projection(messages: Message[]) {
  const conversation = {
    id: 'conversation-1',
    title: 'Recovery',
    messages,
    providerId: 'openai',
    systemPrompt: 'Helpful',
    createdAt: 1,
    updatedAt: 1,
  } as Conversation;
  const chatState = { conversations: [conversation] } as never;
  const completedOutput = resolveScheduledOccurrenceCompletedOutput({
    job: job(),
    chatState,
    conversationId: conversation.id,
  });
  return {
    result: {
      assistantMessageId: assistantId,
      ...(completedOutput ? { completedOutput } : {}),
    },
  };
}

describe('scheduled occurrence transcript recovery', () => {
  it('rejects an empty terminal assistant as successful output', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: '',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('rejects content-only intermediate text as successful output', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'I am still planning.',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('does not mistake a complete planning turn for terminal completion', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'I will call the calendar tool.',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
        toolCalls: [
          { id: 'tool-1', name: 'calendar_create_event', arguments: '{}', status: 'pending' },
        ],
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('recovers a generated final answer after tool execution within the occurrence boundary', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'Planning',
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      }),
      message({ id: 'tool-result', role: 'tool', content: 'Created', toolCallId: 'tool-1' }),
      message({
        id: 'generated-final',
        role: 'assistant',
        content: 'The event was created.',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
    ]);

    expect(result).toEqual({
      assistantMessageId: assistantId,
      completedOutput: 'The event was created.',
    });
  });

  it('never consumes a later user turn as completion evidence', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({ id: assistantId, role: 'assistant', content: '' }),
      message({ id: 'later-user', role: 'user', content: 'Different request' }),
      message({
        id: 'later-final',
        role: 'assistant',
        content: 'Different answer',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('does not resurrect an earlier final after a later terminal failure', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'Initial answer',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
      message({
        id: 'terminal-failure',
        role: 'assistant',
        content: 'Required evidence was missing.',
        isError: true,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'response_failed',
        },
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('does not resurrect an earlier final before a later empty assistant turn', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'Earlier answer',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
      message({ id: 'later-empty', role: 'assistant', content: '' }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('does not resurrect an earlier final before a later tool-planning turn', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'Earlier answer',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
      message({
        id: 'later-plan',
        role: 'assistant',
        content: 'I will perform another action.',
        toolCalls: [{ id: 'tool-2', name: 'write_file', arguments: '{}', status: 'pending' }],
        assistantMetadata: {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });

  it('does not resurrect an earlier final before a later tool result', () => {
    const { result } = projection([
      message({ id: userId, role: 'user', content: 'Run recovery test' }),
      message({
        id: assistantId,
        role: 'assistant',
        content: 'Earlier answer',
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }),
      message({ id: 'later-tool', role: 'tool', content: 'Late evidence', toolCallId: 'tool-3' }),
    ]);

    expect(result).toEqual({ assistantMessageId: assistantId });
  });
});
