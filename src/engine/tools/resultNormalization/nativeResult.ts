import { normalizeResult } from './resultNormalizer';

export function normalizeNativeToolResult(_name: string, rawResult: string): string {
  return normalizeResult(rawResult, {
    jsonParse: true,
    fallback: rawResult,
  });
}
