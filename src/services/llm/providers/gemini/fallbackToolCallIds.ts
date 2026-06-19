import { stableJsonishKey } from '../../core/toolCallNormalization';

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createGeminiFallbackToolCallId(params: {
  ordinal: number;
  name: string;
  args: unknown;
}): string {
  const normalizedOrdinal =
    Number.isInteger(params.ordinal) && params.ordinal >= 0 ? params.ordinal : 0;
  const key = `${params.name.trim()}::${stableJsonishKey(params.args)}`;
  return `gemini-call-${normalizedOrdinal}-${fnv1a32(key)}`;
}
