import { Platform } from 'react-native';

import { buildCodeOwnedToolContractIdentity } from '../../engine/toolExecution/toolContractIdentity';
import { isToolRuntimeAvailable } from '../../engine/tools/runtimeAvailability';
import { useToolPermissionsStore } from '../../services/security/permissions';
import {
  TOOL_EFFECT_KINDS,
  type CodeOwnedToolContractIdentity,
  type ToolEffectKind,
} from '../../types/toolEffectReceipt';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import type { MemoryFact } from './facts/types';
import { getFactById } from './facts/queries';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import {
  buildReceiptBackedProcedureLearningArtifact,
  digestReceiptBackedToolContractIdentity,
  renderReceiptBackedProcedureLearning,
  type LearnedReceiptBackedProcedure,
} from './receiptBackedProcedureLearning';
import { RECEIPT_BACKED_PROCEDURE_PREDICATE } from './receiptBackedProcedurePromotion';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_SUPPORT_ITEMS = 64;
const MAX_PROCEDURE_STEPS = 12;

type JsonRecord = Record<string, unknown>;

interface PersistedProcedureStep {
  sequence: number;
  toolName: string;
  contractIdentityDigest: `sha256:${string}`;
  effectKind: ToolEffectKind;
  settlement: 'observed' | 'verified_effect' | 'user_handoff';
}

interface PersistedProcedureContract {
  version: 1;
  procedureId: string;
  platform: 'android' | 'ios';
  orderedSteps: PersistedProcedureStep[];
}

interface PersistedProcedureLearning {
  procedureId: string;
  domain: string;
  environment: string;
  preconditionIds: string[];
  taskExamples: string[];
  commonQueryTerms: string[];
  supportRunIds: string[];
  supportFactIds: string[];
  supportRunCount: number;
  contract: PersistedProcedureContract;
}

export interface ReceiptBackedProcedureRuntime {
  platform: 'android' | 'ios' | null;
  buildContractIdentity: (
    toolName: string,
  ) => Promise<CodeOwnedToolContractIdentity | null | undefined>;
  isToolAllowed: (toolName: string) => boolean;
  isToolAvailable: (toolName: string) => boolean;
}

export interface ApplicableReceiptBackedProcedure {
  factId: string;
  record: LearnedReceiptBackedProcedure;
  section: string;
}

export type ReceiptBackedProcedureRejectionReason =
  | 'derived_fact_invalid'
  | 'scope_or_time_invalid'
  | 'source_evidence_missing'
  | 'source_evidence_insufficient'
  | 'derived_projection_mismatch'
  | 'runtime_drift';

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactStringArray(
  value: unknown,
  predicate: (entry: string) => boolean,
  maxItems = MAX_SUPPORT_ITEMS,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    !value.every((entry) => typeof entry === 'string' && predicate(entry)) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value;
}

function decodePersistedStep(value: unknown, expectedSequence: number): PersistedProcedureStep | null {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      'sequence',
      'toolName',
      'contractIdentityDigest',
      'effectKind',
      'settlement',
    ]) ||
    value.sequence !== expectedSequence ||
    typeof value.toolName !== 'string' ||
    !isExactDurableScopeId(value.toolName) ||
    typeof value.contractIdentityDigest !== 'string' ||
    !SHA256_PATTERN.test(value.contractIdentityDigest) ||
    typeof value.effectKind !== 'string' ||
    !TOOL_EFFECT_KINDS.includes(value.effectKind as ToolEffectKind) ||
    (value.settlement !== 'observed' &&
      value.settlement !== 'verified_effect' &&
      value.settlement !== 'user_handoff')
  ) {
    return null;
  }
  return {
    sequence: expectedSequence,
    toolName: value.toolName,
    contractIdentityDigest: value.contractIdentityDigest as `sha256:${string}`,
    effectKind: value.effectKind as ToolEffectKind,
    settlement: value.settlement,
  };
}

