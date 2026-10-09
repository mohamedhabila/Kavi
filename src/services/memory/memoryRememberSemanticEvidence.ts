import type { EntityType } from './entities';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import { sha256HexUtf8 } from '../../utils/sha256';
import type { SemanticFactProposalV1, SemanticFactSubjectRef } from './semanticFactProposal';
import { decodeMemoryRememberSemanticContract } from './memoryRememberSemanticContract';
import {
  deriveExactToolObservedMemoryEvidenceSpan,
  resolveToolObservedMemoryEvidenceBinding,
  type ToolObservedMemoryEvidenceCapability,
} from './toolObservedMemoryEvidence';

const MAX_MEMORY_REMEMBER_EVIDENCE_SPAN_LENGTH = 600;

export interface BoundMemoryRememberSemanticEvidence {
  readonly kind: 'bound_memory_remember_semantic_evidence';
}

export interface MemoryRememberSemanticEvidenceBinding {
  proposal: Omit<SemanticFactProposalV1, 'evidenceQuote'>;
  subjectType: EntityType;
  evidenceSpan: string;
  source:
    | Readonly<{
        kind: 'current_user';
        sourceMessageId: string;
        sourceContentSha256: string;
      }>
    | Readonly<{
        kind: 'tool_observed';
        sourceMessageId: string;
        sourceToolCallId: string;
        sourceToolName: string;
        sourceArgumentsSha256: string;
        sourceContentSha256: string;
        canonicalStaticContractDigest: string;
      }>;
}

export type BindMemoryRememberSemanticEvidenceResult =
  | { valid: true; evidence: BoundMemoryRememberSemanticEvidence }
  | { valid: false; code: 'invalid_contract'; violations: readonly string[] }
  | {
      valid: false;
      code:
        | 'non_current_assertion'
        | 'subject_not_grounded'
        | 'value_not_grounded'
        | 'evidence_span_limit_exceeded'
        | 'tool_observation_not_grounded'
        | 'tool_observation_ambiguous'
        | 'tool_observation_named_subject_required'
        | 'tool_observation_replace_forbidden';
    };

const bindings = new WeakMap<object, MemoryRememberSemanticEvidenceBinding>();

export function bindMemoryRememberSemanticEvidence(
  raw: unknown,
  request: MemoryRememberRequestEvidence,
  toolObservedEvidence: ReadonlyArray<ToolObservedMemoryEvidenceCapability> = [],
): BindMemoryRememberSemanticEvidenceResult {
  const contract = decodeMemoryRememberSemanticContract(raw, request.userMessageId);
  if (!contract.ok) {
    return { valid: false, code: 'invalid_contract', violations: contract.violations };
  }
  const { proposal: decoded, subjectType } = contract.decoded;
  if (decoded.assertionClass === 'current_direct') {
    const grounding = deriveExactEvidenceSpan(
      decoded.subjectRef,
      decoded.value,
      request.userMessageText,
    );
    if (grounding.valid) {
      return bindEvidence({
        proposal: decoded,
        subjectType,
        evidenceSpan: grounding.evidenceSpan,
        source: {
          kind: 'current_user',
          sourceMessageId: request.userMessageId,
          sourceContentSha256: sha256HexUtf8(request.userMessageText),
        },
      });
    }
    return grounding;
  }
  if (decoded.assertionClass !== 'quoted') {
    return { valid: false, code: 'non_current_assertion' };
  }
  if (decoded.operation !== 'record') {
    return { valid: false, code: 'tool_observation_replace_forbidden' };
  }
  if (decoded.subjectRef.kind !== 'named') {
    return { valid: false, code: 'tool_observation_named_subject_required' };
  }
  const subjectLabel = decoded.subjectRef.label;

  const candidates = toolObservedEvidence.flatMap((capability) => {
    const source = resolveToolObservedMemoryEvidenceBinding(capability);
    if (!source) return [];
    const grounding = deriveExactToolObservedMemoryEvidenceSpan(
      capability,
      subjectLabel,
      decoded.value,
    );
    return grounding.ok ? [{ source, evidenceSpan: grounding.evidenceSpan }] : [];
  });
  if (candidates.length === 0) {
    return { valid: false, code: 'tool_observation_not_grounded' };
  }
  if (candidates.length !== 1) {
    return { valid: false, code: 'tool_observation_ambiguous' };
  }
  const candidate = candidates[0]!;
  return bindEvidence({
    proposal: {
      ...decoded,
      sourceMessageId: candidate.source.sourceMessageId,
      scope: decoded.scope === 'global' || decoded.scope === 'persona' ? 'project' : decoded.scope,
      assertionClass: 'quoted',
    },
    subjectType,
    evidenceSpan: candidate.evidenceSpan,
    source: {
      kind: 'tool_observed',
      sourceMessageId: candidate.source.sourceMessageId,
      sourceToolCallId: candidate.source.sourceToolCallId,
      sourceToolName: candidate.source.sourceToolName,
      sourceArgumentsSha256: candidate.source.argumentsSha256,
      sourceContentSha256: candidate.source.visibleResultSha256,
      canonicalStaticContractDigest: candidate.source.canonicalStaticContractDigest,
    },
  });
}

