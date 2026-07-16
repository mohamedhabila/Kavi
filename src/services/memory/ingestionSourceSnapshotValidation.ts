import type { Message, ToolCall } from '../../types/message';
import {
  isDeliverableAssistantCompletionMetadata,
  isValidAssistantMessageMetadata,
} from '../../utils/assistantMessageMetadata';
import type {
  IngestionSourceSnapshotLimits,
  IngestionSourceSnapshotMessage,
  IngestionSourceSnapshotTruncation,
  IngestionSourceSnapshotV1,
} from './ingestionSourceSnapshot';
import {
  INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS,
  utf8IngestionSourceSnapshotByteLength,
} from './ingestionSourceSnapshotProjection';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

const MESSAGE_ROLES = new Set<Message['role']>(['system', 'user', 'assistant', 'tool']);
const TOOL_CALL_STATUSES = new Set<ToolCall['status']>(
  'pending running completed failed'.split(' ') as ToolCall['status'][],
);
const ASSISTANT_KINDS = new Set(['intermediate', 'final']);
const ASSISTANT_COMPLETION_STATUSES = new Set(['complete', 'incomplete']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
function hasOnlyOptionalKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
function validateText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && utf8IngestionSourceSnapshotByteLength(value) <= maxBytes;
}
function validateToolName(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/\p{C}/u.test(value) &&
    utf8IngestionSourceSnapshotByteLength(value) <= maxBytes
  );
}
function validateAssistantMetadata(value: unknown, maxBytes: number): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, ['kind', 'completionStatus', 'finishReason']) &&
    typeof value.kind === 'string' &&
    ASSISTANT_KINDS.has(value.kind) &&
    typeof value.completionStatus === 'string' &&
    ASSISTANT_COMPLETION_STATUSES.has(value.completionStatus) &&
    isValidAssistantMessageMetadata(value) &&
    validateText(value.finishReason, maxBytes)
  );
}
function validateToolCall(
  value: unknown,
  maxBytes: number,
  limits: IngestionSourceSnapshotLimits,
): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyOptionalKeys(value, ['id', 'name', 'arguments', 'status'], ['result', 'error']) &&
    isExactMemoryProvenanceId(value.id) &&
    validateToolName(value.name, limits.toolNameBytes) &&
    validateText(value.arguments, maxBytes) &&
    typeof value.status === 'string' &&
    TOOL_CALL_STATUSES.has(value.status as ToolCall['status']) &&
    (value.result === undefined || validateText(value.result, maxBytes)) &&
    (value.error === undefined || validateText(value.error, maxBytes))
  );
}
function validateMessage(
  value: unknown,
  maxBytes: number,
  limits: IngestionSourceSnapshotLimits,
): value is IngestionSourceSnapshotMessage {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyOptionalKeys(
      value,
      ['id', 'role', 'content', 'timestamp'],
      [
        'enrichedContent',
        'toolCalls',
        'toolCallId',
        'hasAttachments',
        'isError',
        'assistantMetadata',
      ],
    ) ||
    !isExactMemoryProvenanceId(value.id) ||
    typeof value.role !== 'string' ||
    !MESSAGE_ROLES.has(value.role as Message['role']) ||
    !validateText(value.content, maxBytes) ||
    !Number.isSafeInteger(value.timestamp) ||
    (value.timestamp as number) < 0 ||
    (value.enrichedContent !== undefined && !validateText(value.enrichedContent, maxBytes)) ||
    (value.toolCallId !== undefined && !isExactMemoryProvenanceId(value.toolCallId)) ||
    (value.hasAttachments !== undefined && value.hasAttachments !== true) ||
    (value.isError !== undefined && value.isError !== true) ||
    (value.assistantMetadata !== undefined &&
      (value.role !== 'assistant' ||
        !validateAssistantMetadata(
          value.assistantMetadata,
          Math.min(maxBytes, limits.metadataTextBytes),
        )))
  ) {
    return false;
  }
  return (
    value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) &&
      value.toolCalls.length > 0 &&
      value.toolCalls.length <= limits.toolCallsPerMessage &&
      value.toolCalls.every((toolCall) => validateToolCall(toolCall, maxBytes, limits)))
  );
}
function validateTruncation(value: unknown): value is IngestionSourceSnapshotTruncation {
  if (!isRecord(value)) return false;
  const keys = [
    'anchorTextByteLimit',
    'supplementalTextByteLimit',
    'messageTextFields',
    'toolTextFields',
    'graphGoalEvidenceFields',
    'graphGoalEvidenceEntries',
  ];
  return (
    hasOnlyKeys(value, keys) &&
    INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS.includes(
      value.anchorTextByteLimit as (typeof INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS)[number],
    ) &&
    INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS.includes(
      value.supplementalTextByteLimit as (typeof INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS)[number],
    ) &&
    keys.slice(2).every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
  );
}

