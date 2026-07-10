import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import {
  evaluateExperienceLearning,
  type ExperienceAttemptAuthority,
  type ExperienceAttemptOutcome,
  type ExperienceLearningDecision,
} from './experienceLearningPolicy';

const MAX_OBSERVATIONS = 20_000;
const MAX_EVIDENCE_TERMS = 16;
const MAX_TERM_CHARS = 120;
const MAX_RECORDS = 2_000;
const MAX_QUERY_CHARS = 2_000;
const MAX_TOP_K = 10;
const COMMON_TERM_RATE = 0.8;

export interface ExperienceProcedureObservation {
  runId: string;
  domainId: string;
  environmentId: string;
  procedureId: string;
  preconditionIds: ReadonlyArray<string>;
  outcome: ExperienceAttemptOutcome;
  authority: ExperienceAttemptAuthority;
  confidence: number;
  observedAt: number;
  evidenceTerms?: ReadonlyArray<string>;
}

export interface LearnedExperienceRecord {
  id: string;
  domainId: string;
  environmentId: string;
  procedureId: string;
  preconditionIds: ReadonlyArray<string>;
  recommendation: 'prefer' | 'avoid';
  confidence: number;
  evidence: {
    runIds: ReadonlyArray<string>;
    successCount: number;
    failureCount: number;
  };
  commonEvidenceTerms: ReadonlyArray<string>;
}

export interface ExperienceLearningArtifact {
  version: 1;
  records: ReadonlyArray<LearnedExperienceRecord>;
}

export interface ExperienceLearningArtifactBuildResult {
  artifact: ExperienceLearningArtifact;
  diagnostics: {
    observationCount: number;
    invalidObservationCount: number;
    groupCount: number;
    learnedGroupCount: number;
    insufficientGroupCount: number;
    invalidGroupCount: number;
  };
}

function boundedEvidenceTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > MAX_TERM_CHARS) return null;
  return normalized;
}

function validConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function normalizeObservation(value: unknown): ExperienceProcedureObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const observation = value as Partial<ExperienceProcedureObservation>;
  if (
    !isExactMemoryProvenanceId(observation.runId) ||
    !isExactDurableScopeId(observation.domainId) ||
    !isExactDurableScopeId(observation.environmentId) ||
    !isExactDurableScopeId(observation.procedureId) ||
    !Array.isArray(observation.preconditionIds) ||
    observation.preconditionIds.length > 16 ||
    !observation.preconditionIds.every(isExactDurableScopeId) ||
    new Set(observation.preconditionIds).size !== observation.preconditionIds.length ||
    (observation.outcome !== 'success' && observation.outcome !== 'failure') ||
    (observation.authority !== 'tool_observed' &&
      observation.authority !== 'verified' &&
      observation.authority !== 'assistant_inferred') ||
    !validConfidence(observation.confidence) ||
    !validTimestamp(observation.observedAt) ||
    (observation.evidenceTerms !== undefined && !Array.isArray(observation.evidenceTerms))
  ) {
    return null;
  }
  const evidenceTerms = Array.from(
    new Set(
      (observation.evidenceTerms ?? [])
        .slice(0, MAX_EVIDENCE_TERMS)
        .map(boundedEvidenceTerm)
        .filter((term): term is string => term !== null),
    ),
  ).sort((left, right) => left.localeCompare(right));
  if ((observation.evidenceTerms?.length ?? 0) !== evidenceTerms.length) return null;
  return {
    runId: observation.runId,
    domainId: observation.domainId,
    environmentId: observation.environmentId,
    procedureId: observation.procedureId,
    preconditionIds: [...observation.preconditionIds].sort(),
    outcome: observation.outcome,
    authority: observation.authority,
    confidence: observation.confidence,
    observedAt: observation.observedAt,
    ...(evidenceTerms.length ? { evidenceTerms } : {}),
  };
}

function groupKey(observation: ExperienceProcedureObservation): string {
  return JSON.stringify([
    observation.domainId,
    observation.environmentId,
    observation.procedureId,
    observation.preconditionIds,
  ]);
}

