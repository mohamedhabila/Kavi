import type { AgentRunControlGraphUserInformationSemanticRole } from '../../types/agentRun';
import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';

export const REQUEST_CLARIFICATION_TOOL_NAME = 'request_clarification';
export const REQUEST_CLARIFICATION_RESULT_VERSION = 2 as const;
export const MAX_REQUEST_CLARIFICATION_FIELDS = 12;
export const MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS = 1_200;
export const REQUEST_INFORMATION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

export type RequestClarificationSemanticRole = AgentRunControlGraphUserInformationSemanticRole;

/** What the missing information is needed for. */
export type RequestClarificationPurpose = 'understanding' | 'execution';

const REQUEST_CLARIFICATION_SEMANTIC_ROLES = new Set<RequestClarificationSemanticRole>([
  'authorization',
  'constraint',
  'content',
  'identifier',
  'location',
  'other',
  'preference',
  'quantity',
  'recipient',
  'selection',
  'time',
  'title',
]);

export type RequestClarificationField = Readonly<{
  key: string;
  requiredFor: RequestClarificationPurpose;
  semanticRole: RequestClarificationSemanticRole;
}>;

export type RequestClarification = Readonly<{
  fields: ReadonlyArray<RequestClarificationField>;
  question: string;
}>;

export type RequestClarificationToolResult = Readonly<{
  schemaVersion: typeof REQUEST_CLARIFICATION_RESULT_VERSION;
  status: 'clarification_requested';
  question: string;
  requiredInformation: ReadonlyArray<
    Readonly<{
      key: string;
      authority: 'user';
      requiredFor: RequestClarificationPurpose;
      resolution: 'unresolved';
      semanticRole: RequestClarificationSemanticRole;
    }>
  >;
}>;

type ParseResult =
  | Readonly<{ ok: true; value: RequestClarification }>
  /** `detail` says which value is wrong and what it must be, so the model can correct it. */
  | Readonly<{ ok: false; error: string; detail: string }>;

const FIELD_PROPERTIES = new Set(['key', 'required_for', 'semantic_role']);
const ARGUMENT_PROPERTIES = new Set(['missing_information', 'question']);
const MAX_SHOWN_VALUE_GRAPHEMES = 64;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(record: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

export function isRequestInformationKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_INFORMATION_KEY_PATTERN.test(value);
}

export function isRequestClarificationSemanticRole(
  value: unknown,
): value is RequestClarificationSemanticRole {
  return REQUEST_CLARIFICATION_SEMANTIC_ROLES.has(value as RequestClarificationSemanticRole);
}

function normalizeQuestion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const characterCount = Array.from(normalized).length;
  if (characterCount === 0 || characterCount > MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS) {
    return undefined;
  }
  return normalized;
}

function shown(value: unknown): string {
  if (value === undefined) return 'nothing';
  return truncateGraphemesWithSuffix(
    JSON.stringify(value) ?? String(value),
    MAX_SHOWN_VALUE_GRAPHEMES,
    '…',
  );
}

