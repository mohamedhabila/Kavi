import type { Message, ToolCall } from '../../types/message';
import {
  hasTerminalAssistantCompletionMetadata,
  isValidAssistantMessageMetadata,
} from '../../utils/assistantMessageMetadata';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import {
  resolvePriorUserMessageIdentity,
  resolveUniqueMessageIdentity,
} from './priorUserMessageIdentity';
import type {
  IngestionSourceSnapshotAssistantMetadata,
  IngestionSourceSnapshotInput,
  IngestionSourceSnapshotLimits,
  IngestionSourceSnapshotMessage,
  IngestionSourceSnapshotPriorUserIdentity,
  IngestionSourceSnapshotToolCall,
  IngestionSourceSnapshotV1,
} from './ingestionSourceSnapshot';

export const INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS = [
  16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0,
] as const;
const MESSAGE_ROLES = new Set<Message['role']>(['system', 'user', 'assistant', 'tool']);
const TOOL_CALL_STATUSES = new Set<ToolCall['status']>(
  'pending running completed failed'.split(' ') as ToolCall['status'][],
);
const ASSISTANT_KINDS = new Set(['intermediate', 'final']);
const ASSISTANT_COMPLETION_STATUSES = new Set(['complete', 'incomplete']);
const TRUNCATION_MARKER = '\n…[truncated]…\n';

type TruncationCategory = 'message' | 'tool' | 'graphGoalEvidence';
interface TruncationTracker {
  message: number;
  tool: number;
  graphGoalEvidence: number;
}
export interface PreparedIngestionSourceSnapshot {
  turnMessages: readonly Message[];
  priorUserMessage: IngestionSourceSnapshotPriorUserIdentity | null;
  graphGoalEvidence: readonly string[];
  omittedGraphGoalEvidenceEntries: number;
  anchorMessageIds: ReadonlySet<string>;
  limits: IngestionSourceSnapshotLimits;
}

function fail(code: string): never {
  throw new Error(code);
}
export function utf8IngestionSourceSnapshotByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}
export function canonicalStringifyIngestionSourceSnapshot(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJson(value));
  if (typeof serialized !== 'string') fail('memory_ingestion_source_snapshot_not_serializable');
  return serialized;
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const output: string[] = [];
  let used = 0;
  for (const character of value) {
    const bytes = utf8IngestionSourceSnapshotByteLength(character);
    if (used + bytes > maxBytes) break;
    output.push(character);
    used += bytes;
  }
  return output.join('');
}
function takeUtf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const output: string[] = [];
  let used = 0;
  for (let index = value.length; index > 0; ) {
    let start = index - 1;
    const current = value.charCodeAt(start);
    if (current >= 0xdc00 && current <= 0xdfff && start > 0) {
      const prior = value.charCodeAt(start - 1);
      if (prior >= 0xd800 && prior <= 0xdbff) start -= 1;
    }
    const character = value.slice(start, index);
    const bytes = utf8IngestionSourceSnapshotByteLength(character);
    if (used + bytes > maxBytes) break;
    output.push(character);
    used += bytes;
    index = start;
  }
  return output.reverse().join('');
}
function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (utf8IngestionSourceSnapshotByteLength(value) <= maxBytes) {
    return { value, truncated: false };
  }
  if (maxBytes <= 0) return { value: '', truncated: true };
  const markerBytes = utf8IngestionSourceSnapshotByteLength(TRUNCATION_MARKER);
  if (maxBytes <= markerBytes) return { value: takeUtf8Prefix(value, maxBytes), truncated: true };
  const contentBudget = maxBytes - markerBytes;
  const prefixBudget = Math.ceil(contentBudget / 2);
  return {
    value: `${takeUtf8Prefix(value, prefixBudget)}${TRUNCATION_MARKER}${takeUtf8Suffix(
      value,
      contentBudget - prefixBudget,
    )}`,
    truncated: true,
  };
}
function boundedText(
  value: string,
  maxBytes: number,
  category: TruncationCategory,
  tracker: TruncationTracker,
): string {
  const bounded = truncateUtf8(value, maxBytes);
  if (bounded.truncated) tracker[category] += 1;
  return bounded.value;
}
function requireBoundedExactText(value: unknown, maxBytes: number, code: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    /\p{C}/u.test(value) ||
    utf8IngestionSourceSnapshotByteLength(value) > maxBytes
  ) {
    fail(code);
  }
  return value;
}
function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('memory_ingestion_source_snapshot_timestamp_invalid');
  }
  return value as number;
}