function stableFingerprint128(value: string): string {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

function dominantOutcome(decision: Extract<ExperienceLearningDecision, { status: 'learned' }>) {
  return decision.recommendation === 'prefer' ? 'success' : 'failure';
}

function commonEvidenceTerms(
  observations: ReadonlyArray<ExperienceProcedureObservation>,
  decision: Extract<ExperienceLearningDecision, { status: 'learned' }>,
): string[] {
  const eligibleRunIds = new Set(decision.evidence.runIds);
  const dominant = observations.filter(
    (observation) =>
      eligibleRunIds.has(observation.runId) && observation.outcome === dominantOutcome(decision),
  );
  if (!dominant.length) return [];
  const counts = new Map<string, number>();
  for (const observation of dominant) {
    for (const term of new Set(observation.evidenceTerms ?? [])) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  const minimumCount = Math.ceil(dominant.length * COMMON_TERM_RATE);
  return Array.from(counts.entries())
    .filter(([, count]) => count >= minimumCount)
    .sort(([leftTerm, leftCount], [rightTerm, rightCount]) =>
      rightCount !== leftCount ? rightCount - leftCount : leftTerm.localeCompare(rightTerm),
    )
    .slice(0, 8)
    .map(([term]) => term);
}

function learnedRecord(
  observations: ReadonlyArray<ExperienceProcedureObservation>,
  decision: Extract<ExperienceLearningDecision, { status: 'learned' }>,
): LearnedExperienceRecord {
  const identity = JSON.stringify([
    decision.scope.domainId,
    decision.scope.environmentId,
    decision.scope.procedureId,
    decision.scope.preconditionIds,
    decision.recommendation,
  ]);
  return {
    id: `learning-${stableFingerprint128(identity)}`,
    domainId: decision.scope.domainId,
    environmentId: decision.scope.environmentId,
    procedureId: decision.scope.procedureId,
    preconditionIds: [...decision.scope.preconditionIds],
    recommendation: decision.recommendation,
    confidence: decision.confidence,
    evidence: {
      runIds: [...decision.evidence.runIds],
      successCount: decision.evidence.successCount,
      failureCount: decision.evidence.failureCount,
    },
    commonEvidenceTerms: commonEvidenceTerms(observations, decision),
  };
}

export function buildExperienceLearningArtifact(
  values: ReadonlyArray<unknown>,
): ExperienceLearningArtifactBuildResult {
  const boundedValues = values.slice(0, MAX_OBSERVATIONS);
  const observations = boundedValues
    .map(normalizeObservation)
    .filter((value): value is ExperienceProcedureObservation => value !== null);
  const groups = new Map<string, ExperienceProcedureObservation[]>();
  for (const observation of observations) {
    const key = groupKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }

  const records: LearnedExperienceRecord[] = [];
  let insufficientGroupCount = 0;
  let invalidGroupCount = 0;
  for (const grouped of groups.values()) {
    const first = grouped[0];
    const decision = evaluateExperienceLearning({
      procedureId: first.procedureId,
      domainId: first.domainId,
      environmentId: first.environmentId,
      preconditionIds: first.preconditionIds,
      attempts: grouped.map((observation) => ({
        runId: observation.runId,
        outcome: observation.outcome,
        authority: observation.authority,
        confidence: observation.confidence,
        observedAt: observation.observedAt,
      })),
    });
    if (decision.status === 'learned') {
      records.push(learnedRecord(grouped, decision));
    } else if (decision.status === 'invalid') {
      invalidGroupCount += 1;
    } else {
      insufficientGroupCount += 1;
    }
  }
  records.sort((left, right) =>
    left.domainId !== right.domainId
      ? left.domainId.localeCompare(right.domainId)
      : left.procedureId !== right.procedureId
        ? left.procedureId.localeCompare(right.procedureId)
        : left.id.localeCompare(right.id),
  );
  if (records.length > MAX_RECORDS) {
    throw new Error('experience_learning_artifact_record_limit_exceeded');
  }
  return {
    artifact: { version: 1, records },
    diagnostics: {
      observationCount: boundedValues.length,
      invalidObservationCount: boundedValues.length - observations.length,
      groupCount: groups.size,
      learnedGroupCount: records.length,
      insufficientGroupCount,
      invalidGroupCount,
    },
  };
}

function sanitizeRecord(value: unknown): LearnedExperienceRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<LearnedExperienceRecord>;
  const evidence = record.evidence;
  if (
    !isExactMemoryProvenanceId(record.id) ||
    !isExactDurableScopeId(record.domainId) ||
    !isExactDurableScopeId(record.environmentId) ||
    !isExactDurableScopeId(record.procedureId) ||
    !Array.isArray(record.preconditionIds) ||
    !record.preconditionIds.every(isExactDurableScopeId) ||
    new Set(record.preconditionIds).size !== record.preconditionIds.length ||
    (record.recommendation !== 'prefer' && record.recommendation !== 'avoid') ||
    !validConfidence(record.confidence) ||
    !evidence ||
    !Array.isArray(evidence.runIds) ||
    !evidence.runIds.every(isExactMemoryProvenanceId) ||
    new Set(evidence.runIds).size !== evidence.runIds.length ||
    !Number.isSafeInteger(evidence.successCount) ||
    (evidence.successCount ?? -1) < 0 ||
    !Number.isSafeInteger(evidence.failureCount) ||
    (evidence.failureCount ?? -1) < 0 ||
    evidence.runIds.length !== (evidence.successCount ?? 0) + (evidence.failureCount ?? 0) ||
    !Array.isArray(record.commonEvidenceTerms) ||
    record.commonEvidenceTerms.length > 8
  ) {
    return null;
  }
  const terms = record.commonEvidenceTerms.map(boundedEvidenceTerm);
  if (terms.some((term) => term === null)) return null;
  return {
    id: record.id,
    domainId: record.domainId,
    environmentId: record.environmentId,
    procedureId: record.procedureId,
    preconditionIds: [...record.preconditionIds],
    recommendation: record.recommendation,
    confidence: record.confidence,
    evidence: {
      runIds: [...evidence.runIds],
      successCount: evidence.successCount,
      failureCount: evidence.failureCount,
    },
    commonEvidenceTerms: terms as string[],
  };
}

export function sanitizeExperienceLearningArtifact(
  value: unknown,
): ExperienceLearningArtifact | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const artifact = value as Partial<ExperienceLearningArtifact>;
  if (
    artifact.version !== 1 ||
    !Array.isArray(artifact.records) ||
    artifact.records.length > MAX_RECORDS
  ) {
    return undefined;
  }
  const records = artifact.records.map(sanitizeRecord);
  if (records.some((record) => record === null)) return undefined;
  const concrete = records as LearnedExperienceRecord[];
  if (new Set(concrete.map((record) => record.id)).size !== concrete.length) return undefined;
  return { version: 1, records: concrete };
}

