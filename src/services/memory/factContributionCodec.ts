import { sha256HexUtf8 } from '../../utils/sha256';
import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemorySourceAuthority,
  type MemoryFactClass,
  type MemorySourceAuthority,
} from './facts/applicabilityProvenance';
import { requireFactScopeIdentity } from './facts/scopeIdentity';
import {
  isMemoryFactScope,
  type MemoryDecayPolicy,
  type MemoryFactKind,
  type MemoryFactScope,
} from './facts/types';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId, requireExactMemoryScopeId } from './memoryScopeIdentity';

export const MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION = 1 as const;
export const MEMORY_FACT_CONTRIBUTION_LIMITS = Object.freeze({
  payloadBytes: 64 * 1024,
  producerIdBytes: 160,
  sourceAliases: 64,
  textBytes: 16 * 1024,
  summaryBytes: 8 * 1024,
  jsonDepth: 8,
  jsonNodes: 2_048,
  jsonCollectionItems: 128,
  jsonKeyBytes: 256,
});

const CONTRIBUTION_KEYS = ['applicability', 'input', 'version'] as const;
const APPLICABILITY_KEYS = ['factClass', 'personaId', 'sourceAuthority'] as const;
const INPUT_KEYS = [
  'attributes',
  'confidence',
  'decayPolicy',
  'decayRate',
  'expiresAt',
  'importance',
  'memoryKind',
  'now',
  'objectEntityId',
  'objectText',
  'originConversationId',
  'originTaskId',
  'originThreadId',
  'pinned',
  'predicate',
  'retrievability',
  'reviewState',
  'scope',
  'sourceActorId',
  'sourceMessageId',
  'sourceRunId',
  'sourceSummary',
  'sourceTurnId',
  'stability',
  'subjectId',
  'supersedePrior',
  'validAt',
] as const;
const ENVELOPE_KEYS = [
  'payloadByteLength',
  'payloadJson',
  'payloadSha256',
  'payloadVersion',
] as const;
const SOURCE_KINDS = ['message', 'run', 'turn'] as const;
const DECAY_POLICIES = ['ephemeral', 'fast', 'normal', 'pinned', 'slow'] as const;
const MEMORY_KINDS = [
  'agent_run',
  'artifact',
  'decision',
  'episodic_event',
  'evidence_span',
  'goal',
  'gotcha',
  'risk',
  'semantic_fact',
  'source',
  'summary',
  'tool_result',
] as const satisfies readonly MemoryFactKind[];
const PRODUCER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type MemoryFactContributionSourceKind = (typeof SOURCE_KINDS)[number];

export interface MemoryFactContributionSourceScope {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  /** Empty string is the canonical persisted representation of no task. */
  taskId: string;
}

export interface MemoryFactContributionSourceAlias {
  sourceKind: MemoryFactContributionSourceKind;
  sourceId: string;
}

export interface MemoryFactContributionProducerIdentity {
  /** Bounded code-owned writer class, for example `turn_structural`. */
  producerId: string;
  /** Unique immutable causal event/item identity within that writer class. */
  producerEventId: string;
}

export interface NormalizedFactApplicabilityProvenance {
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  personaId: string | null;
}

export interface NormalizedRecordFactContributionInput {
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceTurnId: string | null;
  sourceSummary: string | null;
  importance: number;
  decayPolicy: MemoryDecayPolicy;
  expiresAt: number | null;
  validAt: number;
  pinned: boolean;
  sourceActorId: string | null;
  retrievability: number;
  stability: number;
  decayRate: number;
  reviewState: string;
  memoryKind: MemoryFactKind;
  supersedePrior: boolean;
  now: number;
}

export interface MemoryFactContributionPayloadV1 {
  version: typeof MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION;
  input: NormalizedRecordFactContributionInput;
  applicability: NormalizedFactApplicabilityProvenance;
}

export interface EncodedMemoryFactContributionPayload {
  payloadVersion: typeof MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION;
  payloadJson: string;
  payloadSha256: string;
  payloadByteLength: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}

function canonicalStringify(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJson(value));
  if (typeof serialized !== 'string') fail('memory_fact_contribution_payload_invalid');
  return serialized;
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validNullableProvenanceId(value: unknown): value is string | null {
  return value === null || isExactMemoryProvenanceId(value);
}

function validNullableScopeId(value: unknown): value is string | null {
  return value === null || isExactMemoryScopeId(value);
}

