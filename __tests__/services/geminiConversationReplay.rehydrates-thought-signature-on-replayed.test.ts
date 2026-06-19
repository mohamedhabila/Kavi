import { buildGeminiConversation } from '../../src/services/llm/providers/gemini/conversation';
import { GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE } from '../../src/services/llm/providers/gemini/toolTurnRepair';

describe('buildGeminiConversation Gemini 3 replay', () => {
  it('rehydrates thought_signature on replayed function calls from tool call raw', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Write a file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"artifacts/e2e.txt","content":"E2E"}',
            },
            raw: {
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{"path":"artifacts/e2e.txt","content":"E2E"}',
              },
              thoughtSignature: 'sig-replay-1',
            },
          },
        ],
        providerReplay: {
          geminiParts: [
            {
              functionCall: {
                name: 'write_file',
                args: { path: 'artifacts/e2e.txt', content: 'E2E' },
              },
            },
          ],
        },
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'write_file',
        content: '{"ok":true}',
      },
    ]);

    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);
    const functionCallPart = modelParts.find((part) => part.functionCall?.name === 'write_file');
    expect(functionCallPart?.functionCall?.id).toBe('tc-1');
    expect(functionCallPart?.thoughtSignature).toBe('sig-replay-1');

    const responseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'write_file');
    expect(responseParts[0]?.functionResponse).toMatchObject({
      id: 'tc-1',
      name: 'write_file',
      response: { ok: true },
    });
  });
  it('rehydrates thought_signature from tool call raw when provider replay parts omit it', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Write a file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"artifacts/e2e.txt","content":"E2E"}',
            },
            thoughtSignature: 'sig-raw-only',
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'write_file',
        content: '{"ok":true}',
      },
    ]);

    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);
    const functionCallPart = modelParts.find((part) => part.functionCall?.name === 'write_file');
    expect(functionCallPart?.thoughtSignature).toBe('sig-raw-only');
  });
  it('uses the official imported-call signature for Gemini 3 replay when provider metadata lacks one', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Write a file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"artifacts/e2e.txt","content":"E2E"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'write_file',
        content: '{"ok":true}',
      },
    ]);

    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);
    const responseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'write_file');
    expect(modelParts[0]?.thoughtSignature).toBe(GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE);
    expect(responseParts).toHaveLength(1);
  });
  it('does not add the Gemini 3 imported-call signature to Gemini 2.x replay', () => {
    const conversation = buildGeminiConversation('gemini-2.5-flash', [
      { role: 'user', content: 'Write a file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"artifacts/e2e.txt","content":"E2E"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'write_file',
        content: '{"ok":true}',
      },
    ]);

    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);
    const responseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'write_file');
    expect(modelParts[0]?.functionCall?.name).toBe('write_file');
    expect(modelParts[0]?.thoughtSignature).toBeUndefined();
    expect(responseParts).toHaveLength(1);
  });
  it('uses the imported-call signature only on the first Gemini 3 parallel function call', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Recall two facts.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-a',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"alpha"}',
            },
          },
          {
            id: 'tc-b',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"beta"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-a',
        name: 'memory_recall',
        content: '{"value":"A"}',
      },
      {
        role: 'tool',
        tool_call_id: 'tc-b',
        name: 'memory_recall',
        content: '{"value":"B"}',
      },
    ]);

    const callParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall?.name === 'memory_recall');
    const responseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'memory_recall');

    expect(callParts.map((part) => part.functionCall.id)).toEqual(['tc-a', 'tc-b']);
    expect(callParts[0]?.thoughtSignature).toBe(GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE);
    expect(callParts[1]?.thoughtSignature).toBeUndefined();
    expect(responseParts.map((part) => part.functionResponse.id)).toEqual(['tc-a', 'tc-b']);
  });
  it('preserves thought replay parts and borrows thought signatures for function calls', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Read file' },
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          geminiParts: [
            { text: 'Planning tool use', thought: true, thoughtSignature: 'sig-thought-1' },
            {
              functionCall: { name: 'read_file', args: { path: 'artifacts/e2e.txt' } },
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"artifacts/e2e.txt"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'read_file',
        content: '{"ok":true}',
      },
    ]);

    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);

    expect(modelParts[0]).toEqual(
      expect.objectContaining({
        text: 'Planning tool use',
        thought: true,
        thoughtSignature: 'sig-thought-1',
      }),
    );
    expect(modelParts[1]?.thoughtSignature).toBe('sig-thought-1');
  });
  it('dedupes duplicate unsigned function calls and keeps the signed replay copy', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Write file' },
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          geminiParts: [
            {
              functionCall: {
                name: 'write_file',
                args: { path: 'artifacts/item-a.txt', content: 'ITEM-A-E2E' },
              },
              thoughtSignature: 'sig-primary',
            },
            {
              functionCall: {
                name: 'write_file',
                args: { path: 'artifacts/item-a.txt', content: 'ITEM-A-E2E' },
              },
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"artifacts/item-a.txt","content":"ITEM-A-E2E"}',
            },
            raw: {
              thoughtSignature: 'sig-primary',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        name: 'write_file',
        content: '{"ok":true}',
      },
    ]);

    const functionCallParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall?.name === 'write_file');

    expect(functionCallParts).toHaveLength(1);
    expect(functionCallParts[0]?.thoughtSignature).toBe('sig-primary');
  });
  it('preserves distinct Gemini ids for parallel calls with identical names and args', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Recall the same subject twice for comparison.' },
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          geminiParts: [
            {
              functionCall: {
                id: 'tc-a',
                name: 'memory_recall',
                args: { subject: 'shared' },
              },
              thoughtSignature: 'sig-parallel',
            },
            {
              functionCall: {
                id: 'tc-b',
                name: 'memory_recall',
                args: { subject: 'shared' },
              },
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc-a',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"shared"}',
            },
          },
          {
            id: 'tc-b',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"shared"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-a',
        name: 'memory_recall',
        content: '{"value":"A"}',
      },
      {
        role: 'tool',
        tool_call_id: 'tc-b',
        name: 'memory_recall',
        content: '{"value":"B"}',
      },
    ]);

    const modelFunctionCallParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall?.name === 'memory_recall');
    const userFunctionResponseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'memory_recall');

    expect(modelFunctionCallParts.map((part) => part.functionCall.id)).toEqual(['tc-a', 'tc-b']);
    expect(userFunctionResponseParts.map((part) => part.functionResponse.id)).toEqual([
      'tc-a',
      'tc-b',
    ]);
    expect(modelFunctionCallParts).toHaveLength(userFunctionResponseParts.length);
  });
});
