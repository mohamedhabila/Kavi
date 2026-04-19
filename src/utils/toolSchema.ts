import type { ToolDefinition } from '../types';

const ROOT_TOOL_SCHEMA_PASSTHROUGH_KEYS = [
  'title',
  'description',
  '$defs',
  'definitions',
  '$schema',
  '$id',
  'propertyOrdering',
  'example',
  'examples',
  'default',
  'minProperties',
  'maxProperties',
] as const;

const ROOT_COMPOSITION_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSchemaTypeList(typeValue: unknown): string[] {
  if (Array.isArray(typeValue)) {
    return Array.from(
      new Set(
        typeValue
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim()),
      ),
    );
  }

  if (typeof typeValue === 'string' && typeValue.trim().length > 0) {
    return [typeValue.trim()];
  }

  return [];
}

function normalizeSchemaType(typeValue: unknown): string | string[] | undefined {
  const filtered = normalizeSchemaTypeList(typeValue);
  if (filtered.length === 0) {
    return undefined;
  }

  return filtered.length === 1 ? filtered[0] : filtered;
}

function schemaTypeIncludes(typeValue: string | string[] | undefined, expected: string): boolean {
  return normalizeSchemaTypeList(typeValue).includes(expected);
}

function normalizeObjectLikeType(
  typeValue: string | string[] | undefined,
  expected: 'object' | 'array',
): string | string[] {
  const filtered = normalizeSchemaTypeList(typeValue).filter(
    (entry) => entry === expected || entry === 'null',
  );

  if (!filtered.includes(expected)) {
    return expected;
  }

  return filtered.length === 1 ? expected : filtered;
}

function isObjectLikeSchema(schema: unknown): schema is Record<string, any> {
  if (!isPlainRecord(schema)) {
    return false;
  }

  const explicitType = normalizeSchemaType(schema.type);
  return (
    schemaTypeIncludes(explicitType, 'object') ||
    isPlainRecord(schema.properties) ||
    isPlainRecord(schema.additionalProperties) ||
    schema.additionalProperties === false ||
    schema.additionalProperties === true
  );
}

function getObjectSchemaProperties(schema: Record<string, any>): Record<string, any> {
  return isPlainRecord(schema.properties) ? (schema.properties as Record<string, any>) : {};
}

function getObjectSchemaRequired(
  schema: Record<string, any>,
  propertyKeys?: Set<string>,
): string[] {
  if (!Array.isArray(schema.required)) {
    return [];
  }

  return schema.required.filter(
    (key): key is string => typeof key === 'string' && (!propertyKeys || propertyKeys.has(key)),
  );
}

function copyAdditionalProperties(
  schema: Record<string, any>,
): boolean | Record<string, any> | undefined {
  if (schema.additionalProperties === false || schema.additionalProperties === true) {
    return schema.additionalProperties;
  }

  if (isPlainRecord(schema.additionalProperties)) {
    return cloneJsonLike(schema.additionalProperties);
  }

  return undefined;
}

function schemasAreEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectAnyOfVariants(schema: Record<string, any>): Record<string, any>[] {
  if (Array.isArray(schema.anyOf) && Object.keys(schema).every((key) => key === 'anyOf')) {
    return schema.anyOf.filter(isPlainRecord);
  }

  return [schema];
}

function mergePropertySchemas(
  existing: Record<string, any>,
  incoming: Record<string, any>,
): Record<string, any> {
  if (schemasAreEqual(existing, incoming)) {
    return existing;
  }

  const variants: Record<string, any>[] = [];
  const seen = new Set<string>();

  const pushVariant = (candidate: Record<string, any>) => {
    const serialized = JSON.stringify(candidate);
    if (seen.has(serialized)) {
      return;
    }

    seen.add(serialized);
    variants.push(cloneJsonLike(candidate));
  };

  for (const candidate of collectAnyOfVariants(existing)) {
    pushVariant(candidate);
  }
  for (const candidate of collectAnyOfVariants(incoming)) {
    pushVariant(candidate);
  }

  return variants.length === 1 ? variants[0] : { anyOf: variants };
}

function intersectRequiredKeys(requiredLists: string[][]): string[] {
  if (requiredLists.length === 0) {
    return [];
  }

  let intersection = new Set(requiredLists[0]);
  for (const required of requiredLists.slice(1)) {
    const next = new Set(required);
    intersection = new Set([...intersection].filter((key) => next.has(key)));
  }

  return [...intersection];
}