function validBoundedJson(value: unknown, state: { nodes: number }, depth = 0): boolean {
  state.nodes += 1;
  if (
    state.nodes > MEMORY_FACT_CONTRIBUTION_LIMITS.jsonNodes ||
    depth > MEMORY_FACT_CONTRIBUTION_LIMITS.jsonDepth
  ) {
    return false;
  }
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return utf8Bytes(value) <= MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MEMORY_FACT_CONTRIBUTION_LIMITS.jsonCollectionItems &&
      value.every((entry) => validBoundedJson(entry, state, depth + 1))
    );
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MEMORY_FACT_CONTRIBUTION_LIMITS.jsonCollectionItems &&
    entries.every(
      ([key, entry]) =>
        utf8Bytes(key) <= MEMORY_FACT_CONTRIBUTION_LIMITS.jsonKeyBytes &&
        validBoundedJson(entry, state, depth + 1),
    )
  );
}

function validApplicability(
  value: unknown,
  scope: MemoryFactScope,
): value is MemoryFactContributionPayloadV1['applicability'] {
  if (!isPlainRecord(value) || !hasExactKeys(value, APPLICABILITY_KEYS)) return false;
  if (
    !closedMemoryFactClass(value.factClass) ||
    !closedMemorySourceAuthority(value.sourceAuthority)
  ) {
    return false;
  }
  if (scope === 'persona') return isExactMemoryScopeId(value.personaId);
  return value.personaId === null;
}

function validNormalizedInput(value: unknown): value is NormalizedRecordFactContributionInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, INPUT_KEYS)) return false;
  if (
    !isExactMemoryProvenanceId(value.subjectId) ||
    typeof value.predicate !== 'string' ||
    value.predicate !== value.predicate.trim() ||
    value.predicate.length === 0 ||
    utf8Bytes(value.predicate) > 512 ||
    typeof value.objectText !== 'string' ||
    value.objectText !== value.objectText.trim() ||
    value.objectText.length === 0 ||
    utf8Bytes(value.objectText) > MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes ||
    !validNullableProvenanceId(value.objectEntityId) ||
    !isPlainRecord(value.attributes) ||
    !validBoundedJson(value.attributes, { nodes: 0 }) ||
    !validUnitInterval(value.confidence) ||
    !validNullableProvenanceId(value.sourceMessageId) ||
    !validNullableProvenanceId(value.sourceRunId) ||
    !isMemoryFactScope(value.scope) ||
    !validNullableScopeId(value.originConversationId) ||
    !validNullableScopeId(value.originThreadId) ||
    !validNullableScopeId(value.originTaskId) ||
    !validNullableProvenanceId(value.sourceTurnId) ||
    (value.sourceSummary !== null &&
      (typeof value.sourceSummary !== 'string' ||
        utf8Bytes(value.sourceSummary) > MEMORY_FACT_CONTRIBUTION_LIMITS.summaryBytes)) ||
    !validUnitInterval(value.importance) ||
    !DECAY_POLICIES.includes(value.decayPolicy as MemoryDecayPolicy) ||
    (value.expiresAt !== null && !validTimestamp(value.expiresAt)) ||
    !validTimestamp(value.validAt) ||
    (value.expiresAt !== null && value.expiresAt <= value.validAt) ||
    typeof value.pinned !== 'boolean' ||
    !validNullableProvenanceId(value.sourceActorId) ||
    !validUnitInterval(value.retrievability) ||
    !validUnitInterval(value.stability) ||
    typeof value.decayRate !== 'number' ||
    !Number.isFinite(value.decayRate) ||
    value.decayRate < 0 ||
    !closedMemoryFactReviewState(value.reviewState) ||
    !MEMORY_KINDS.includes(value.memoryKind as MemoryFactKind) ||
    typeof value.supersedePrior !== 'boolean' ||
    !validTimestamp(value.now)
  ) {
    return false;
  }
  try {
    requireFactScopeIdentity(value, value.scope);
  } catch {
    return false;
  }
  return true;
}

function validPayload(value: unknown): value is MemoryFactContributionPayloadV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, CONTRIBUTION_KEYS)) return false;
  if (
    value.version !== MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION ||
    !validNormalizedInput(value.input)
  ) {
    return false;
  }
  return validApplicability(value.applicability, value.input.scope);
}

export function encodeMemoryFactContributionPayload(
  payload: MemoryFactContributionPayloadV1,
): EncodedMemoryFactContributionPayload {
  if (!validPayload(payload)) return fail('memory_fact_contribution_payload_invalid');
  const payloadJson = canonicalStringify(payload);
  const payloadByteLength = utf8Bytes(payloadJson);
  if (payloadByteLength > MEMORY_FACT_CONTRIBUTION_LIMITS.payloadBytes) {
    return fail('memory_fact_contribution_payload_too_large');
  }
  return {
    payloadVersion: MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
    payloadJson,
    payloadSha256: sha256HexUtf8(payloadJson),
    payloadByteLength,
  };
}

