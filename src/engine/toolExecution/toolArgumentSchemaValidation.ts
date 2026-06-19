import type { ToolDefinition } from '../../types/tool';
import { normalizeToolInputSchema } from '../../utils/toolSchema';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { enrichToolResultWithSchemaRepair } from './toolResultRepair';

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgumentsRecord(argumentsText: string): Record<string, unknown> | undefined {
  try {
    const parsed = argumentsText ? JSON.parse(argumentsText) : {};
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findToolDefinition(
  toolName: string,
  tools: ReadonlyArray<ToolDefinition> | undefined,
): ToolDefinition | undefined {
  const normalizedToolName = normalizeToolName(toolName);
  return tools?.find((tool) => normalizeToolName(tool.name) === normalizedToolName);
}

function readRequiredFields(schema: unknown): string[] {
  const normalized = normalizeToolInputSchema(isJsonRecord(schema) ? schema : {});
  const properties =
    normalized.properties &&
    typeof normalized.properties === 'object' &&
    !Array.isArray(normalized.properties)
      ? normalized.properties
      : {};
  const propertyNames = new Set(Object.keys(properties));
  return Array.isArray(normalized.required)
    ? normalized.required.filter(
        (field): field is string => typeof field === 'string' && propertyNames.has(field),
      )
    : [];
}

function readSchemaProperties(schema: unknown): Record<string, unknown> {
  const normalized = normalizeToolInputSchema(isJsonRecord(schema) ? schema : {});
  return normalized.properties &&
    typeof normalized.properties === 'object' &&
    !Array.isArray(normalized.properties)
    ? (normalized.properties as Record<string, unknown>)
    : {};
}

function readSchemaTypes(schema: unknown): string[] {
  if (!isJsonRecord(schema)) {
    return [];
  }

  if (Array.isArray(schema.type)) {
    return schema.type.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
  }

  return typeof schema.type === 'string' && schema.type.trim().length > 0
    ? [schema.type.trim()]
    : [];
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  return typeof value === 'string' && value.trim().length === 0;
}

function describeActualType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return 'integer';
  }
  return typeof value;
}

function isValueOfSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isJsonRecord(value);
    case 'string':
      return typeof value === 'string';
    default:
      return true;
  }
}

function valueMatchesSchemaTypes(value: unknown, schema: unknown): boolean {
  const schemaTypes = readSchemaTypes(schema);
  if (schemaTypes.length === 0) {
    return true;
  }
  return schemaTypes.some((type) => isValueOfSchemaType(value, type));
}

function describeExpectedTypes(schema: unknown): string {
  const schemaTypes = readSchemaTypes(schema);
  return schemaTypes.length > 0 ? schemaTypes.join('|') : 'declared schema';
}

function collectInvalidArgumentShapes(params: {
  schema: unknown;
  value: unknown;
  fieldPath: string;
  required?: boolean;
}): Array<{ field: string; expected: string; actual: string }> {
  if (params.value === undefined) {
    return [];
  }

  if (
    params.value === null &&
    params.required !== true &&
    !readSchemaTypes(params.schema).includes('null')
  ) {
    return [];
  }

  if (!valueMatchesSchemaTypes(params.value, params.schema)) {
    return [
      {
        field: params.fieldPath,
        expected: describeExpectedTypes(params.schema),
        actual: describeActualType(params.value),
      },
    ];
  }

  if (!isJsonRecord(params.schema)) {
    return [];
  }

  const schemaRecord = params.schema;
  const schemaTypes = readSchemaTypes(schemaRecord);
  if (
    schemaTypes.includes('array') &&
    Array.isArray(params.value) &&
    isJsonRecord(schemaRecord.items)
  ) {
    const itemSchema = schemaRecord.items;
    const invalidItems: Array<{ field: string; expected: string; actual: string }> = [];
    params.value.forEach((item, index) => {
      invalidItems.push(
        ...collectInvalidArgumentShapes({
          schema: itemSchema,
          value: item,
          fieldPath: `${params.fieldPath}[${index}]`,
        }),
      );
    });
    return invalidItems;
  }

  if (schemaTypes.includes('object') && isJsonRecord(params.value)) {
    const objectValue = params.value;
    const childProperties = isJsonRecord(schemaRecord.properties) ? schemaRecord.properties : {};
    const requiredFields = new Set(readRequiredFields(schemaRecord));
    return Object.entries(childProperties).flatMap(([key, childSchema]) =>
      collectInvalidArgumentShapes({
        schema: childSchema,
        value: objectValue[key],
        fieldPath: `${params.fieldPath}.${key}`,
        required: requiredFields.has(key),
      }),
    );
  }

  return [];
}

function buildInvalidArgumentShapeResult(params: {
  tool: ToolDefinition;
  invalidArguments: ReadonlyArray<{ field: string; expected: string; actual: string }>;
}): string {
  return enrichToolResultWithSchemaRepair({
    toolName: params.tool.name,
    tools: [params.tool],
    result: JSON.stringify({
      status: 'error',
      code: 'invalid_argument_shape',
      tool: params.tool.name,
      invalidArguments: params.invalidArguments,
      error: `Invalid argument shape for ${params.invalidArguments
        .map((entry) => entry.field)
        .join(', ')}`,
    }),
  });
}

export function validateToolArgumentsAgainstSchema(params: {
  toolName: string;
  argumentsText: string;
  tools?: ReadonlyArray<ToolDefinition>;
}): string | undefined {
  const tool = findToolDefinition(params.toolName, params.tools);
  if (!tool) {
    return undefined;
  }

  const args = parseArgumentsRecord(params.argumentsText);
  if (!args) {
    return undefined;
  }

  const requiredFields = readRequiredFields(tool.input_schema);
  const missing = requiredFields.filter((field) => isMissingRequiredValue(args[field]));
  if (missing.length > 0) {
    return enrichToolResultWithSchemaRepair({
      toolName: tool.name,
      tools: [tool],
      result: JSON.stringify({
        status: 'error',
        code: 'missing_required_argument',
        tool: tool.name,
        missingRequiredArguments: missing,
        error: `Missing required argument${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      }),
    });
  }

  const properties = readSchemaProperties(tool.input_schema);
  const requiredFieldSet = new Set(requiredFields);
  const invalidArguments = Object.entries(properties).flatMap(([field, schema]) =>
    collectInvalidArgumentShapes({
      schema,
      value: args[field],
      fieldPath: field,
      required: requiredFieldSet.has(field),
    }),
  );

  if (invalidArguments.length === 0) {
    return undefined;
  }

  return buildInvalidArgumentShapeResult({ tool, invalidArguments });
}