function lexicalUnits(value: string): string[] {
  return Array.from(
    new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[_:>./-]+/gu, ' ')
        .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
    ),
  );
}

function renderRecord(record: LearnedExperienceRecord): string {
  const verb = record.recommendation === 'prefer' ? 'Prefer' : 'Avoid';
  const conditions = record.preconditionIds.length
    ? ` after ${record.preconditionIds.join(', ')}`
    : '';
  const evidenceTerms = record.commonEvidenceTerms.length
    ? ` Common observed fields or states: ${record.commonEvidenceTerms.join(', ')}.`
    : '';
  return `${verb} procedure ${record.procedureId}${conditions} in ${record.domainId}.${evidenceTerms} Supported by ${record.evidence.runIds.length} independent direct runs (confidence ${record.confidence.toFixed(3)}).`;
}

export function retrieveExperienceLearnings(input: {
  artifact: unknown;
  query: string;
  domainId?: string;
  environmentId?: string;
  topK?: number;
}): string[] {
  const artifact = sanitizeExperienceLearningArtifact(input.artifact);
  if (!artifact || typeof input.query !== 'string') return [];
  const query = input.query.normalize('NFKC').trim();
  if (!query || query.length > MAX_QUERY_CHARS) return [];
  if (input.domainId !== undefined && !isExactDurableScopeId(input.domainId)) return [];
  if (input.environmentId !== undefined && !isExactDurableScopeId(input.environmentId)) return [];
  const topK = Math.max(1, Math.min(MAX_TOP_K, Math.floor(input.topK ?? 3)));
  const queryUnits = new Set(lexicalUnits(query));
  return artifact.records
    .filter(
      (record) =>
        (input.domainId === undefined || record.domainId === input.domainId) &&
        (input.environmentId === undefined || record.environmentId === input.environmentId),
    )
    .map((record) => {
      const text = renderRecord(record);
      const overlap = lexicalUnits(text).filter((unit) => queryUnits.has(unit)).length;
      const support = Math.min(1, record.evidence.runIds.length / 5);
      return { record, text, overlap, score: overlap * 2 + record.confidence + support };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) =>
      right.score !== left.score
        ? right.score - left.score
        : left.record.id.localeCompare(right.record.id),
    )
    .slice(0, topK)
    .map(({ text }) => text);
}
