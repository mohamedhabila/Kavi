import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import {
  appendSchemaConstraintDescription,
  dedupeSchemaVariants,
  normalizeGeminiNullableType,
} from '../../core/schemaTransforms';

/**
 * Preserve detailed Gemini tool descriptions.
 * Gemini function calling performs better when descriptions include purpose,
 * invocation conditions, and parameter semantics.
 */
export function simplifyGeminiToolDescription(
  description: string | undefined,
): string {
  const trimmed = (description || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 1997).trimEnd()}...`;
}

export function cleanGeminiSchema(
  schema: Record<string, any>,
  options: { target?: 'function_declaration' | 'structured_output' } = {},
): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };
  const target = options.target ?? 'function_declaration';
  const preserveJsonSchemaConstraints = target === 'structured_output';

  delete result.default;
  delete result.examples;
  delete result.$schema;
  delete result.$id;
  delete result.$ref;
  if (!preserveJsonSchemaConstraints) {
    delete result.additionalProperties;
  }

  normalizeGeminiNullableType(result);

  if (Array.isArray(result.enum)) {
    const normalizedType =
      typeof result.type === 'string' ? result.type.toLowerCase() : '';
    const allStringEnumValues = result.enum.every(
      (value: unknown) => typeof value === 'string',
    );

    if (
      !preserveJsonSchemaConstraints &&
      (normalizedType !== 'string' || !allStringEnumValues)
    ) {
      const allowedValues = result.enum
        .map((value: unknown) => {
          if (typeof value === 'string') {
            return value;
          }
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .filter(
          (value: unknown): value is string =>
            typeof value === 'string' && value.length > 0,
        );

      if (allowedValues.length > 0) {
        appendSchemaConstraintDescription(
          result,
          `Allowed values: ${allowedValues.join(', ')}.`,
        );
      }

      delete result.enum;
    }
  }

  if ('properties' in result) {
    const rawProperties = result.properties;
    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      result.properties = {};
    } else {
      result.properties = Object.fromEntries(
        Object.entries(rawProperties as Record<string, any>).map(([key, value]) => [
          key,
          cleanGeminiSchema(value as Record<string, any>, options),
        ]),
      );
    }
  }

  if (Array.isArray(result.required)) {
    const propertyKeys =
      result.properties &&
      typeof result.properties === 'object' &&
      !Array.isArray(result.properties)
        ? new Set(Object.keys(result.properties as Record<string, any>))
        : null;
    const filteredRequired = result.required.filter(
      (key: unknown): key is string =>
        typeof key === 'string' && (!propertyKeys || propertyKeys.has(key)),
    );

    if (filteredRequired.length > 0) {
      result.required = filteredRequired;
    } else {
      delete result.required;
    }
  }

  if (result.items && typeof result.items === 'object') {
    result.items = cleanGeminiSchema(result.items as Record<string, any>, options);
  }

  if (Array.isArray(result.anyOf)) {
    result.anyOf = dedupeSchemaVariants(
      result.anyOf.map((entry: Record<string, any>) =>
        cleanGeminiSchema(entry, options),
      ),
    );
  }

  if (Array.isArray(result.oneOf)) {
    const oneOfVariants = result.oneOf.map((entry: Record<string, any>) =>
      cleanGeminiSchema(entry, options),
    );
    result.anyOf = dedupeSchemaVariants([
      ...(Array.isArray(result.anyOf) ? result.anyOf : []),
      ...oneOfVariants,
    ]);
    delete result.oneOf;
  }

  if (Array.isArray(result.allOf)) {
    appendSchemaConstraintDescription(
      result,
      'All composed constraints from the original schema still apply.',
    );
    delete result.allOf;
  }

  return result;
}

export function buildGeminiFunctionDeclarationSchema(
  inputSchema: Record<string, any>,
): Record<string, any> {
  return cleanGeminiSchema(normalizeToolInputSchema(inputSchema), {
    target: 'function_declaration',
  });
}