function decodePersistedContract(value: unknown): PersistedProcedureContract | null {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      'version',
      'procedureId',
      'platform',
      'orderedSteps',
      'replayPolicy',
      'invalidationPolicy',
    ]) ||
    value.version !== 1 ||
    !isExactDurableScopeId(value.procedureId) ||
    (value.platform !== 'android' && value.platform !== 'ios') ||
    !Array.isArray(value.orderedSteps) ||
    value.orderedSteps.length < 2 ||
    value.orderedSteps.length > MAX_PROCEDURE_STEPS
  ) {
    return null;
  }
  const replayPolicy = value.replayPolicy;
  const invalidationPolicy = value.invalidationPolicy;
  if (
    !isPlainRecord(replayPolicy) ||
    !exactKeys(replayPolicy, ['mode', 'argumentPolicy', 'approvalPolicy', 'effectPolicy']) ||
    replayPolicy.mode !== 'advisory_only' ||
    replayPolicy.argumentPolicy !== 'derive_from_current_request' ||
    replayPolicy.approvalPolicy !== 'normal_product_policy' ||
    replayPolicy.effectPolicy !== 'verify_current_effects' ||
    !isPlainRecord(invalidationPolicy) ||
    !exactKeys(invalidationPolicy, [
      'contractIdentity',
      'platform',
      'toolPermission',
      'runtimeAvailability',
      'sourceEvidence',
    ]) ||
    invalidationPolicy.contractIdentity !== 'exact_current_match' ||
    invalidationPolicy.platform !== 'exact_current_match' ||
    invalidationPolicy.toolPermission !== 'must_remain_allowed' ||
    invalidationPolicy.runtimeAvailability !== 'must_remain_available' ||
    invalidationPolicy.sourceEvidence !== 'minimum_three_current_runs'
  ) {
    return null;
  }
  const steps = value.orderedSteps.map(decodePersistedStep);
  if (steps.some((step) => step === null)) return null;
  return {
    version: 1,
    procedureId: value.procedureId,
    platform: value.platform,
    orderedSteps: steps as PersistedProcedureStep[],
  };
}

