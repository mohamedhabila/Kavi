import {
  buildToolResultMessage,
  completeRunningToolCall,
  createFailedToolCall,
  createRunningToolCall,
  failRunningToolCall,
} from '../../src/engine/toolExecution/toolExecutionMessages';

describe('toolExecutionMessages', () => {
  it('creates running tool calls with raw provider payloads preserved only for active calls', () => {
    const toolCall = createRunningToolCall(
      {
        id: 'tc-1',
        name: 'read_file',
        arguments: '{"path":"a.txt"}',
        raw: { provider: 'test' },
      },
      100,
    );

    expect(toolCall).toMatchObject({
      id: 'tc-1',
      name: 'read_file',
      arguments: '{"path":"a.txt"}',
      raw: { provider: 'test' },
      status: 'running',
      startedAt: 100,
      updatedAt: 100,
    });

    const failed = createFailedToolCall(toolCall, 'Blocked', 200);
    expect(failed).toMatchObject({
      id: 'tc-1',
      name: 'read_file',
      status: 'failed',
      error: 'Blocked',
      completedAt: 200,
    });
    expect(failed.raw).toBeUndefined();
  });

  it('updates running tool calls for success and failure results', () => {
    const toolCall = createRunningToolCall(
      { id: 'tc-2', name: 'write_file', arguments: '{}' },
      100,
    );

    completeRunningToolCall(toolCall, 'ok', false, 150);
    expect(toolCall).toMatchObject({
      status: 'completed',
      result: 'ok',
      completedAt: 150,
    });

    const failedToolCall = createRunningToolCall(
      { id: 'tc-3', name: 'write_file', arguments: '{}' },
      200,
    );
    failRunningToolCall(failedToolCall, 'Request cancelled', 250);
    expect(failedToolCall).toMatchObject({
      status: 'failed',
      error: 'Request cancelled',
      completedAt: 250,
    });
  });

  it('builds immutable tool result messages from completed tool calls', () => {
    const toolCall = createFailedToolCall(
      { id: 'tc-4', name: 'read_file', arguments: '{}' },
      'Not allowed',
      300,
    );
    const message = buildToolResultMessage({
      idPrefix: 'tool_filtered',
      toolCallId: 'tc-4',
      content: 'Not allowed',
      toolCall,
      isError: true,
      timestamp: 350,
    });

    expect(message).toMatchObject({
      id: 'msg_350_tool_filtered_tc-4',
      role: 'tool',
      content: 'Not allowed',
      toolCallId: 'tc-4',
      timestamp: 350,
      isError: true,
    });
    expect(message.toolCalls?.[0]).toEqual(toolCall);
    expect(message.toolCalls?.[0]).not.toBe(toolCall);
  });
});
