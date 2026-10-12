export function strictifyOpenAiSchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  if (result.type === 'object') {
    const originalRequired = new Set(Array.isArray(result.required) ? result.required : []);
    const propertyEntries = Object.entries((result.properties || {}) as Record<string, any>);
    const nextProperties: Record<string, any> = {};

    for (const [key, value] of propertyEntries) {
      const child = strictifyOpenAiSchema(value as Record<string, any>);
      nextProperties[key] = originalRequired.has(key) ? child : makeSchemaNullable(child);
    }

    result.properties = nextProperties;
    result.required = propertyEntries.map(([key]) => key);
    result.additionalProperties = false;
  }

  if (result.items && typeof result.items === 'object') {
    result.items = strictifyOpenAiSchema(result.items);
  }

  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  if (Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  if (Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  return result;
}

function isSchemaRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaAdmitsNull(schema: unknown): boolean {
  if (!isSchemaRecord(schema)) return true;
  const types = normalizeSchemaTypeList(schema.type);
  const variants = [schema.anyOf, schema.oneOf].filter(Array.isArray).flat();
  if (types.length === 0 && !Array.isArray(schema.enum) && variants.length === 0) return true;
  return (
    types.includes('null') ||
    schema.nullable === true ||
    (Array.isArray(schema.enum) && schema.enum.includes(null)) ||
    variants.some(schemaAdmitsNull)
  );
}

/** The schema an object value is read against: its own, or its object-shaped variant. */
function objectPropertiesOf(schema: Record<string, any>): Record<string, any> | undefined {
  if (isSchemaRecord(schema.properties)) return schema.properties;
  const variant = [schema.anyOf, schema.oneOf]
    .filter(Array.isArray)
    .flat()
    .find((entry) => isSchemaRecord(entry) && isSchemaRecord(entry.properties));
  return variant?.properties;
}

/** Deletes, in place, every null the schema at its position does not admit; true if any. */
function deleteNullsTheSchemaRejects(value: unknown, schema: unknown): boolean {
  if (!isSchemaRecord(schema)) return false;
  let deleted = false;
  if (Array.isArray(value)) {
    for (const entry of value) {
      deleted = deleteNullsTheSchemaRejects(entry, schema.items) || deleted;
    }
    return deleted;
  }
  const properties = objectPropertiesOf(schema);
  if (!isSchemaRecord(value) || !properties) return false;
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (entry === null && propertySchema !== undefined && !schemaAdmitsNull(propertySchema)) {
      delete value[key];
      deleted = true;
    } else {
      deleted = deleteNullsTheSchemaRejects(entry, propertySchema) || deleted;
    }
  }
  return deleted;
}

/**
 * The inverse of `strictifyOpenAiSchema` for the arguments a model returns. The strict form
 * declares every optional property required and nullable, so a null where the tool's own
 * schema admits none means the property was not given. Returns the text unchanged when it is
 * not a JSON object or holds no such null.
 */
export function omitNullsTheSchemaRejects(
  argumentsText: string,
  schema: Record<string, any> | undefined,
): string {
  if (!schema || !argumentsText) return argumentsText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
  return deleteNullsTheSchemaRejects(parsed, schema) ? JSON.stringify(parsed) : argumentsText;
}

function makeSchemaNullable(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const result = { ...schema };
  if (Array.isArray(result.type)) {
    if (!result.type.includes('null')) {
      result.type = [...result.type, 'null'];
    }
  } else if (typeof result.type === 'string' && result.type.length > 0 && result.type !== 'null') {
    result.type = [result.type, 'null'];
  }

  if (Array.isArray(result.enum) && !result.enum.includes(null)) {
    result.enum = [...result.enum, null];
  }

  return result;
}

export function normalizeSchemaTypeList(typeValue: unknown): string[] {
  if (Array.isArray(typeValue)) {
    return Array.from(
      new Set(
        typeValue.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        ),
      ),
    );
  }

  if (typeof typeValue === 'string' && typeValue.trim().length > 0) {
    return [typeValue.trim()];
  }

  return [];
}

export function appendSchemaConstraintDescription(
  schema: Record<string, any>,
  constraintText: string,
): void {
  const currentDescription =
    typeof schema.description === 'string' ? schema.description.trim() : '';
  if (currentDescription.includes(constraintText)) {
    return;
  }

  schema.description =
    currentDescription.length > 0 ? `${currentDescription} ${constraintText}` : constraintText;
}

export function dedupeSchemaVariants(variants: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const deduped: Record<string, any>[] = [];

  for (const variant of variants) {
    const serialized = JSON.stringify(variant);
    if (seen.has(serialized)) {
      continue;
    }

    seen.add(serialized);
    deduped.push(variant);
  }

  return deduped;
}

export function normalizeGeminiNullableType(schema: Record<string, any>): void {
  const normalizedTypes = normalizeSchemaTypeList(schema.type);
  if (normalizedTypes.length === 0) {
    return;
  }

  const nonNullTypes = normalizedTypes.filter((entry) => entry !== 'null');
  const hasNull = nonNullTypes.length !== normalizedTypes.length;

  if (nonNullTypes.length === 1) {
    schema.type = nonNullTypes[0];
    if (hasNull) {
      schema.nullable = true;
    }
    return;
  }

  if (nonNullTypes.length > 1) {
    schema.type = nonNullTypes[0];
    if (hasNull) {
      schema.nullable = true;
    }
    appendSchemaConstraintDescription(schema, `Allowed types: ${normalizedTypes.join(', ')}.`);
    return;
  }

  schema.type = 'string';
}

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
  'patternProperties',
  'propertyNames',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'contains',
  'prefixItems',
  'not',
  'if',
  'then',
  'else',
]);

export function isStrictCompatibleSchema(schema: Record<string, any>, depth = 0): boolean {
  if (!schema || typeof schema !== 'object') {
    return true;
  }

  const normalizedTypes = normalizeSchemaTypeList(schema.type);
  if (normalizedTypes.length > 0) {
    const nonNullTypes = normalizedTypes.filter((entry) => entry !== 'null');
    if (nonNullTypes.length > 1) {
      return false;
    }
  }

  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== undefined) {
      return false;
    }
  }

  if (depth === 0) {
    if (
      schema.anyOf !== undefined ||
      schema.oneOf !== undefined ||
      schema.allOf !== undefined ||
      schema.enum !== undefined
    ) {
      return false;
    }
  }

  if (schema.oneOf !== undefined || schema.allOf !== undefined) {
    return false;
  }

  if (
    schema.type === 'object' ||
    schema.properties !== undefined ||
    schema.additionalProperties !== undefined
  ) {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      return false;
    }

    const rawProperties = schema.properties;
    if (rawProperties === undefined) {
      return depth === 0;
    }

    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      return false;
    }

    const propertyEntries = Object.entries(rawProperties as Record<string, any>);
    if (depth > 0 && propertyEntries.length === 0 && schema.additionalProperties !== false) {
      return false;
    }

    if (
      !propertyEntries.every(([, value]) =>
        isStrictCompatibleSchema(value as Record<string, any>, depth + 1),
      )
    ) {
      return false;
    }
  }

  if (schema.items !== undefined) {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      return false;
    }
    if (!isStrictCompatibleSchema(schema.items as Record<string, any>, depth + 1)) {
      return false;
    }
  }

  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      return false;
    }
    if (
      !(schema.anyOf as Record<string, any>[]).every((entry) =>
        isStrictCompatibleSchema(entry, depth + 1),
      )
    ) {
      return false;
    }
  }

  return true;
}