export function validateIngestionSourceSnapshotPayload(
  value: unknown,
  limits: IngestionSourceSnapshotLimits,
): value is IngestionSourceSnapshotV1 {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      'version',
      'sourceStartMessageId',
      'sourceEndMessageId',
      'priorUserMessageId',
      'priorUserMessage',
      'turnMessages',
      'graphGoalEvidence',
      'truncation',
    ]) ||
    value.version !== 1 ||
    (value.sourceStartMessageId !== null &&
      !isExactMemoryProvenanceId(value.sourceStartMessageId)) ||
    !isExactMemoryProvenanceId(value.sourceEndMessageId) ||
    (value.priorUserMessageId !== null && !isExactMemoryProvenanceId(value.priorUserMessageId)) ||
    !validateTruncation(value.truncation) ||
    !Array.isArray(value.turnMessages) ||
    value.turnMessages.length === 0 ||
    value.turnMessages.length > limits.turnMessages ||
    !Array.isArray(value.graphGoalEvidence) ||
    value.graphGoalEvidence.length > limits.graphGoalEvidenceEntries
  ) {
    return false;
  }
  const truncation = value.truncation;
  const prior = value.priorUserMessage;
  if (
    (value.priorUserMessageId === null && prior !== null) ||
    (value.priorUserMessageId !== null &&
      (!isRecord(prior) ||
        !hasOnlyKeys(prior, ['id', 'role']) ||
        prior.id !== value.priorUserMessageId ||
        prior.role !== 'user'))
  ) {
    return false;
  }

  const messages = value.turnMessages;
  const ids = new Set<string>();
  let totalToolCalls = 0;
  const anchorIds = new Set([
    value.sourceEndMessageId,
    ...(value.sourceStartMessageId ? [value.sourceStartMessageId] : []),
  ]);
  for (const candidate of messages) {
    const candidateId = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '';
    const textLimit = anchorIds.has(candidateId)
      ? truncation.anchorTextByteLimit
      : truncation.supplementalTextByteLimit;
    if (!validateMessage(candidate, textLimit, limits) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
    totalToolCalls += candidate.toolCalls?.length ?? 0;
  }
  if (totalToolCalls > limits.toolCallsTotal) return false;
  const first = messages[0] as IngestionSourceSnapshotMessage;
  const last = messages.at(-1) as IngestionSourceSnapshotMessage;
  const hasUnexpectedUser = messages.some(
    (message, index) => message.role === 'user' && index !== 0,
  );
  if (
    (value.sourceStartMessageId !== null &&
      (first.id !== value.sourceStartMessageId || first.role !== 'user')) ||
    (value.sourceStartMessageId === null && messages.some((message) => message.role === 'user')) ||
    hasUnexpectedUser ||
    last.id !== value.sourceEndMessageId ||
    last.role !== 'assistant' ||
    !isDeliverableAssistantCompletionMetadata(last.assistantMetadata) ||
    (value.priorUserMessageId !== null && ids.has(value.priorUserMessageId))
  ) {
    return false;
  }
  return value.graphGoalEvidence.every((entry) =>
    validateText(entry, truncation.supplementalTextByteLimit),
  );
}