function bindEvidence(
  binding: MemoryRememberSemanticEvidenceBinding,
): BindMemoryRememberSemanticEvidenceResult {
  const evidence = Object.freeze({
    kind: 'bound_memory_remember_semantic_evidence' as const,
  });
  bindings.set(evidence, binding);
  return { valid: true, evidence };
}

type ExactEvidenceSpanResult =
  | { valid: true; evidenceSpan: string }
  | {
      valid: false;
      code: 'subject_not_grounded' | 'value_not_grounded' | 'evidence_span_limit_exceeded';
    };

function deriveExactEvidenceSpan(
  subjectRef: SemanticFactSubjectRef,
  value: string,
  source: string,
): ExactEvidenceSpanResult {
  const firstValueStart = source.indexOf(value);
  if (firstValueStart === -1) return { valid: false, code: 'value_not_grounded' };

  if (subjectRef.kind === 'self') {
    return boundedEvidenceSpan(source, firstValueStart, firstValueStart + value.length);
  }
  const firstSubjectStart = source.indexOf(subjectRef.label);
  if (firstSubjectStart === -1) {
    return { valid: false, code: 'subject_not_grounded' };
  }

  const bounds = shortestCoveringBoundsInSource(
    source,
    firstSubjectStart,
    subjectRef.label,
    firstValueStart,
    value,
  );
  return boundedEvidenceSpan(source, bounds.start, bounds.end);
}

function shortestCoveringBoundsInSource(
  source: string,
  firstLeftStart: number,
  left: string,
  firstRightStart: number,
  right: string,
): { start: number; end: number } {
  let leftStart = firstLeftStart;
  let rightStart = firstRightStart;
  let best = coveringBounds(leftStart, left.length, rightStart, right.length);
  while (leftStart !== -1 && rightStart !== -1) {
    const candidate = coveringBounds(leftStart, left.length, rightStart, right.length);
    if (
      candidate.end - candidate.start < best.end - best.start ||
      (candidate.end - candidate.start === best.end - best.start && candidate.start < best.start)
    ) {
      best = candidate;
    }
    const advanceLeft = leftStart <= rightStart;
    const advanceRight = rightStart <= leftStart;
    if (advanceLeft) leftStart = source.indexOf(left, leftStart + 1);
    if (advanceRight) rightStart = source.indexOf(right, rightStart + 1);
  }
  return best;
}

function coveringBounds(
  leftStart: number,
  leftLength: number,
  rightStart: number,
  rightLength: number,
): { start: number; end: number } {
  return {
    start: Math.min(leftStart, rightStart),
    end: Math.max(leftStart + leftLength, rightStart + rightLength),
  };
}

function boundedEvidenceSpan(source: string, start: number, end: number): ExactEvidenceSpanResult {
  if (end - start > MAX_MEMORY_REMEMBER_EVIDENCE_SPAN_LENGTH) {
    return { valid: false, code: 'evidence_span_limit_exceeded' };
  }
  return { valid: true, evidenceSpan: source.slice(start, end) };
}

export function resolveBoundMemoryRememberSemanticEvidence(
  evidence: BoundMemoryRememberSemanticEvidence,
): MemoryRememberSemanticEvidenceBinding | null {
  const binding = bindings.get(evidence);
  return binding
    ? {
        ...binding,
        proposal: {
          ...binding.proposal,
          subjectRef: { ...binding.proposal.subjectRef },
        },
      }
    : null;
}
