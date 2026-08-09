import type { ToolDefinition } from '../../types/tool';

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(text: string): JsonRecord | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

function readTopLevelFieldPath(fieldPath: string): string {
  const dotIndex = fieldPath.indexOf('.');
  const bracketIndex = fieldPath.indexOf('[');
  const endIndexes = [dotIndex, bracketIndex].filter((index) => index >= 0);
  const endIndex = endIndexes.length > 0 ? Math.min(...endIndexes) : -1;
  return endIndex >= 0 ? fieldPath.slice(0, endIndex) : fieldPath;
}

function readInvalidArgumentFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => {
          if (!isJsonRecord(entry)) {
            return '';
          }
          return typeof entry.field === 'string' ? readTopLevelFieldPath(entry.field.trim()) : '';
        })
        .filter(Boolean),
    ),
  );
}

function readInvalidArgumentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) =>
          isJsonRecord(entry) && typeof entry.field === 'string' ? entry.field.trim() : '',
        )
        .filter(Boolean),
    ),
  );
}

function readSchemaObject(value: unknown): JsonRecord | undefined {
  return isJsonRecord(value) ? value : undefined;
}

function compactSchemaProperty(property: unknown): JsonRecord {
  if (!isJsonRecord(property)) {
    return {};
  }

  const compact: JsonRecord = {};
  for (const key of [
    'type',
    'format',
    'enum',
    'items',
    'description',
    'minLength',
    'maxLength',
  ] as const) {
    if (property[key] !== undefined) {
      compact[key] = property[key];
    }
  }
  return compact;
}

function findToolDefinition(
  toolName: string,
  tools: ReadonlyArray<ToolDefinition> | undefined,
): ToolDefinition | undefined {
  const normalizedName = toolName.trim();
  return tools?.find((tool) => tool.name.trim() === normalizedName);
}

/** The field path used when the arguments blob itself could not be parsed. */
const ARGUMENTS_ROOT_FIELD = '$';

function buildExpectedArgumentsSchema(params: {
  tool: ToolDefinition;
  fields: ReadonlyArray<string>;
  includeRequiredFields?: boolean;
}): JsonRecord {
  const schema = readSchemaObject(params.tool.input_schema);
  const properties = readSchemaObject(schema?.properties);
  const required = readStringArray(schema?.required);

  /**
   * A root-level failure means the whole call was unparseable, so every property is what
   * the model needs back — not a property literally named `$`.
   *
   * Looking `$` up in `properties` found nothing and produced `expectedShape: {"$": {}}`:
   * a repair contract that names no field and shows no example. Traced on-device, that is
   * exactly as useless as it reads — the model sent `file_edit` with
   * `"edits": ["op": "replace", …]` instead of `[{…}]`, got back an empty shape, had
   * nothing to correct against, and re-sent the identical call. Two failures, no progress,
   * and it then rewrote the whole file instead of editing it.
   */
  if (params.fields.includes(ARGUMENTS_ROOT_FIELD)) {
    return Object.keys(properties ?? {}).reduce<JsonRecord>((acc, field) => {
      acc[field] = compactSchemaProperty(properties?.[field]);
      return acc;
    }, {});
  }

  const fields = Array.from(
    new Set([...(params.includeRequiredFields ? required : []), ...params.fields]),
  );

  return fields.reduce<JsonRecord>((acc, field) => {
    acc[field] = compactSchemaProperty(properties?.[field]);
    return acc;
  }, {});
}

export function enrichToolResultWithSchemaRepair(params: {
  result: string;
  toolName: string;
  tools?: ReadonlyArray<ToolDefinition>;
}): string {
  const parsed = parseJsonRecord(params.result);
  if (!parsed) {
    return params.result;
  }

  if (isJsonRecord(parsed.repair)) {
    return params.result;
  }

  if (parsed.code !== 'missing_required_argument') {
    if (parsed.code !== 'invalid_argument_shape') {
      return params.result;
    }

    const invalidFields = readInvalidArgumentFields(parsed.invalidArguments);
    const invalidPaths = readInvalidArgumentPaths(parsed.invalidArguments);
    if (invalidFields.length === 0) {
      return params.result;
    }

    const tool = findToolDefinition(params.toolName, params.tools);
    if (!tool) {
      return params.result;
    }

    return JSON.stringify(
      {
        ...parsed,
        repair: {
          retryable: true,
          code: 'invalid_argument_shape',
          invalidFields,
          invalidPaths,
          expectedShape: {
            arguments: buildExpectedArgumentsSchema({ tool, fields: invalidFields }),
          },
          fieldPlacement:
            'Send corrected values as top-level JSON properties in the next tool call arguments.',
          valueSource:
            'Use values already present in the user request, graph goals, or prior tool outputs. Do not invent unavailable values.',
          sideEffectApplied: false,
        },
      },
      null,
      2,
    );
  }

  const missingFields = readStringArray(parsed.missingRequiredArguments);
  if (missingFields.length === 0) {
    return params.result;
  }

  const tool = findToolDefinition(params.toolName, params.tools);
  if (!tool) {
    return params.result;
  }

  return JSON.stringify(
    {
      ...parsed,
      repair: {
        retryable: true,
        code: 'missing_required_argument',
        missingFields,
        expectedShape: {
          arguments: buildExpectedArgumentsSchema({
            tool,
            fields: missingFields,
            includeRequiredFields: true,
          }),
        },
        fieldPlacement:
          'Send required fields as top-level JSON properties in the next tool call arguments.',
        valueSource:
          'Use values already present in the user request, graph goals, or prior tool outputs. Do not invent unavailable values.',
        sideEffectApplied: false,
      },
    },
    null,
    2,
  );
}
