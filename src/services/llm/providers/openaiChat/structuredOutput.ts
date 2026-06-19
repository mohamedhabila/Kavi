import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import type { StructuredOutputOptions } from '../../support/contracts';
import {
  isStrictCompatibleSchema,
  strictifyOpenAiSchema,
} from '../../core/schemaTransforms';

export function buildCompatibleStructuredOutputFormat(
  structuredOutput: StructuredOutputOptions,
): Record<string, any> {
  const normalizedSchema = normalizeToolInputSchema(structuredOutput.schema);
  const useStrict =
    structuredOutput.strict !== false &&
    isStrictCompatibleSchema(normalizedSchema);

  return {
    type: 'json_schema',
    json_schema: {
      name: structuredOutput.name || 'structured_output',
      schema: useStrict
        ? strictifyOpenAiSchema(normalizedSchema)
        : normalizedSchema,
      strict: useStrict,
    },
  };
}