export function prepareIngestionSourceSnapshot(
  input: IngestionSourceSnapshotInput,
  limits: IngestionSourceSnapshotLimits,
): PreparedIngestionSourceSnapshot {
  if (!Array.isArray(input.messages)) fail('memory_ingestion_source_snapshot_messages_invalid');
  if (!isExactMemoryProvenanceId(input.sourceEndMessageId)) {
    fail('memory_ingestion_source_snapshot_source_end_invalid');
  }
  if (
    input.sourceStartMessageId !== null &&
    !isExactMemoryProvenanceId(input.sourceStartMessageId)
  ) {
    fail('memory_ingestion_source_snapshot_source_start_invalid');
  }
  if (input.priorUserMessageId !== null && !isExactMemoryProvenanceId(input.priorUserMessageId)) {
    fail('memory_ingestion_source_snapshot_prior_user_invalid');
  }

  const sourceEnd = resolveUniqueMessageIdentity(input.messages, input.sourceEndMessageId);
  if (
    sourceEnd.status === 'invalid' ||
    !hasTerminalAssistantCompletionMetadata(sourceEnd.message)
  ) {
    fail('memory_ingestion_source_snapshot_source_end_unavailable');
  }
  let sourceStartIndex = 0;
  if (input.sourceStartMessageId !== null) {
    const sourceStart = resolveUniqueMessageIdentity(input.messages, input.sourceStartMessageId);
    if (
      sourceStart.status === 'invalid' ||
      sourceStart.message.role !== 'user' ||
      sourceStart.index >= sourceEnd.index
    ) {
      fail('memory_ingestion_source_snapshot_source_start_unavailable');
    }
    sourceStartIndex = sourceStart.index;
  }
  const firstPossibleLaterUser = input.sourceStartMessageId === null ? 0 : sourceStartIndex + 1;
  if (
    input.messages
      .slice(firstPossibleLaterUser, sourceEnd.index + 1)
      .some((message) => message.role === 'user')
  ) {
    fail('memory_ingestion_source_snapshot_order_invalid');
  }

  const priorIdentity = resolvePriorUserMessageIdentity(
    input.messages,
    input.sourceStartMessageId ?? undefined,
  );
  if (
    priorIdentity.status === 'invalid' ||
    priorIdentity.priorUserMessageId !== input.priorUserMessageId
  ) {
    fail('memory_ingestion_source_snapshot_prior_user_mismatch');
  }
  let priorUserMessage: IngestionSourceSnapshotPriorUserIdentity | null = null;
  if (input.priorUserMessageId !== null) {
    const prior = resolveUniqueMessageIdentity(input.messages, input.priorUserMessageId);
    if (
      prior.status === 'invalid' ||
      prior.message.role !== 'user' ||
      prior.index >= sourceStartIndex
    ) {
      fail('memory_ingestion_source_snapshot_prior_user_unavailable');
    }
    priorUserMessage = { id: prior.message.id, role: 'user' };
  }

  const turnMessages = input.messages.slice(sourceStartIndex, sourceEnd.index + 1);
  if (turnMessages.length === 0 || turnMessages.length > limits.turnMessages) {
    fail('memory_ingestion_source_snapshot_message_count_invalid');
  }
  const ids = new Set<string>();
  for (const message of turnMessages) {
    if (!isExactMemoryProvenanceId(message.id) || ids.has(message.id)) {
      fail('memory_ingestion_source_snapshot_message_identity_invalid');
    }
    ids.add(message.id);
  }
  if (turnMessages.at(-1)?.id !== input.sourceEndMessageId) {
    fail('memory_ingestion_source_snapshot_order_invalid');
  }

  const evidenceInput = input.graphGoalEvidence ?? [];
  if (!Array.isArray(evidenceInput) || evidenceInput.some((entry) => typeof entry !== 'string')) {
    fail('memory_ingestion_source_snapshot_graph_evidence_invalid');
  }
  const graphGoalEvidence = evidenceInput.slice(-limits.graphGoalEvidenceEntries);
  const anchorMessageIds = new Set<string>([input.sourceEndMessageId]);
  for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
    const message = turnMessages[index];
    if (message?.role === 'user') {
      anchorMessageIds.add(message.id);
      break;
    }
  }
  return {
    turnMessages,
    priorUserMessage,
    graphGoalEvidence,
    omittedGraphGoalEvidenceEntries: evidenceInput.length - graphGoalEvidence.length,
    anchorMessageIds,
    limits,
  };
}