function decodePersistedLearning(fact: MemoryFact): PersistedProcedureLearning | null {
  if (
    fact.predicate !== RECEIPT_BACKED_PROCEDURE_PREDICATE ||
    fact.memoryKind !== 'agent_run' ||
    fact.scope !== 'global' ||
    fact.sourceAuthority !== 'tool_observed' ||
    fact.reviewState !== 'verified' ||
    fact.sensitivity !== 'normal' ||
    fact.deletedAt !== null ||
    fact.invalidAt !== null ||
    !isPlainRecord(fact.attributes) ||
    !exactKeys(fact.attributes, [
      'experienceLearningVersion',
      'procedureId',
      'domain',
      'environment',
      'preconditionIds',
      'taskExamples',
      'commonQueryTerms',
      'supportRunIds',
      'supportFactIds',
      'supportRunCount',
      'contract',
    ]) ||
    fact.attributes.experienceLearningVersion !== 1 ||
    !isExactDurableScopeId(fact.attributes.procedureId) ||
    !isExactDurableScopeId(fact.attributes.domain) ||
    !isExactDurableScopeId(fact.attributes.environment)
  ) {
    return null;
  }
  const preconditionIds = exactStringArray(
    fact.attributes.preconditionIds,
    isExactDurableScopeId,
    16,
  );
  const taskExamples = exactStringArray(
    fact.attributes.taskExamples,
    (value) => Boolean(value.trim()) && value === value.trim() && value.length <= 2_000,
    5,
  );
  const commonQueryTerms = exactStringArray(
    fact.attributes.commonQueryTerms,
    (value) => Boolean(value.trim()) && value === value.trim() && value.length <= 120,
    24,
  );
  const supportRunIds = exactStringArray(
    fact.attributes.supportRunIds,
    isExactMemoryProvenanceId,
  );
  const supportFactIds = exactStringArray(
    fact.attributes.supportFactIds,
    isExactMemoryProvenanceId,
  );
  const contract = decodePersistedContract(fact.attributes.contract);
  if (
    !preconditionIds ||
    !taskExamples ||
    !commonQueryTerms ||
    !supportRunIds ||
    !supportFactIds ||
    supportRunIds.length < 3 ||
    supportFactIds.length !== supportRunIds.length ||
    fact.attributes.supportRunCount !== supportRunIds.length ||
    !contract ||
    contract.procedureId !== fact.attributes.procedureId
  ) {
    return null;
  }
  return {
    procedureId: fact.attributes.procedureId,
    domain: fact.attributes.domain,
    environment: fact.attributes.environment,
    preconditionIds,
    taskExamples,
    commonQueryTerms,
    supportRunIds,
    supportFactIds,
    supportRunCount: supportRunIds.length,
    contract,
  };
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rebuiltRecordMatches(
  persisted: PersistedProcedureLearning,
  rebuilt: LearnedReceiptBackedProcedure,
): boolean {
  return (
    persisted.procedureId === rebuilt.contract.procedureId &&
    persisted.domain === rebuilt.domainId &&
    persisted.environment === rebuilt.environmentId &&
    sameStringArray(persisted.preconditionIds, rebuilt.preconditionIds) &&
    sameStringArray(persisted.taskExamples, rebuilt.taskExamples) &&
    sameStringArray(persisted.commonQueryTerms, rebuilt.commonQueryTerms) &&
    sameStringArray(persisted.supportRunIds, rebuilt.evidence.runIds) &&
    sameStringArray(persisted.supportFactIds, rebuilt.evidence.factIds) &&
    persisted.contract.orderedSteps.length === rebuilt.contract.orderedSteps.length &&
    persisted.contract.orderedSteps.every((step, index) => {
      const source = rebuilt.contract.orderedSteps[index];
      return (
        source !== undefined &&
        step.sequence === source.sequence &&
        step.toolName === source.toolName &&
        step.effectKind === source.effectKind &&
        step.settlement === source.settlement &&
        step.contractIdentityDigest ===
          digestReceiptBackedToolContractIdentity(source.contractIdentity)
      );
    })
  );
}

function defaultRuntime(): ReceiptBackedProcedureRuntime {
  return {
    platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null,
    buildContractIdentity: buildCodeOwnedToolContractIdentity,
    isToolAllowed: (toolName) => useToolPermissionsStore.getState().isAllowed(toolName),
    isToolAvailable: (toolName) => isToolRuntimeAvailable(toolName),
  };
}

async function currentRuntimeMatches(
  persisted: PersistedProcedureLearning,
  runtime: ReceiptBackedProcedureRuntime,
): Promise<boolean> {
  if (runtime.platform !== persisted.contract.platform) return false;
  for (const step of persisted.contract.orderedSteps) {
    if (!runtime.isToolAllowed(step.toolName) || !runtime.isToolAvailable(step.toolName)) {
      return false;
    }
    const currentIdentity = await runtime.buildContractIdentity(step.toolName);
    if (
      !currentIdentity ||
      digestReceiptBackedToolContractIdentity(currentIdentity) !== step.contractIdentityDigest
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Revalidates the compact derived index against every current raw source fact
 * and the live runtime before any procedure guidance reaches the model.
 */
export async function resolveApplicableReceiptBackedProcedure(input: {
  fact: MemoryFact;
  memoryOwnerId: string;
  asOf: number;
  runtime?: ReceiptBackedProcedureRuntime;
  onReject?: (reason: ReceiptBackedProcedureRejectionReason) => void;
}): Promise<ApplicableReceiptBackedProcedure | null> {
  const reject = (reason: ReceiptBackedProcedureRejectionReason): null => {
    input.onReject?.(reason);
    return null;
  };
  const persisted = decodePersistedLearning(input.fact);
  if (!persisted) return reject('derived_fact_invalid');
  if (
    input.fact.memoryOwnerId !== input.memoryOwnerId ||
    !Number.isSafeInteger(input.asOf) ||
    input.asOf < 0 ||
    input.fact.validAt > input.asOf ||
    (input.fact.expiresAt !== null && input.fact.expiresAt <= input.asOf)
  ) {
    return reject('scope_or_time_invalid');
  }
  const supportFacts = persisted.supportFactIds.flatMap((factId) => {
    const fact = getFactById(factId);
    return fact && fact.memoryOwnerId === input.memoryOwnerId ? [fact] : [];
  });
  if (supportFacts.length !== persisted.supportFactIds.length) {
    return reject('source_evidence_missing');
  }
  const rebuilt = buildReceiptBackedProcedureLearningArtifact(supportFacts).artifact.records.find(
    (record) => record.contract.procedureId === persisted.procedureId,
  );
  if (!rebuilt) return reject('source_evidence_insufficient');
  if (!rebuiltRecordMatches(persisted, rebuilt)) {
    return reject('derived_projection_mismatch');
  }
  try {
    if (!(await currentRuntimeMatches(persisted, input.runtime ?? defaultRuntime()))) {
      return reject('runtime_drift');
    }
  } catch {
    return reject('runtime_drift');
  }
  return {
    factId: input.fact.id,
    record: rebuilt,
    section: renderReceiptBackedProcedureLearning(rebuilt),
  };
}

export function isReceiptBackedProcedureLearningFact(
  fact: Pick<MemoryFact, 'attributes' | 'predicate'>,
): boolean {
  return (
    fact.predicate === RECEIPT_BACKED_PROCEDURE_PREDICATE &&
    fact.attributes.experienceLearningVersion === 1
  );
}
