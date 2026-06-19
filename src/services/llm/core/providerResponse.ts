import { isPlainRecord } from './json';

export function attachProviderResponse(
  result: any,
  provider: 'anthropic' | 'gemini' | 'openai-responses',
  response: any,
): any {
  if (!isPlainRecord(result)) {
    return result;
  }

  return {
    ...result,
    providerResponse: {
      provider,
      response,
    },
  };
}