function projectToolCall(
  toolCall: ToolCall,
  textByteLimit: number,
  tracker: TruncationTracker,
  limits: IngestionSourceSnapshotLimits,
): IngestionSourceSnapshotToolCall {
  const id = isExactMemoryProvenanceId(toolCall.id)
    ? toolCall.id
    : fail('memory_ingestion_source_snapshot_tool_call_id_invalid');
  const name = requireBoundedExactText(
    toolCall.name,
    limits.toolNameBytes,
    'memory_ingestion_source_snapshot_tool_name_invalid',
  );
  if (typeof toolCall.arguments !== 'string' || !TOOL_CALL_STATUSES.has(toolCall.status)) {
    fail('memory_ingestion_source_snapshot_tool_call_invalid');
  }
  const projected: IngestionSourceSnapshotToolCall = {
    id,
    name,
    arguments: boundedText(toolCall.arguments, textByteLimit, 'tool', tracker),
    status: toolCall.status,
  };
  for (const key of ['result', 'error'] as const) {
    const value = toolCall[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') fail('memory_ingestion_source_snapshot_tool_call_invalid');
    projected[key] = boundedText(value, textByteLimit, 'tool', tracker);
  }
  return projected;
}
function projectAssistantMetadata(
  message: Message,
  limits: IngestionSourceSnapshotLimits,
): IngestionSourceSnapshotAssistantMetadata | undefined {
  const metadata = message.assistantMetadata;
  if (metadata === undefined) return undefined;
  if (
    message.role !== 'assistant' ||
    !ASSISTANT_KINDS.has(metadata.kind) ||
    !ASSISTANT_COMPLETION_STATUSES.has(metadata.completionStatus) ||
    !isValidAssistantMessageMetadata(metadata)
  ) {
    fail('memory_ingestion_source_snapshot_assistant_metadata_invalid');
  }
  return {
    kind: metadata.kind,
    completionStatus: metadata.completionStatus,
    finishReason: requireBoundedExactText(
      metadata.finishReason,
      limits.metadataTextBytes,
      'memory_ingestion_source_snapshot_assistant_metadata_invalid',
    ),
  };
}
function projectMessage(
  message: Message,
  textByteLimit: number,
  tracker: TruncationTracker,
  toolCallCount: { value: number },
  limits: IngestionSourceSnapshotLimits,
): IngestionSourceSnapshotMessage {
  if (
    !isExactMemoryProvenanceId(message.id) ||
    !MESSAGE_ROLES.has(message.role) ||
    typeof message.content !== 'string'
  ) {
    fail('memory_ingestion_source_snapshot_message_invalid');
  }
  const projected: IngestionSourceSnapshotMessage = {
    id: message.id,
    role: message.role,
    content: boundedText(message.content, textByteLimit, 'message', tracker),
    timestamp: requireTimestamp(message.timestamp),
  };
  if (message.enrichedContent !== undefined) {
    if (typeof message.enrichedContent !== 'string') {
      fail('memory_ingestion_source_snapshot_message_invalid');
    }
    projected.enrichedContent = boundedText(
      message.enrichedContent,
      textByteLimit,
      'message',
      tracker,
    );
  }
  if (message.toolCalls !== undefined) {
    if (
      !Array.isArray(message.toolCalls) ||
      message.toolCalls.length === 0 ||
      message.toolCalls.length > limits.toolCallsPerMessage
    ) {
      fail('memory_ingestion_source_snapshot_tool_call_count_invalid');
    }
    toolCallCount.value += message.toolCalls.length;
    if (toolCallCount.value > limits.toolCallsTotal) {
      fail('memory_ingestion_source_snapshot_tool_call_count_invalid');
    }
    projected.toolCalls = message.toolCalls.map((toolCall) =>
      projectToolCall(toolCall, textByteLimit, tracker, limits),
    );
  }
  if (message.toolCallId !== undefined) {
    if (!isExactMemoryProvenanceId(message.toolCallId)) {
      fail('memory_ingestion_source_snapshot_tool_result_id_invalid');
    }
    projected.toolCallId = message.toolCallId;
  }
  if (message.attachments !== undefined) {
    if (!Array.isArray(message.attachments)) {
      fail('memory_ingestion_source_snapshot_attachments_invalid');
    }
    if (message.attachments.length > 0) projected.hasAttachments = true;
  }
  if (message.isError !== undefined && typeof message.isError !== 'boolean') {
    fail('memory_ingestion_source_snapshot_message_invalid');
  }
  if (message.isError) projected.isError = true;
  const metadata = projectAssistantMetadata(message, limits);
  if (metadata) projected.assistantMetadata = metadata;
  return projected;
}

export function buildIngestionSourceSnapshotPayload(
  input: IngestionSourceSnapshotInput,
  prepared: PreparedIngestionSourceSnapshot,
  anchorTextByteLimit: number,
  supplementalTextByteLimit: number,
): IngestionSourceSnapshotV1 {
  const tracker: TruncationTracker = { message: 0, tool: 0, graphGoalEvidence: 0 };
  const toolCallCount = { value: 0 };
  const turnMessages = prepared.turnMessages.map((message) =>
    projectMessage(
      message,
      prepared.anchorMessageIds.has(message.id) ? anchorTextByteLimit : supplementalTextByteLimit,
      tracker,
      toolCallCount,
      prepared.limits,
    ),
  );
  const graphGoalEvidence = prepared.graphGoalEvidence.map((entry) =>
    boundedText(entry, supplementalTextByteLimit, 'graphGoalEvidence', tracker),
  );
  return {
    version: 1,
    sourceStartMessageId: input.sourceStartMessageId,
    sourceEndMessageId: input.sourceEndMessageId,
    priorUserMessageId: input.priorUserMessageId,
    priorUserMessage: prepared.priorUserMessage,
    turnMessages,
    graphGoalEvidence,
    truncation: {
      anchorTextByteLimit,
      supplementalTextByteLimit,
      messageTextFields: tracker.message,
      toolTextFields: tracker.tool,
      graphGoalEvidenceFields: tracker.graphGoalEvidence,
      graphGoalEvidenceEntries: prepared.omittedGraphGoalEvidenceEntries,
    },
  };
}
