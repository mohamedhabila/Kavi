import type { Message, ToolCall } from '../../types/message';
import { sha256HexUtf8 } from '../../utils/sha256';
import {
  buildIngestionSourceSnapshotPayload,
  canonicalStringifyIngestionSourceSnapshot,
  INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS,
  prepareIngestionSourceSnapshot,
  utf8IngestionSourceSnapshotByteLength,
} from './ingestionSourceSnapshotProjection';
import { validateIngestionSourceSnapshotPayload } from './ingestionSourceSnapshotValidation';

export const INGESTION_SOURCE_SNAPSHOT_VERSION = 1 as const;
export const INGESTION_SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  payloadBytes: 512 * 1024,
  turnMessages: 500,
  toolCallsPerMessage: 64,
  toolCallsTotal: 512,
  graphGoalEvidenceEntries: 96,
  textFieldBytes: 16 * 1024,
  metadataTextBytes: 1024,
  toolNameBytes: 256,
});
export type IngestionSourceSnapshotLimits = typeof INGESTION_SOURCE_SNAPSHOT_LIMITS;

export interface IngestionSourceSnapshotInput {
  messages: readonly Message[];
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  priorUserMessageId: string | null;
  graphGoalEvidence?: readonly string[];
}
export type IngestionSourceSnapshotPriorUserIdentity = { id: string; role: 'user' };
export type IngestionSourceSnapshotToolCall = Pick<
  ToolCall,
  'id' | 'name' | 'arguments' | 'status' | 'result' | 'error'
>;
export type IngestionSourceSnapshotAssistantMetadata = Pick<
  NonNullable<Message['assistantMetadata']>,
  'kind' | 'completionStatus' | 'finishReason'
>;
export interface IngestionSourceSnapshotMessage {
  id: string;
  role: Message['role'];
  content: string;
  timestamp: number;
  enrichedContent?: string;
  toolCalls?: IngestionSourceSnapshotToolCall[];
  toolCallId?: string;
  hasAttachments?: true;
  isError?: true;
  assistantMetadata?: IngestionSourceSnapshotAssistantMetadata;
}
export interface IngestionSourceSnapshotTruncation {
  anchorTextByteLimit: number;
  supplementalTextByteLimit: number;
  messageTextFields: number;
  toolTextFields: number;
  graphGoalEvidenceFields: number;
  graphGoalEvidenceEntries: number;
}
export interface IngestionSourceSnapshotV1 {
  version: typeof INGESTION_SOURCE_SNAPSHOT_VERSION;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  priorUserMessageId: string | null;
  priorUserMessage: IngestionSourceSnapshotPriorUserIdentity | null;
  turnMessages: IngestionSourceSnapshotMessage[];
  graphGoalEvidence: string[];
  truncation: IngestionSourceSnapshotTruncation;
}
export interface EncodedIngestionSourceSnapshot {
  snapshotVersion: typeof INGESTION_SOURCE_SNAPSHOT_VERSION;
  payloadJson: string;
  payloadSha256: string;
  payloadByteLength: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function encodePayload(payload: IngestionSourceSnapshotV1): EncodedIngestionSourceSnapshot | null {
  const payloadJson = canonicalStringifyIngestionSourceSnapshot(payload);
  const payloadByteLength = utf8IngestionSourceSnapshotByteLength(payloadJson);
  if (payloadByteLength > INGESTION_SOURCE_SNAPSHOT_LIMITS.payloadBytes) return null;
  return {
    snapshotVersion: INGESTION_SOURCE_SNAPSHOT_VERSION,
    payloadJson,
    payloadSha256: sha256HexUtf8(payloadJson),
    payloadByteLength,
  };
}

/**
 * Capture one immutable, bounded, content-minimal source window. Current-user
 * and terminal-assistant text retain priority when the global payload cap is tight.
 */
export function encodeIngestionSourceSnapshot(
  input: IngestionSourceSnapshotInput,
): EncodedIngestionSourceSnapshot {
  const prepared = prepareIngestionSourceSnapshot(input, INGESTION_SOURCE_SNAPSHOT_LIMITS);
  const maximum = INGESTION_SOURCE_SNAPSHOT_LIMITS.textFieldBytes;
  for (const supplementalLimit of INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS) {
    const encoded = encodePayload(
      buildIngestionSourceSnapshotPayload(input, prepared, maximum, supplementalLimit),
    );
    if (encoded) return encoded;
  }
  for (const anchorLimit of INGESTION_SOURCE_SNAPSHOT_TEXT_BUDGET_STEPS.slice(1)) {
    const encoded = encodePayload(
      buildIngestionSourceSnapshotPayload(input, prepared, anchorLimit, 0),
    );
    if (encoded) return encoded;
  }
  return fail('memory_ingestion_source_snapshot_payload_too_large');
}

/** Verify SHA-256/byte metadata, strict v1 shape, bounds, identities, and canonical JSON. */
export function decodeIngestionSourceSnapshot(encoded: unknown): IngestionSourceSnapshotV1 {
  if (
    typeof encoded !== 'object' ||
    encoded === null ||
    Array.isArray(encoded) ||
    Object.keys(encoded).length !== 4
  ) {
    return fail('memory_ingestion_source_snapshot_integrity_invalid');
  }
  const envelope = encoded as Record<string, unknown>;
  if (
    !['snapshotVersion', 'payloadJson', 'payloadSha256', 'payloadByteLength'].every((key) =>
      Object.hasOwn(envelope, key),
    ) ||
    envelope.snapshotVersion !== INGESTION_SOURCE_SNAPSHOT_VERSION ||
    typeof envelope.payloadJson !== 'string' ||
    typeof envelope.payloadSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(envelope.payloadSha256) ||
    !Number.isSafeInteger(envelope.payloadByteLength) ||
    (envelope.payloadByteLength as number) <= 0 ||
    (envelope.payloadByteLength as number) > INGESTION_SOURCE_SNAPSHOT_LIMITS.payloadBytes ||
    utf8IngestionSourceSnapshotByteLength(envelope.payloadJson) !== envelope.payloadByteLength ||
    sha256HexUtf8(envelope.payloadJson) !== envelope.payloadSha256
  ) {
    return fail('memory_ingestion_source_snapshot_integrity_invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.payloadJson);
  } catch {
    return fail('memory_ingestion_source_snapshot_payload_invalid');
  }
  if (
    !validateIngestionSourceSnapshotPayload(parsed, INGESTION_SOURCE_SNAPSHOT_LIMITS) ||
    canonicalStringifyIngestionSourceSnapshot(parsed) !== envelope.payloadJson
  ) {
    return fail('memory_ingestion_source_snapshot_payload_invalid');
  }
  return parsed;
}
