import { hasGeminiToolTurnThoughtSignatureCoverage } from '../../../../../src/services/llm/providers/gemini/thoughtSignatureCoverage';
import { streamGeminiNative } from '../../../../../src/services/llm/providers/gemini/stream';

function buildGeminiSseResponse(chunks: ReadonlyArray<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

async function collectStreamEvents(response: Response) {
  const events = [];
  for await (const event of streamGeminiNative({
    response,
    shouldSurfaceReasoning: false,
    safeJsonParse: (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    },
  })) {
    events.push(event);
  }
  return events;
}

describe('streamGeminiNative signature capture', () => {
  it('captures a terminal empty-text signature carrier after parallel function calls', async () => {
    const response = buildGeminiSseResponse([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'memory_recall',
                    args: { subject: 'e2e-state-a' },
                  },
                },
                {
                  functionCall: {
                    name: 'memory_recall',
                    args: { subject: 'e2e-state-b' },
                  },
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [{ text: '', thoughtSignature: 'sig-live-terminal' }],
            },
          },
        ],
      },
    ]);

    const events = await collectStreamEvents(response);
    const doneEvent = events.find((event) => event.type === 'done');
    const toolCalls = events
      .filter((event) => event.type === 'tool_call')
      .map((event) => event.toolCall);

    expect(toolCalls).toHaveLength(2);
    expect(doneEvent?.providerReplay?.geminiParts?.[0]?.thoughtSignature).toBe('sig-live-terminal');
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: toolCalls.map((toolCall) => ({ raw: toolCall.raw })),
        providerReplay: doneEvent?.providerReplay,
      }),
    ).toBe(true);
  });

  it('captures a thought signature that precedes the first function call in the stream', async () => {
    const response = buildGeminiSseResponse([
      {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'plan', thought: true, thoughtSignature: 'sig-thought-first' },
                {
                  functionCall: {
                    name: 'read_file',
                    args: { path: 'artifacts/chain-proof.txt' },
                  },
                },
              ],
            },
          },
        ],
      },
    ]);

    const events = await collectStreamEvents(response);
    const doneEvent = events.find((event) => event.type === 'done');
    const toolCall = events.find((event) => event.type === 'tool_call')?.toolCall;

    expect(toolCall?.name).toBe('read_file');
    expect(doneEvent?.providerReplay?.geminiParts?.[1]?.thoughtSignature).toBe('sig-thought-first');
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: toolCall?.raw }],
        providerReplay: doneEvent?.providerReplay,
      }),
    ).toBe(true);
  });
});