function normalizePropertyOrdering(
  propertyOrdering: unknown,
  propertyKeys: string[],
): string[] | undefined {
  if (!Array.isArray(propertyOrdering)) {
    return undefined;
  }

  const knownKeys = new Set(propertyKeys);
  const ordered = propertyOrdering.filter(
    (key): key is string => typeof key === 'string' && knownKeys.has(key),
  );
  const missing = propertyKeys.filter((key) => !ordered.includes(key));

  const normalized = [...ordered, ...missing];
  return normalized.length > 0 ? normalized : undefined;
}

function buildToolRootSchema(schema: Record<string, any>): ToolDefinition['input_schema'] {
  const result: ToolDefinition['input_schema'] = {
    type: 'object',
    properties: {},
  };

  for (const key of ROOT_TOOL_SCHEMA_PASSTHROUGH_KEYS) {
    if (schema[key] !== undefined) {
      result[key] = cloneJsonLike(schema[key]);
    }
  }

  const properties = result.properties as Record<string, any>;
  const required = new Set<string>();
  let additionalProperties = copyAdditionalProperties(schema);

  const mergeObjectBranch = (branch: Record<string, any>) => {
    for (const [key, value] of Object.entries(getObjectSchemaProperties(branch))) {
      const propertySchema = value as Record<string, any>;
      properties[key] = properties[key]
        ? mergePropertySchemas(properties[key], propertySchema)
        : cloneJsonLike(propertySchema);
    }
  };

  if (isObjectLikeSchema(schema)) {
    mergeObjectBranch(schema);
    const propertyKeys = new Set(Object.keys(getObjectSchemaProperties(schema)));
    for (const key of getObjectSchemaRequired(schema, propertyKeys)) {
      required.add(key);
    }
  }

  for (const key of ROOT_COMPOSITION_KEYS) {
    const rawBranches = Array.isArray(schema[key]) ? schema[key].filter(isPlainRecord) : [];
    const objectBranches = rawBranches.filter(isObjectLikeSchema);
    if (objectBranches.length === 0) {
      continue;
    }

    for (const branch of objectBranches) {
      mergeObjectBranch(branch);
    }

    if (additionalProperties === undefined) {
      const branchAdditionalProperties = objectBranches
        .map((branch) => copyAdditionalProperties(branch))
        .filter((value) => value !== undefined);

      if (key === 'allOf' && branchAdditionalProperties.includes(false)) {
        additionalProperties = false;
      } else if (branchAdditionalProperties.length > 0) {
        const first = branchAdditionalProperties[0];
        if (branchAdditionalProperties.every((value) => schemasAreEqual(value, first))) {
          additionalProperties = cloneJsonLike(first);
        }
      }
    }

    const requiredLists = objectBranches.map((branch) => {
      const propertyKeys = new Set(Object.keys(getObjectSchemaProperties(branch)));
      return getObjectSchemaRequired(branch, propertyKeys);
    });

    const keysToRequire =
      key === 'allOf'
        ? requiredLists.flat()
        : rawBranches.length === objectBranches.length
          ? intersectRequiredKeys(requiredLists)
          : [];

    for (const requiredKey of keysToRequire) {
      required.add(requiredKey);
    }
  }

  const propertyKeys = Object.keys(properties);
  if (additionalProperties !== undefined) {
    result.additionalProperties = additionalProperties;
  }

  const filteredRequired = [...required].filter((key) => propertyKeys.includes(key));
  if (filteredRequired.length > 0) {
    result.required = filteredRequired;
  }

  const propertyOrdering = normalizePropertyOrdering(result.propertyOrdering, propertyKeys);
  if (propertyOrdering) {
    result.propertyOrdering = propertyOrdering;
  } else {
    delete result.propertyOrdering;
  }

  return result;
}

function inferValueSchemaType(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'object':
      return 'object';
    default:
      return undefined;
  }
}

function inferSchemaTypeFromValues(values: unknown[]): string | string[] | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const valueTypes = Array.from(
    new Set(
      values
        .map((value) => inferValueSchemaType(value))
        .filter((value): value is string => typeof value === 'string'),
    ),
  );

  if (valueTypes.length === 0) {
    return undefined;
  }

  const nonNullTypes = valueTypes.filter((value) => value !== 'null');
  const hasNull = nonNullTypes.length !== valueTypes.length;

  if (nonNullTypes.length !== 1) {
    return undefined;
  }

  return hasNull ? [nonNullTypes[0], 'null'] : nonNullTypes[0];
}

