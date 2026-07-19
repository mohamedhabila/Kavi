import type {
  RequiredInformationPurpose,
  RequiredRequestInformation,
} from './requestFrame';
import type { AgentRunControlGraphUserInformationSemanticRole } from '../../types/agentRun';

export const REQUEST_CLARIFICATION_TOOL_NAME = 'request_clarification';
export const REQUEST_CLARIFICATION_RESULT_VERSION = 2 as const;
export const MAX_REQUEST_CLARIFICATION_FIELDS = 12;
export const MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS = 1_200;
export const REQUEST_INFORMATION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

export type RequestClarificationSemanticRole =
  AgentRunControlGraphUserInformationSemanticRole;

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
  requiredFor: Exclude<RequiredInformationPurpose, 'authorization'>;
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
      key: RequiredRequestInformation['key'];
      authority: 'user';
      requiredFor: Exclude<RequiredInformationPurpose, 'authorization'>;
      resolution: 'unresolved';
      semanticRole: RequestClarificationSemanticRole;
    }>
  >;
}>;

type ParseResult =
  | Readonly<{ ok: true; value: RequestClarification }>
  | Readonly<{ ok: false; error: string }>;

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
  return REQUEST_CLARIFICATION_SEMANTIC_ROLES.has(
    value as RequestClarificationSemanticRole,
  );
}

function normalizeQuestion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const characterCount = Array.from(normalized).length;
  if (
    characterCount === 0 ||
    characterCount > MAX_REQUEST_CLARIFICATION_QUESTION_CHARACTERS
  ) {
    return undefined;
  }
  return normalized;
}

function parseField(value: unknown): RequestClarificationField | undefined {
  const record = recordValue(value);
  if (
    !record ||
    !exactKeys(record, new Set(['key', 'required_for', 'semantic_role']))
  ) {
    return undefined;
  }
  if (!isRequestInformationKey(record.key)) {
    return undefined;
  }
  const requiredFor =
    record.required_for === 'understanding' || record.required_for === 'execution'
      ? record.required_for
      : undefined;
  return requiredFor && isRequestClarificationSemanticRole(record.semantic_role)
    ? {
        key: record.key,
        requiredFor,
        semanticRole: record.semantic_role,
      }
    : undefined;
}

export function parseRequestClarificationArgs(value: unknown): ParseResult {
  const record = recordValue(value);
  if (!record || !exactKeys(record, new Set(['missing_information', 'question']))) {
    return { ok: false, error: 'request_clarification_arguments_invalid' };
  }
  const question = normalizeQuestion(record.question);
  const entries = Array.isArray(record.missing_information)
    ? record.missing_information
    : undefined;
  if (
    !question ||
    !entries ||
    entries.length === 0 ||
    entries.length > MAX_REQUEST_CLARIFICATION_FIELDS
  ) {
    return { ok: false, error: 'request_clarification_arguments_invalid' };
  }

  const fields = entries.map(parseField);
  if (fields.some((field) => field === undefined)) {
    return { ok: false, error: 'request_clarification_field_invalid' };
  }
  const canonicalFields = fields as RequestClarificationField[];
  if (new Set(canonicalFields.map((field) => field.key)).size !== canonicalFields.length) {
    return { ok: false, error: 'request_clarification_field_duplicate' };
  }

  return {
    ok: true,
    value: {
      fields: canonicalFields,
      question,
    },
  };
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
    !exactKeys(
      record,
      new Set(['schemaVersion', 'status', 'question', 'requiredInformation']),
    ) ||
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
      (information.requiredFor !== 'understanding' &&
        information.requiredFor !== 'execution') ||
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
