import { getThinkingParams } from '../../src/engine/thinking';
import {
  buildE2EProviderForKey,
  shouldRunE2EProviderDiagnostics,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { isVertexNativeGeminiBaseUrl } from '../../src/constants/api';
import { LlmService } from '../../src/services/llm/LlmService';
import { buildGeminiConversation } from '../../src/services/llm/providers/gemini/conversation';
import {
  buildGeminiGenerateContentUrl,
  buildGeminiRequestBody,
  resolveGeminiStructuredOutputSyntax,
} from '../../src/services/llm/providers/gemini/request';
import { supportsGeminiStructuredOutputWithTools, supportsTemperature } from '../../src/services/llm/catalog/providerCapabilities';
import { reorderToolsForPromptCaching } from '../../src/services/llm/core/toolCaching';

const describeDiag = shouldRunE2EProviderDiagnostics('gemini') ? describe : describe.skip;

async function collectToolTurn(
  service: LlmService,
  providerModel: string,
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
) {
  const maxTokens = 4096;
  const stream = service.streamMessage(messages as any, {
    model: providerModel,
    maxTokens,
    temperature: 1,
    tools: tools as any,
    ...getThinkingParams('minimal', providerModel, { maxTokens }),
  });

  const pending: Array<Record<string, unknown>> = [];
  let providerReplay: { geminiParts?: Record<string, unknown>[] } | undefined;
  for await (const event of stream) {
    if (event.type === 'tool_call' && event.toolCall) {
      pending.push(event.toolCall as Record<string, unknown>);
    }
    if (event.type === 'done') {
      providerReplay = event.providerReplay;
    }
  }
  return { pending, providerReplay };
}

describeDiag('Gemini replay diag', () => {
  jest.setTimeout(180_000);

  it('captures signatures for update_goals and replays a follow-up turn', async () => {
    const provider = buildE2EProviderForKey('gemini');
    const service = new LlmService(provider);
    const tools = [
      {
        name: 'update_goals',
        description: 'Update goals',
        input_schema: {
          type: 'object',
          properties: {
            goals: { type: 'array' },
          },
        },
      },
      {
        name: 'write_file',
        description: 'Write file',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      },
    ];

    const userPrompt =
      'Write artifacts/item-a.txt with ITEM-A-E2E and artifacts/item-b.txt with ITEM-B-E2E.';

    const turn1 = await collectToolTurn(
      service,
      provider.model,
      [{ role: 'user', content: userPrompt }],
      tools,
    );

    expect(turn1.pending.length).toBeGreaterThan(0);
    const turn1Sig =
      (turn1.pending[0]?.raw as any)?.thoughtSignature ||
      turn1.providerReplay?.geminiParts?.find((part) => part.functionCall)?.thoughtSignature;
    console.log('turn1 tools', turn1.pending.map((call) => call.name));
    console.log('turn1 sig', Boolean(turn1Sig));

    const assistant = {
      role: 'assistant',
      content: '',
      tool_calls: turn1.pending.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
        ...(toolCall.raw || {}),
      })),
      providerReplay: turn1.providerReplay,
    };

    const toolMessages = turn1.pending.map((toolCall) => ({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify({ ok: true }),
    }));

    const turn2 = await collectToolTurn(
      service,
      provider.model,
      [{ role: 'user', content: userPrompt }, assistant, ...toolMessages],
      tools,
    );

    const turn2Sig =
      (turn2.pending[0]?.raw as any)?.thoughtSignature ||
      turn2.providerReplay?.geminiParts?.find((part) => part.functionCall)?.thoughtSignature;
    console.log('turn2 tools', turn2.pending.map((call) => call.name));
    console.log('turn2 sig', Boolean(turn2Sig));

    const replayBody = buildGeminiRequestBody({
      baseUrl: provider.baseUrl,
      model: provider.model,
      messages: [{ role: 'user', content: userPrompt }, assistant as any, ...toolMessages as any],
      options: {
        model: provider.model,
        maxTokens: 4096,
        temperature: 1,
        tools: tools as any,
        ...getThinkingParams('minimal', provider.model, { maxTokens: 4096 }),
      },
      structuredOutputSyntax: resolveGeminiStructuredOutputSyntax(provider.baseUrl, {
        isVertexNativeGeminiBaseUrl,
      }),
      supportsGeminiStructuredOutputWithTools,
      supportsTemperature,
      isVertexNativeGeminiBaseUrl,
      reorderToolsForPromptCaching,
    });

    const nativeConversation = buildGeminiConversation(provider.model, [
      { role: 'user', content: userPrompt },
      assistant as any,
      ...toolMessages as any,
    ]);
    console.log(
      'native replay model parts',
      JSON.stringify(
        nativeConversation.contents
          .filter((entry) => entry.role === 'model')
          .flatMap((entry) => entry.parts),
        null,
        2,
      ),
    );

    const url = buildGeminiGenerateContentUrl(
      provider.baseUrl,
      provider.model,
      'streamGenerateContent?alt=sse',
      { isVertexNativeGeminiBaseUrl },
    );
    const rawTurn2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify(replayBody),
    });
    const rawText = await rawTurn2.text();
    const rawParts = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .flatMap((line) => {
        const parsed = JSON.parse(line.slice(6));
        return parsed?.candidates?.[0]?.content?.parts ?? [];
      });
    console.log(
      'raw turn2 parts',
      JSON.stringify(
        rawParts.map((part: Record<string, unknown>) => ({
          keys: Object.keys(part),
          thoughtSignature: part.thoughtSignature ?? part.thought_signature,
          functionCall: (part.functionCall as any)?.name,
          textLen: typeof part.text === 'string' ? part.text.length : null,
        })),
      ),
    );

    expect(turn1Sig).toBeTruthy();
    expect(rawTurn2.ok).toBe(true);
    if (turn2.pending.length > 0) {
      expect(turn2Sig).toBeTruthy();
    }
  });
});