function unknownProperties(record: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

function parseField(
  value: unknown,
  path: string,
): Readonly<{ field: RequestClarificationField }> | Readonly<{ problem: string }> {
  const record = recordValue(value);
  if (!record) {
    return { problem: `${path} must be an object with key, required_for and semantic_role.` };
  }
  const extra = unknownProperties(record, FIELD_PROPERTIES);
  if (extra.length > 0) {
    return {
      problem: `${path} takes only key, required_for and semantic_role (it also has ${extra.join(', ')}).`,
    };
  }
  if (!isRequestInformationKey(record.key)) {
    return {
      problem: `${path}.key must be a lower-case semantic key such as recipient or date_time (got ${shown(record.key)}).`,
    };
  }
  if (record.required_for !== 'understanding' && record.required_for !== 'execution') {
    return {
      problem: `${path}.required_for must be "understanding" or "execution" (got ${shown(record.required_for)}).`,
    };
  }
  if (!isRequestClarificationSemanticRole(record.semantic_role)) {
    return {
      problem: `${path}.semantic_role must be one of ${Array.from(REQUEST_CLARIFICATION_SEMANTIC_ROLES).join(', ')} (got ${shown(record.semantic_role)}).`,
    };
  }
  return {
    field: {
      key: record.key,
      requiredFor: record.required_for,
      semanticRole: record.semantic_role,
    },
  };
}

function invalidArguments(detail: string): ParseResult {
  return { ok: false, error: 'request_clarification_arguments_invalid', detail };
}

export function parseRequestClarificationArgs(value: unknown): ParseResult {
  const record = recordValue(value);
  if (!record) {
    return invalidArguments(
      'The arguments must be an object with missing_information and question.',
    );
  }
  const extra = unknownProperties(record, ARGUMENT_PROPERTIES);
  if (extra.length > 0) {
    return invalidArguments(
      `request_clarification takes only missing_information and question (it also has ${extra.join(', ')}).`,
    );
  }
  const question = normalizeQuestion(record.question);
  if (!question) {
    return invalidArguments(
      `question must be one non-empty question of at most ${MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS} characters.`,
    );
  }
  const entries = Array.isArray(record.missing_information)
    ? record.missing_information
    : undefined;
  if (!entries || entries.length === 0 || entries.length > MAX_REQUEST_CLARIFICATION_FIELDS) {
    return invalidArguments(
      `missing_information must list 1 to ${MAX_REQUEST_CLARIFICATION_FIELDS} fields.`,
    );
  }

  const fields: RequestClarificationField[] = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = parseField(entry, `missing_information[${index}]`);
    if ('problem' in parsed) {
      return { ok: false, error: 'request_clarification_field_invalid', detail: parsed.problem };
    }
    if (fields.some((field) => field.key === parsed.field.key)) {
      return {
        ok: false,
        error: 'request_clarification_field_duplicate',
        detail: `missing_information has the key ${shown(parsed.field.key)} more than once; give each field its own key.`,
      };
    }
    fields.push(parsed.field);
  }

  return { ok: true, value: { fields, question } };
}

export function buildRequestClarificationToolResult(
  clarification: RequestClarification,
): RequestClarificationToolResult {
  return {
    schemaVersion: REQUEST_CLARIFICATION_RESULT_VERSION,
    status: 'clarification_requested',
    question: clarification.question,
    requiredInformation: clarification.fields.map((field) => ({
      key: field.key,
      authority: 'user',
      requiredFor: field.requiredFor,
      resolution: 'unresolved',
      semanticRole: field.semanticRole,
    })),
  };
}

export function parseRequestClarificationToolResult(
  content: string,
): RequestClarificationToolResult | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const record = recordValue(parsed);
  if (
    !record ||
    !exactKeys(record, new Set(['schemaVersion', 'status', 'question', 'requiredInformation'])) ||
    record.schemaVersion !== REQUEST_CLARIFICATION_RESULT_VERSION ||
    record.status !== 'clarification_requested'
  ) {
    return undefined;
  }
  const question = normalizeQuestion(record.question);
  if (!question || !Array.isArray(record.requiredInformation)) {
    return undefined;
  }
  const requiredInformation = record.requiredInformation.map((entry) => {
    const information = recordValue(entry);
    if (
      !information ||
      !exactKeys(
        information,
        new Set(['key', 'authority', 'requiredFor', 'resolution', 'semanticRole']),
      ) ||
      !isRequestInformationKey(information.key) ||
      information.authority !== 'user' ||
      (information.requiredFor !== 'understanding' && information.requiredFor !== 'execution') ||
      information.resolution !== 'unresolved' ||
      !isRequestClarificationSemanticRole(information.semanticRole)
    ) {
      return undefined;
    }
    return {
      key: information.key,
      authority: 'user' as const,
      requiredFor: information.requiredFor,
      resolution: 'unresolved' as const,
      semanticRole: information.semanticRole,
    };
  });
  if (
    requiredInformation.length === 0 ||
    requiredInformation.length > MAX_REQUEST_CLARIFICATION_FIELDS ||
    requiredInformation.some((entry) => entry === undefined)
  ) {
    return undefined;
  }
  const canonical = requiredInformation as RequestClarificationToolResult['requiredInformation'];
  if (new Set(canonical.map((entry) => entry.key)).size !== canonical.length) {
    return undefined;
  }

  return {
    schemaVersion: REQUEST_CLARIFICATION_RESULT_VERSION,
    status: 'clarification_requested',
    question,
    requiredInformation: canonical,
  };
}
