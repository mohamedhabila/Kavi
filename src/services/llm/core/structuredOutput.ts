import { normalizeToolInputSchema } from '../../../utils/toolSchema';
import type { StructuredOutputOptions } from '../support/contracts';
import { isPlainRecord } from './json';

export function normalizeStructuredOutputOptions(
  value: unknown,
): StructuredOutputOptions | undefined {
  if (!isPlainRecord(value) || !isPlainRecord(value.schema)) {
    return undefined;
  }

  const mimeType =
    typeof value.mimeType === 'string' && value.mimeType.trim().length > 0
      ? value.mimeType.trim()
      : 'application/json';
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : undefined;

  return {
    schema: normalizeToolInputSchema(value.schema),
    mimeType,
    ...(name ? { name } : {}),
    ...(typeof value.strict === 'boolean' ? { strict: value.strict } : {}),
  };
}
