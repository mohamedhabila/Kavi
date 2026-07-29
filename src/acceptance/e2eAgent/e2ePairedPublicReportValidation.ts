import { E2E_MAX_ORACLE_FACTS, E2E_PAIRED_CONDITIONS } from './e2ePairedConditions';
import {
  buildE2EPairedExecutionIdentityHash,
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  resolveE2EPairedExecutionOrder,
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from './e2ePairedRuntime';
import { sameE2EAppSourceRevision, validateE2EAppSourceRevision } from './e2eAppSourceProvenance';
import { validateE2EEstimatedCostSummary } from './e2ePairedEstimatedCost';
import { stableStringify } from './e2eTraceRedaction';

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
  return value;
}

function validateCompletedCondition(
  condition: Extract<E2EPairedConditionExecution, { status: 'completed' }>,
): void {
  const { assessment } = condition;
  validateE2EEstimatedCostSummary(
    condition.result.estimatedCost,
    `${condition.condition}.estimatedCost`,
  );
  if (
    !Number.isSafeInteger(assessment.rubricPassed) ||
    !Number.isSafeInteger(assessment.rubricTotal) ||
    assessment.rubricPassed < 0 ||
    assessment.rubricTotal <= 0 ||
    assessment.rubricPassed > assessment.rubricTotal ||
    assessment.executionCompleted !== condition.result.completed ||
    assessment.passed !==
      (assessment.executionCompleted && assessment.rubricPassed === assessment.rubricTotal)
  ) {
    throw new Error(`Condition ${condition.condition} has an invalid paired assessment.`);
  }
}

export function validateE2EPairedRuntimeForPublicProjection(runtime: E2EPairedRuntimeResult): void {
  if (runtime.schemaVersion !== E2E_PAIRED_RUNTIME_SCHEMA_VERSION) {
    throw new Error('Paired runtime evidence uses an unsupported schema version.');
  }
  requireHash(runtime.pairIdHash, 'pairIdHash');
  requireHash(runtime.invariantConfigHash, 'invariantConfigHash');
  requireHash(runtime.scenarioInputHash, 'scenarioInputHash');
  validateE2EAppSourceRevision(runtime.source.app, 'source.app');
  validateE2EAppSourceRevision(runtime.source.completionApp, 'source.completionApp');
  const expectedSourceStatus = !sameE2EAppSourceRevision(
    runtime.source.app,
    runtime.source.completionApp,
  )
    ? 'mismatch'
    : runtime.source.app.dirty
      ? 'dirty'
      : 'clean_match';
  if (runtime.source.status !== expectedSourceStatus) {
    throw new Error('Paired runtime source status is inconsistent with its app revisions.');
  }
  if (
    runtime.model.role !== 'assistant' ||
    !['hosted_tool_capable', 'on_device'].includes(runtime.model.capabilityClass) ||
    !runtime.model.provider ||
    !/^sha256-[a-f0-9]{64}$/u.test(runtime.model.model) ||
    runtime.model.revision !== null ||
    (runtime.model.capabilityClass === 'hosted_tool_capable'
      ? !/^[a-f0-9]{64}$/u.test(runtime.model.endpointSha256 ?? '')
      : runtime.model.endpointSha256 !== null)
  ) {
    throw new Error('Paired runtime model provenance is invalid.');
  }
  if (!Array.isArray(runtime.conditions) || runtime.conditions.length !== 2) {
    throw new Error('Public paired evidence requires exactly two condition outcomes.');
  }
  if (new Set(runtime.conditions.map((condition) => condition.condition)).size !== 2) {
    throw new Error('Public paired evidence must not duplicate a condition.');
  }
  if (
    !runtime.comparison ||
    typeof runtime.comparison !== 'object' ||
    Array.isArray(runtime.comparison)
  ) {
    throw new Error('Public paired evidence requires declared comparison roles.');
  }
  if (
    runtime.comparison.referenceCondition !== runtime.conditions[0].condition ||
    runtime.comparison.candidateCondition !== runtime.conditions[1].condition
  ) {
    throw new Error('Public paired evidence does not match its declared comparison roles.');
  }
  if (
    !Number.isSafeInteger(runtime.executionSeed) ||
    runtime.executionSeed < 0 ||
    runtime.executionSeed > 0xffffffff
  ) {
    throw new Error('Public paired evidence requires an unsigned 32-bit execution seed.');
  }
  const expectedExecutionOrder = resolveE2EPairedExecutionOrder(
    runtime.comparison,
    runtime.executionSeed,
  );
  if (stableStringify(runtime.executionOrder) !== stableStringify(expectedExecutionOrder)) {
    throw new Error('Public paired execution order does not match its seed.');
  }
  const executionIdentityHashes = new Set<string>();
  for (const condition of runtime.conditions) {
    if (!E2E_PAIRED_CONDITIONS.includes(condition.condition)) {
      throw new Error('Public paired evidence contains an unsupported condition.');
    }
    requireHash(condition.conditionConfigHash, `${condition.condition}.conditionConfigHash`);
    requireHash(condition.executionIdentityHash, `${condition.condition}.executionIdentityHash`);
    const expectedExecutionIdentityHash = buildE2EPairedExecutionIdentityHash({
      pairIdHash: runtime.pairIdHash,
      seed: runtime.executionSeed,
      condition: condition.condition,
    });
    if (condition.executionIdentityHash !== expectedExecutionIdentityHash) {
      throw new Error(`${condition.condition}.executionIdentityHash is inconsistent.`);
    }
    executionIdentityHashes.add(condition.executionIdentityHash);
    const oracleEvidenceCountValid =
      Number.isSafeInteger(condition.oracleEvidenceCount) &&
      (condition.condition === 'oracle_evidence'
        ? condition.oracleEvidenceCount >= 1 &&
          condition.oracleEvidenceCount <= E2E_MAX_ORACLE_FACTS
        : condition.oracleEvidenceCount === 0);
    if (!oracleEvidenceCountValid) {
      throw new Error(`${condition.condition}.oracleEvidenceCount is inconsistent.`);
    }
    if (condition.status === 'completed') validateCompletedCondition(condition);
    else if (condition.status === 'failed') {
      if (
        ![
          'source_provenance',
          'state_reset',
          'condition_execution',
          'evidence_validation',
        ].includes(condition.category)
      ) {
        throw new Error(`${condition.condition}.category is unsupported.`);
      }
      requireHash(condition.errorHash, `${condition.condition}.errorHash`);
    } else {
      throw new Error(`${condition.condition}.status is unsupported.`);
    }
  }
  if (executionIdentityHashes.size !== runtime.conditions.length) {
    throw new Error('Public paired evidence must use distinct execution identities.');
  }
  if (runtime.cleanup.status === 'failed') {
    if (!['state_cleanup', 'store_restoration'].includes(runtime.cleanup.category)) {
      throw new Error('cleanup.category is unsupported.');
    }
    requireHash(runtime.cleanup.errorHash, 'cleanup.errorHash');
  } else if (runtime.cleanup.status !== 'completed') {
    throw new Error('cleanup.status is unsupported.');
  }
  if (typeof runtime.validForDeltaClaims !== 'boolean') {
    throw new Error('validForDeltaClaims must be a boolean.');
  }
  const structurallyValid =
    runtime.source.status === 'clean_match' &&
    runtime.cleanup.status === 'completed' &&
    runtime.conditions.every((condition) => condition.status === 'completed');
  if (runtime.validForDeltaClaims !== structurallyValid) {
    throw new Error(
      'Paired runtime delta eligibility is inconsistent with infrastructure evidence.',
    );
  }
}
