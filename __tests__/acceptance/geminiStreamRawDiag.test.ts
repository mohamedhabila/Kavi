import { getThinkingParams } from '../../src/engine/thinking';
import {
  buildE2EProviderForKey,
  shouldRunE2EProviderDiagnostics,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { buildGeminiGenerateContentUrl } from '../../src/services/llm/providers/gemini/request';
import { isVertexNativeGeminiBaseUrl } from '../../src/constants/api';

const describeDiag = shouldRunE2EProviderDiagnostics('gemini') ? describe : describe.skip;

describeDiag('Gemini stream raw diag', () => {
  jest.setTimeout(120_000);

  it('logs raw SSE parts for a tool turn', async () => {
    const provider = buildE2EProviderForKey('gemini');
    const maxTokens = 4096;
    const url = buildGeminiGenerateContentUrl(
      provider.baseUrl,
      provider.model,
      'streamGenerateContent?alt=sse',
      { isVertexNativeGeminiBaseUrl },
    );

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Write artifacts/item-a.txt with ITEM-A-E2E using write_file.',
            },
          ],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'write_file',
              description: 'Write a workspace file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['path', 'content'],
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 1,
        thinkingConfig: getThinkingParams('minimal', provider.model, { maxTokens }).thinking,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify(body),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    const chunks = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6));

    const parsedChunks = chunks
      .filter((chunk) => chunk && chunk !== '[DONE]')
      .map((chunk) => JSON.parse(chunk));

    for (const [index, chunk] of parsedChunks.entries()) {
      const parts = chunk?.candidates?.[0]?.content?.parts ?? [];
      console.log(
        `chunk ${index}`,
        JSON.stringify(
          parts.map((part: Record<string, unknown>) => ({
            keys: Object.keys(part),
            thought: part.thought,
            thoughtSignature: part.thoughtSignature ?? part.thought_signature,
            textLen: typeof part.text === 'string' ? part.text.length : null,
            functionCall: part.functionCall ? (part.functionCall as any).name : null,
          })),
        ),
      );
    }

    const allParts = parsedChunks.flatMap((chunk) => chunk?.candidates?.[0]?.content?.parts ?? []);
    const hasFcSignature = allParts.some(
      (part: Record<string, unknown>) =>
        Boolean(part.functionCall) &&
        Boolean(part.thoughtSignature ?? part.thought_signature),
    );
    const hasEmptyTextSignature = allParts.some(
      (part: Record<string, unknown>) =>
        (typeof part.text !== 'string' || part.text.length === 0) &&
        Boolean(part.thoughtSignature ?? part.thought_signature),
    );

    console.log({ hasFcSignature, hasEmptyTextSignature, partCount: allParts.length });
    expect(allParts.some((part: Record<string, unknown>) => part.functionCall)).toBe(true);
    expect(hasFcSignature || hasEmptyTextSignature).toBe(true);
  });
});