export function decodeMemoryFactContributionPayload(
  encoded: unknown,
): MemoryFactContributionPayloadV1 {
  if (!isPlainRecord(encoded) || !hasExactKeys(encoded, ENVELOPE_KEYS)) {
    return fail('memory_fact_contribution_integrity_invalid');
  }
  if (
    encoded.payloadVersion !== MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION ||
    typeof encoded.payloadJson !== 'string' ||
    typeof encoded.payloadSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(encoded.payloadSha256) ||
    !Number.isSafeInteger(encoded.payloadByteLength) ||
    (encoded.payloadByteLength as number) <= 0 ||
    (encoded.payloadByteLength as number) > MEMORY_FACT_CONTRIBUTION_LIMITS.payloadBytes ||
    utf8Bytes(encoded.payloadJson) !== encoded.payloadByteLength ||
    sha256HexUtf8(encoded.payloadJson) !== encoded.payloadSha256
  ) {
    return fail('memory_fact_contribution_integrity_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded.payloadJson);
  } catch {
    return fail('memory_fact_contribution_payload_invalid');
  }
  if (!validPayload(parsed) || canonicalStringify(parsed) !== encoded.payloadJson) {
    return fail('memory_fact_contribution_payload_invalid');
  }
  return parsed;
}

export function normalizeMemoryFactContributionSourceScope(input: {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
}): MemoryFactContributionSourceScope {
  return {
    memoryOwnerId: requireExactMemoryScopeId(
      input.memoryOwnerId,
      'memory_fact_contribution_owner_id_invalid',
    ),
    memoryConversationId: requireExactMemoryScopeId(
      input.memoryConversationId,
      'memory_fact_contribution_conversation_id_invalid',
    ),
    sourceThreadId: requireExactMemoryScopeId(
      input.sourceThreadId,
      'memory_fact_contribution_thread_id_invalid',
    ),
    taskId:
      input.taskId === null || input.taskId === undefined || input.taskId === ''
        ? ''
        : requireExactMemoryScopeId(input.taskId, 'memory_fact_contribution_task_id_invalid'),
  };
}

export function requireMemoryFactContributionProducerId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    utf8Bytes(value) > MEMORY_FACT_CONTRIBUTION_LIMITS.producerIdBytes ||
    !PRODUCER_ID_PATTERN.test(value)
  ) {
    return fail('memory_fact_contribution_producer_id_invalid');
  }
  return value;
}

export function requireMemoryFactContributionProducerIdentity(input: {
  producerId: unknown;
  producerEventId: unknown;
}): MemoryFactContributionProducerIdentity {
  return {
    producerId: requireMemoryFactContributionProducerId(input.producerId),
    producerEventId: isExactMemoryProvenanceId(input.producerEventId)
      ? input.producerEventId
      : fail('memory_fact_contribution_producer_event_id_invalid'),
  };
}

export function normalizeMemoryFactContributionSourceAliases(
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): MemoryFactContributionSourceAlias[] {
  if (!Array.isArray(aliases) || aliases.length === 0) {
    return fail('memory_fact_contribution_sources_invalid');
  }
  const normalized = new Map<string, MemoryFactContributionSourceAlias>();
  for (const alias of aliases) {
    if (
      !alias ||
      typeof alias !== 'object' ||
      !SOURCE_KINDS.includes(alias.sourceKind) ||
      !isExactMemoryProvenanceId(alias.sourceId)
    ) {
      return fail('memory_fact_contribution_sources_invalid');
    }
    normalized.set(`${alias.sourceKind}\u0000${alias.sourceId}`, {
      sourceKind: alias.sourceKind,
      sourceId: alias.sourceId,
    });
  }
  if (normalized.size > MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases) {
    return fail('memory_fact_contribution_sources_invalid');
  }
  return Array.from(normalized.values()).sort(
    (left, right) =>
      left.sourceKind.localeCompare(right.sourceKind) ||
      left.sourceId.localeCompare(right.sourceId),
  );
}

export function buildMemoryFactContributionId(input: {
  factId: string;
  scope: MemoryFactContributionSourceScope;
  producer: MemoryFactContributionProducerIdentity;
}): string {
  if (!isExactMemoryProvenanceId(input.factId)) {
    return fail('memory_fact_contribution_fact_id_invalid');
  }
  const scope = normalizeMemoryFactContributionSourceScope(input.scope);
  const producer = requireMemoryFactContributionProducerIdentity(input.producer);
  const identity = canonicalStringify([
    'memory-fact-contribution-v1',
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.sourceThreadId,
    scope.taskId,
    producer.producerId,
    producer.producerEventId,
    input.factId,
  ]);
  return `mfc_${sha256HexUtf8(identity)}`;
}
