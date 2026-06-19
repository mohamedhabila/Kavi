import {
  LlmService,
  makeOnDeviceConfig,
  mockFetch,
  mockStreamLocalLlmMessage,
} from '../../helpers/llmServiceHarness';

describe('LlmService local streamMessage', () => {
  it('forwards tools, request options, tokens, and native tool calls', async () => {
    const localTool = {
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };
    mockStreamLocalLlmMessage.mockImplementationOnce(async function* () {
      yield { type: 'token', content: 'Local' };
      yield {
        type: 'tool_call',
        toolCall: {
          id: 'local-tool-call-1',
          name: 'read_file',
          arguments: '{"path":"/tmp/a.txt"}',
        },
      };
      yield { type: 'token', content: ' reply' };
      yield { type: 'done' };
    });

    const service = new LlmService(makeOnDeviceConfig());
    const events: any[] = [];

    for await (const event of service.streamMessage(
      [{ role: 'user', content: 'Stream locally' }],
      {
        conversationId: 'conv-local-stream',
        maxTokens: 384,
        temperature: 0.3,
        tools: [localTool],
      },
    )) {
      events.push(event);
    }

    expect(mockStreamLocalLlmMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'on-device' }),
      [{ role: 'user', content: 'Stream locally' }],
      [localTool],
      {
        conversationId: 'conv-local-stream',
        maxTokens: 384,
        temperature: 0.3,
      },
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'token')).toEqual([
      { type: 'token', content: 'Local' },
      { type: 'token', content: ' reply' },
    ]);
    expect(events.find((event) => event.type === 'tool_call')).toEqual({
      type: 'tool_call',
      toolCall: {
        id: 'local-tool-call-1',
        name: 'read_file',
        arguments: '{"path":"/tmp/a.txt"}',
      },
    });
    expect(events.find((event) => event.type === 'done')).toEqual({
      type: 'done',
      completion: {
        completionStatus: 'complete',
      },
    });
  });
});
