import { buildGeminiConversation } from '../../src/services/llm/providers/gemini/conversation';
import { GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE } from '../../src/services/llm/providers/gemini/toolTurnRepair';

describe('buildGeminiConversation Gemini 3 replay', () => {
  it('omits function ids for Vertex Gemini requests without collapsing parallel calls', () => {
    const conversation = buildGeminiConversation(
      'gemini-3.5-flash',
      [
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
      ],
      { includeFunctionCallIds: false },
    );

    const modelFunctionCallParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall?.name === 'memory_recall');
    const userFunctionResponseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse?.name === 'memory_recall');

    expect(modelFunctionCallParts).toHaveLength(2);
    expect(userFunctionResponseParts).toHaveLength(2);
    expect(modelFunctionCallParts.map((part) => part.functionCall.id)).toEqual([
      undefined,
      undefined,
    ]);
    expect(userFunctionResponseParts.map((part) => part.functionResponse.id)).toEqual([
      undefined,
      undefined,
    ]);
  });
  it('drops incomplete parallel function-call steps instead of replaying partial tool history', () => {
    const conversation = buildGeminiConversation(
      'gemini-3.5-flash',
      [
        { role: 'user', content: 'Describe memory_remember.' },
        {
          role: 'assistant',
          content: 'I will update the goal and inspect the tool.',
          providerReplay: {
            geminiParts: [
              {
                functionCall: {
                  id: 'tc-goal',
                  name: 'update_goals',
                  args: { goals: [] },
                },
                thoughtSignature: 'sig-turn',
              },
              {
                functionCall: {
                  id: 'tc-describe',
                  name: 'tool_describe',
                  args: { name: 'memory_remember' },
                },
              },
            ],
          },
          tool_calls: [
            {
              id: 'tc-goal',
              type: 'function',
              function: {
                name: 'update_goals',
                arguments: '{"goals":[]}',
              },
            },
            {
              id: 'tc-describe',
              type: 'function',
              function: {
                name: 'tool_describe',
                arguments: '{"name":"memory_remember"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tc-describe',
          name: 'tool_describe',
          content: '{"description":"Remember a memory fact."}',
        },
      ],
      { includeFunctionCallIds: false },
    );

    const modelFunctionCallParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall);
    const userFunctionResponseParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse);
    const modelTextParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.text);

    expect(modelFunctionCallParts).toHaveLength(0);
    expect(userFunctionResponseParts).toHaveLength(0);
    expect(modelTextParts.map((part) => part.text)).toEqual([
      'I will update the goal and inspect the tool.',
    ]);
  });
  it('drops orphan function responses without a preceding model function call', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Hello' },
      {
        role: 'tool',
        tool_call_id: 'tc-orphan',
        name: 'memory_recall',
        content: '{"value":"orphan"}',
      },
      { role: 'user', content: 'Continue' },
    ]);

    const functionResponseParts = conversation.contents
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse);
    const userTextParts = conversation.contents
      .filter((entry) => entry.role === 'user')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.text)
      .map((part) => part.text);

    expect(functionResponseParts).toHaveLength(0);
    expect(userTextParts).toEqual(['Hello', 'Continue']);
  });
  it('drops unresolved model function calls before the next standard user turn', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Read memory' },
      {
        role: 'assistant',
        content: 'I will inspect memory.',
        tool_calls: [
          {
            id: 'tc-recall',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"state"}',
            },
            raw: { thoughtSignature: 'sig-recall' },
          },
        ],
      },
      { role: 'user', content: 'Never mind, answer normally.' },
    ]);

    const functionCallParts = conversation.contents
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall);
    const textParts = conversation.contents
      .flatMap((entry) => entry.parts)
      .filter((part) => part.text)
      .map((part) => part.text);

    expect(functionCallParts).toHaveLength(0);
    expect(textParts).toEqual([
      'Read memory',
      'I will inspect memory.',
      'Never mind, answer normally.',
    ]);
  });
  it('drops hidden thought carriers when dropping invalid function-call history', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Read memory' },
      {
        role: 'assistant',
        content: 'I will inspect memory.',
        providerReplay: {
          geminiParts: [
            { text: 'Planning', thought: true, thoughtSignature: 'sig-planning' },
            {
              functionCall: {
                id: 'tc-recall',
                name: 'memory_recall',
                args: { subject: 'state' },
              },
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc-recall',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"state"}',
            },
          },
        ],
      },
      { role: 'user', content: 'Never mind, answer normally.' },
    ]);

    const parts = conversation.contents.flatMap((entry) => entry.parts);
    expect(parts.some((part) => part.functionCall)).toBe(false);
    expect(parts.some((part) => part.thought || part.thoughtSignature)).toBe(false);
    expect(parts.filter((part) => part.text).map((part) => part.text)).toEqual([
      'Read memory',
      'I will inspect memory.',
      'Never mind, answer normally.',
    ]);
  });
  it('preserves complete Gemini 3 function-call steps with the official imported-call signature', () => {
    const conversation = buildGeminiConversation('gemini-3.5-flash', [
      { role: 'user', content: 'Read memory' },
      {
        role: 'assistant',
        content: 'I will inspect memory.',
        tool_calls: [
          {
            id: 'tc-recall',
            type: 'function',
            function: {
              name: 'memory_recall',
              arguments: '{"subject":"state"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tc-recall',
        name: 'memory_recall',
        content: '{"value":"STATE"}',
      },
    ]);

    const functionCallParts = conversation.contents
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall);
    const functionResponseParts = conversation.contents
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionResponse);
    const modelTextParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.text)
      .map((part) => part.text);

    expect(functionCallParts).toHaveLength(1);
    expect(functionCallParts[0]).toEqual(
      expect.objectContaining({
        functionCall: expect.objectContaining({
          id: 'tc-recall',
          name: 'memory_recall',
          args: { subject: 'state' },
        }),
        thoughtSignature: GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE,
      }),
    );
    expect(functionResponseParts).toHaveLength(1);
    expect(functionResponseParts[0]?.functionResponse).toEqual({
      id: 'tc-recall',
      name: 'memory_recall',
      response: { value: 'STATE' },
    });
    expect(modelTextParts).toEqual(['I will inspect memory.']);
  });
});
