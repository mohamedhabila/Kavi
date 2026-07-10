import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export type ExperienceAttemptOutcome = 'success' | 'failure';
export type ExperienceAttemptAuthority = 'tool_observed' | 'verified' | 'assistant_inferred';

export interface ExperienceAttemptEvidence {
  runId: string;
  outcome: ExperienceAttemptOutcome;
  authority: ExperienceAttemptAuthority;
  confidence: number;
  observedAt: number;
}

export interface ExperienceLearningPolicyInput {
  procedureId: string;
  domainId: string;
  environmentId: string;
  preconditionIds: ReadonlyArray<string>;
  attempts: ReadonlyArray<ExperienceAttemptEvidence>;
}

export type ExperienceLearningDecision =
  | { status: 'invalid'; reason: 'invalid_input' | 'conflicting_run_evidence' }
  | {
      status: 'insufficient_evidence';
      reason: 'not_enough_direct_runs' | 'mixed_outcomes';
      directRunCount: number;
      excludedInferredCount: number;
    }
  | {
      status: 'learned';
      recommendation: 'prefer' | 'avoid';
      scope: {
        procedureId: string;
        domainId: string;
        environmentId: string;
        preconditionIds: ReadonlyArray<string>;
        generalization: 'environment_bound';
      };
      evidence: {
        runIds: ReadonlyArray<string>;
        successCount: number;
        failureCount: number;
        excludedInferredCount: number;
      };
      confidence: number;
    };

const MIN_DIRECT_RUNS = 3;
const MIN_DOMINANT_RATE = 0.8;
const MAX_PRECONDITIONS = 16;
const MAX_ATTEMPTS = 128;

function unitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validAttempt(attempt: ExperienceAttemptEvidence): boolean {
  return (
    Boolean(attempt) &&
    typeof attempt === 'object' &&
    isExactMemoryProvenanceId(attempt.runId) &&
    (attempt.outcome === 'success' || attempt.outcome === 'failure') &&
    (attempt.authority === 'tool_observed' ||
      attempt.authority === 'verified' ||
      attempt.authority === 'assistant_inferred') &&
    unitInterval(attempt.confidence) &&
    Number.isSafeInteger(attempt.observedAt) &&
    attempt.observedAt >= 0
  );
}

function sameAttempt(left: ExperienceAttemptEvidence, right: ExperienceAttemptEvidence): boolean {
  return (
    left.outcome === right.outcome &&
    left.authority === right.authority &&
    left.confidence === right.confidence &&
    left.observedAt === right.observedAt
  );
}

export function evaluateExperienceLearning(
  input: ExperienceLearningPolicyInput,
): ExperienceLearningDecision {
  if (
    !input ||
    typeof input !== 'object' ||
    !isExactDurableScopeId(input.procedureId) ||
    !isExactDurableScopeId(input.domainId) ||
    !isExactDurableScopeId(input.environmentId) ||
    !Array.isArray(input.preconditionIds) ||
    !Array.isArray(input.attempts) ||
    input.preconditionIds.length > MAX_PRECONDITIONS ||
    input.attempts.length > MAX_ATTEMPTS ||
    !input.preconditionIds.every(isExactDurableScopeId) ||
    new Set(input.preconditionIds).size !== input.preconditionIds.length ||
    !input.attempts.every(validAttempt)
  ) {
    return { status: 'invalid', reason: 'invalid_input' };
  }

  const attemptsByRun = new Map<string, ExperienceAttemptEvidence>();
  for (const attempt of input.attempts) {
    const prior = attemptsByRun.get(attempt.runId);
    if (prior && !sameAttempt(prior, attempt)) {
      return { status: 'invalid', reason: 'conflicting_run_evidence' };
    }
    attemptsByRun.set(attempt.runId, attempt);
  }

  const uniqueAttempts = Array.from(attemptsByRun.values());
  const directAttempts = uniqueAttempts.filter(
    (attempt) => attempt.authority === 'tool_observed' || attempt.authority === 'verified',
  );
  const excludedInferredCount = uniqueAttempts.length - directAttempts.length;
  if (directAttempts.length < MIN_DIRECT_RUNS) {
    return {
      status: 'insufficient_evidence',
      reason: 'not_enough_direct_runs',
      directRunCount: directAttempts.length,
      excludedInferredCount,
    };
  }

  const successCount = directAttempts.filter((attempt) => attempt.outcome === 'success').length;
  const failureCount = directAttempts.length - successCount;
  const successRate = successCount / directAttempts.length;
  const failureRate = failureCount / directAttempts.length;
  const recommendation =
    successRate >= MIN_DOMINANT_RATE ? 'prefer' : failureRate >= MIN_DOMINANT_RATE ? 'avoid' : null;
  if (!recommendation) {
    return {
      status: 'insufficient_evidence',
      reason: 'mixed_outcomes',
      directRunCount: directAttempts.length,
      excludedInferredCount,
    };
  }

  const meanEvidenceConfidence =
    directAttempts.reduce((sum, attempt) => sum + attempt.confidence, 0) / directAttempts.length;
  const dominantRate = Math.max(successRate, failureRate);
  const supportFactor = Math.min(1, directAttempts.length / 5);
  return {
    status: 'learned',
    recommendation,
    scope: {
      procedureId: input.procedureId,
      domainId: input.domainId,
      environmentId: input.environmentId,
      preconditionIds: [...input.preconditionIds].sort(),
      generalization: 'environment_bound',
    },
    evidence: {
      runIds: directAttempts.map((attempt) => attempt.runId).sort(),
      successCount,
      failureCount,
      excludedInferredCount,
    },
    confidence: Math.min(1, meanEvidenceConfidence * dominantRate * supportFactor),
  };
}
