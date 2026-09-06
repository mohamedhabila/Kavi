import { sha256HexUtf8 } from '../utils/sha256';
import type { ToolCallFailureKind } from './message';

/**
 * Terminal status is owned by the executor. Result content is opaque and must
 * never be inspected to infer whether execution succeeded.
 */
export type ToolRuntimeOutcome =
  | Readonly<{
      status: 'completed';
      content: string;
    }>
  | Readonly<{
      status: 'failed';
      content: string;
      /**
       * Structured failure classification, set by the executor at the point the
       * failure is known. This is the sole source `ToolCall.failureKind` is
       * populated from — never re-derived from `content` text downstream.
       */
      failureKind?: ToolCallFailureKind;
    }>;

export type ExactToolResultEvidence = Readonly<{
  resultSha256: string;
  resultByteLength: number;
}>;

type PrivateExactToolResultAttestation = ExactToolResultEvidence &
  Readonly<{
    content: string;
  }>;

/**
 * Exact-result authority stays attached to the executor-owned outcome object
 * in this process. It is intentionally absent from the serializable outcome
 * surface so model/provider data cannot reproduce it.
 */
const EXACT_RESULT_ATTESTATIONS = new WeakMap<object, PrivateExactToolResultAttestation>();

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function completedToolOutcome(content: string): ToolRuntimeOutcome {
  return Object.freeze({ status: 'completed', content });
}

export function completedToolOutcomeWithExactResultEvidence(content: string): ToolRuntimeOutcome {
  const outcome = completedToolOutcome(content);
  EXACT_RESULT_ATTESTATIONS.set(
    outcome,
    Object.freeze({
      content,
      resultSha256: sha256HexUtf8(content),
      resultByteLength: utf8ByteLength(content),
    }),
  );
  return outcome;
}

/**
 * Returns evidence only when the candidate is byte-for-byte identical to the
 * result attested by the exact in-process outcome object.
 */
export function resolveExactToolResultEvidence(
  outcome: ToolRuntimeOutcome,
  candidate: string,
): ExactToolResultEvidence | undefined {
  const attestation = EXACT_RESULT_ATTESTATIONS.get(outcome);
  if (!attestation || candidate !== attestation.content) return undefined;
  return Object.freeze({
    resultSha256: attestation.resultSha256,
    resultByteLength: attestation.resultByteLength,
  });
}

export function failedToolOutcome(
  content: string,
  failureKind?: Extract<ToolRuntimeOutcome, { status: 'failed' }>['failureKind'],
): ToolRuntimeOutcome {
  return Object.freeze({
    status: 'failed',
    content,
    ...(failureKind ? { failureKind } : {}),
  });
}
