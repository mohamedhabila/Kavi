import { getThinkingParams } from '../../src/engine/thinking';
import {
  buildE2EProviderForKey,
  shouldRunE2EProviderDiagnostics,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { LlmService } from '../../src/services/llm/LlmService';

const describeDiag = shouldRunE2EProviderDiagnostics('gemini') ? describe : describe.skip;

describeDiag('Gemini LlmService stream diag', () => {
  jest.setTimeout(120_000);

  it('captures thought signatures from LlmService native stream', async () => {
    const provider = buildE2EProviderForKey('gemini');
    const service = new LlmService(provider);
    const maxTokens = 4096;
    const tools = [
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

    const stream = service.streamMessage(
      [
        {
          role: 'user',
          content: 'Write artifacts/item-a.txt with ITEM-A-E2E using write_file.',
        },
      ],
      {
        model: provider.model,
        maxTokens,
        temperature: 1,
        tools,
        ...getThinkingParams('minimal', provider.model, { maxTokens }),
      },
    );

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
    console.log('pending', JSON.stringify(pending, null, 2));
    console.log('replay', JSON.stringify(providerReplay, null, 2));

    const rawSig = (pending[0]?.raw as Record<string, unknown> | undefined)?.thoughtSignature;
    const replaySig = providerReplay?.geminiParts?.find((part) => part.functionCall)?.thoughtSignature;
    expect(rawSig || replaySig).toBeTruthy();
  });
});
