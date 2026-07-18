import { normalizeStructuredOutputOptions } from '../services/llm/core/structuredOutput';
import type { StructuredOutputOptions } from '../services/llm/support/contracts';

/**
 * A model may hand an action to an external controller only on a turn where
 * Kavi's own product tools are disabled. The controller executes after the
 * model turn, so mixing both authority channels would make effect ownership
 * and completion evidence ambiguous.
 */
export function resolveExternalActionContract(
  value: unknown,
  productToolsDisabled: boolean,
): StructuredOutputOptions | undefined {
  if (value === undefined) return undefined;

  const normalized = normalizeStructuredOutputOptions(value);
  if (!normalized) {
    throw new Error('externalActionContract must contain a valid JSON schema.');
  }
  if (!productToolsDisabled) {
    throw new Error('externalActionContract requires product tools to be disabled.');
  }

  return normalized;
}