function inferLeafSchemaType(schema: Record<string, any>): string | string[] | undefined {
  if (Array.isArray(schema.enum)) {
    const inferredFromEnum = inferSchemaTypeFromValues(schema.enum);
    if (inferredFromEnum) {
      return inferredFromEnum;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    const inferredFromConst = inferValueSchemaType(schema.const);
    if (inferredFromConst) {
      return inferredFromConst;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    const inferredFromDefault = inferValueSchemaType(schema.default);
    if (inferredFromDefault) {
      return inferredFromDefault;
    }
  }

  return undefined;
}

function normalizeJsonSchemaNode(schema: unknown): Record<string, any> {
  const raw = isPlainRecord(schema) ? cloneJsonLike(schema) : {};
  const result: Record<string, any> = { ...raw };
  const hasObjectShape =
    isPlainRecord(raw.properties) ||
    isPlainRecord(raw.additionalProperties) ||
    raw.additionalProperties === false ||
    raw.additionalProperties === true;
  const hasArrayShape = raw.items !== undefined || Array.isArray(raw.prefixItems);
  const explicitType = normalizeSchemaType(raw.type);

  if (Array.isArray(raw.anyOf)) {
    result.anyOf = raw.anyOf.map((entry: unknown) => normalizeJsonSchemaNode(entry));
  }
  if (Array.isArray(raw.oneOf)) {
    result.oneOf = raw.oneOf.map((entry: unknown) => normalizeJsonSchemaNode(entry));
  }
  if (Array.isArray(raw.allOf)) {
    result.allOf = raw.allOf.map((entry: unknown) => normalizeJsonSchemaNode(entry));
  }

  if (hasObjectShape || schemaTypeIncludes(explicitType, 'object')) {
    const properties = isPlainRecord(raw.properties)
      ? Object.fromEntries(
          Object.entries(raw.properties).map(([key, value]) => [
            key,
            normalizeJsonSchemaNode(value),
          ]),
        )
      : {};

    result.type = normalizeObjectLikeType(explicitType, 'object');
    result.properties = properties;

    const propertyKeys = new Set(Object.keys(properties));
    const required = Array.isArray(raw.required)
      ? raw.required.filter(
          (key): key is string => typeof key === 'string' && propertyKeys.has(key),
        )
      : [];
    if (required.length > 0) {
      result.required = required;
    } else {
      delete result.required;
    }

    if (raw.additionalProperties === false || raw.additionalProperties === true) {
      result.additionalProperties = raw.additionalProperties;
    } else if (isPlainRecord(raw.additionalProperties)) {
      result.additionalProperties = normalizeJsonSchemaNode(raw.additionalProperties);
    }

    return result;
  }

  if (hasArrayShape || schemaTypeIncludes(explicitType, 'array')) {
    let normalizedItems: Record<string, any>;

    if (isPlainRecord(raw.items)) {
      normalizedItems = normalizeJsonSchemaNode(raw.items);
    } else if (Array.isArray(raw.items) && raw.items.length > 0) {
      normalizedItems = {
        anyOf: raw.items.map((entry: unknown) => normalizeJsonSchemaNode(entry)),
      };
    } else if (Array.isArray(raw.prefixItems) && raw.prefixItems.length > 0) {
      normalizedItems = {
        anyOf: raw.prefixItems.map((entry: unknown) => normalizeJsonSchemaNode(entry)),
      };
    } else {
      normalizedItems = { type: 'string' };
    }

    result.type = normalizeObjectLikeType(explicitType, 'array');
    result.items = normalizedItems;
    delete result.prefixItems;
    return result;
  }

  if (explicitType !== undefined) {
    result.type = explicitType;
    return result;
  }

  const inferredLeafType = inferLeafSchemaType(raw);
  if (inferredLeafType !== undefined) {
    result.type = inferredLeafType;
    return result;
  }

  const hasCombinator =
    Array.isArray(result.anyOf) || Array.isArray(result.oneOf) || Array.isArray(result.allOf);
  if (!hasCombinator) {
    result.type = 'string';
  }

  return result;
}

export function normalizeToolInputSchema(schema: unknown): ToolDefinition['input_schema'] {
  const normalized = normalizeJsonSchemaNode(schema);
  return buildToolRootSchema(normalized);
}
