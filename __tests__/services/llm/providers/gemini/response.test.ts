import { normalizeGeminiResponse } from '../../../../../src/services/llm/providers/gemini/response';

describe('normalizeGeminiResponse', () => {
  it('generates deterministic shape-sensitive fallback tool call ids', () => {
    const first = normalizeGeminiResponse({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'memory_recall', args: { subject: 'a' } } }],
          },
          finishReason: 'STOP',
        },
      ],
    });
    const repeatedFirst = normalizeGeminiResponse({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'memory_recall', args: { subject: 'a' } } }],
          },
          finishReason: 'STOP',
        },
      ],
    });
    const second = normalizeGeminiResponse({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'write_file', args: { path: 'a.txt' } } }],
          },
          finishReason: 'STOP',
        },
      ],
    });

    const firstCall = first.choices[0].message.tool_calls[0];
    const repeatedFirstCall = repeatedFirst.choices[0].message.tool_calls[0];
    const secondCall = second.choices[0].message.tool_calls[0];

    expect(firstCall.id).toMatch(/^gemini-call-\d+-[0-9a-f]{8}$/);
    expect(repeatedFirstCall.id).toBe(firstCall.id);
    expect(secondCall.id).toMatch(/^gemini-call-\d+-[0-9a-f]{8}$/);
    expect(secondCall.id).not.toBe(firstCall.id);
    expect(firstCall.function.name).toBe('memory_recall');
    expect(secondCall.function.name).toBe('write_file');
  });

  it('drops undeclared Gemini function calls before replay or execution', () => {
    const result = normalizeGeminiResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'gemini-call-0-3486f50d', args: {} } },
                { functionCall: { name: 'memory_recall', args: { subject: 'locomo-user' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
      { declaredToolNames: new Set(['memory_recall']) },
    );

    const toolCalls = result.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('memory_recall');
    expect(result.choices[0].message.providerReplay.geminiParts).toHaveLength(1);
    expect(result.choices[0].message.providerReplay.geminiParts[0].functionCall.name).toBe(
      'memory_recall',
    );
  });
});
