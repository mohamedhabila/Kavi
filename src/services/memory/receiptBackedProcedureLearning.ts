import {
  TOOL_EFFECT_KINDS,
  type CodeOwnedToolContractIdentity,
  type ToolEffectKind,
} from '../../types/toolEffectReceipt';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { sha256HexUtf8 } from '../../utils/sha256';
import { isInternalAgentControlToolName } from './agentRunExperienceEvidencePolicy';
import { decodeAgentRunTerminalEvidence } from './agentRunTerminalEvidence';
import { evaluateExperienceLearning } from './experienceLearningPolicy';
import type { MemoryFact } from './facts/types';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { tokenizeLexicalUnits } from './ranking/lexical';

export const RECEIPT_BACKED_PROCEDURE_LEARNING_VERSION = 1 as const;

const MAX_SOURCE_FACTS = 2_000;
const MAX_PROCEDURE_STEPS = 12;
const MAX_UNIQUE_TOOLS = 7;
const MAX_TASK_EXAMPLES = 5;
const MAX_SUPPORT_RUNS = 8;
const MAX_QUERY_CHARS = 2_000;
const MAX_GOAL_CHARS = 2_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RECEIPT_ID_PATTERN = /^ter_[a-f0-9]{32}$/u;
const CODE_OWNED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

type ProcedureSettlement = 'observed' | 'verified_effect' | 'user_handoff';

export interface ReceiptBackedProcedureStep {
  sequence: number;
  toolName: string;
  contractIdentity: CodeOwnedToolContractIdentity;
  effectKind: ToolEffectKind;
  settlement: ProcedureSettlement;
}

export interface ReceiptBackedProcedureContract {
  version: 1;
  procedureId: string;
  platform: 'android' | 'ios';
  orderedSteps: ReadonlyArray<ReceiptBackedProcedureStep>;
  replayPolicy: {
    mode: 'advisory_only';
    argumentPolicy: 'derive_from_current_request';
    approvalPolicy: 'normal_product_policy';
    effectPolicy: 'verify_current_effects';
  };
  invalidationPolicy: {
    contractIdentity: 'exact_current_match';
    platform: 'exact_current_match';
    toolPermission: 'must_remain_allowed';
    runtimeAvailability: 'must_remain_available';
    sourceEvidence: 'minimum_three_current_runs';
  };
}

export interface ReceiptBackedProcedureObservation {
  factId: string;
  runId: string;
  domainId: string;
  environmentId: string;
  preconditionIds: ReadonlyArray<string>;
  goal: string;
  observedAt: number;
  receiptIds: ReadonlyArray<string>;
  contract: ReceiptBackedProcedureContract;
}

export interface LearnedReceiptBackedProcedure {
  id: string;
  domainId: string;
  environmentId: string;
  preconditionIds: ReadonlyArray<string>;
  recommendation: 'prefer';
  confidence: number;
  taskExamples: ReadonlyArray<string>;
  commonQueryTerms: ReadonlyArray<string>;
  evidence: {
    runIds: ReadonlyArray<string>;
    factIds: ReadonlyArray<string>;
    receiptIds: ReadonlyArray<string>;
  };
  contract: ReceiptBackedProcedureContract;
}

export interface ReceiptBackedProcedureLearningArtifact {
  version: 1;
  records: ReadonlyArray<LearnedReceiptBackedProcedure>;
}

export interface ReceiptBackedProcedureLearningBuildResult {
  artifact: ReceiptBackedProcedureLearningArtifact;
  diagnostics: {
    sourceFactCount: number;
    validObservationCount: number;
    learnedProcedureCount: number;
    insufficientProcedureCount: number;
    invalidProcedureCount: number;
  };
}

type JsonRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: JsonRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: JsonRecord, expected: ReadonlySet<string>): boolean {
  return Object.keys(value).length === expected.size && hasOnlyKeys(value, expected);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestReceiptBackedToolContractIdentity(
  identity: CodeOwnedToolContractIdentity,
): `sha256:${string}` {
  return `sha256:${sha256HexUtf8(canonicalJson(identity))}`;
}

const CONTRACT_KEYS = new Set([
  'capabilityContractDigest',
  'effectContractDigest',
  'executionPolicyDigest',
  'kind',
  'schemaDigest',
  'toolName',
  'version',
  'workflowContractDigest',
]);

function decodeCodeOwnedContractIdentity(
  value: unknown,
): CodeOwnedToolContractIdentity | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, CONTRACT_KEYS)) return null;
  if (
    value.kind !== 'code_owned' ||
    value.version !== 1 ||
    typeof value.toolName !== 'string' ||
    !CODE_OWNED_ID_PATTERN.test(value.toolName) ||
    typeof value.schemaDigest !== 'string' ||
    !SHA256_PATTERN.test(value.schemaDigest) ||
    typeof value.capabilityContractDigest !== 'string' ||
    !SHA256_PATTERN.test(value.capabilityContractDigest) ||
    typeof value.workflowContractDigest !== 'string' ||
    !SHA256_PATTERN.test(value.workflowContractDigest) ||
    typeof value.effectContractDigest !== 'string' ||
    !SHA256_PATTERN.test(value.effectContractDigest) ||
    typeof value.executionPolicyDigest !== 'string' ||
    !SHA256_PATTERN.test(value.executionPolicyDigest)
  ) {
    return null;
  }
  return {
    kind: 'code_owned',
    version: 1,
    toolName: value.toolName,
    schemaDigest: value.schemaDigest as `sha256:${string}`,
    capabilityContractDigest: value.capabilityContractDigest as `sha256:${string}`,
    workflowContractDigest: value.workflowContractDigest as `sha256:${string}`,
    effectContractDigest: value.effectContractDigest as `sha256:${string}`,
    executionPolicyDigest: value.executionPolicyDigest as `sha256:${string}`,
  };
}

const RECEIPT_KEYS = new Set([
  'contractIdentity',
  'effectKind',
  'effectState',
  'executionRunId',
  'executionState',
  'receiptId',
  'recordedAt',
  'requestDigest',
  'resource',
  'resultDigest',
  'toolCallId',
  'toolName',
  'transportState',
  'verificationState',
]);

function settlementForReceipt(value: JsonRecord): ProcedureSettlement | null {
  if (
    value.transportState !== 'returned' ||
    (value.executionState !== undefined && value.executionState !== 'completed')
  ) {
    return null;
  }
  if (value.effectState === 'none' && value.verificationState === 'not_applicable') {
    return 'observed';
  }
  if (value.effectState === 'applied' && value.verificationState === 'verified') {
    return 'verified_effect';
  }
  if (value.effectState === 'handed_off' && value.verificationState === 'unverified') {
    return 'user_handoff';
  }
  return null;
}

function decodeProcedureStep(
  value: unknown,
  sequence: number,
  runId: string,
): (ReceiptBackedProcedureStep & { receiptId: string; toolCallId: string; recordedAt: number }) | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, RECEIPT_KEYS)) return null;
  const contractIdentity = decodeCodeOwnedContractIdentity(value.contractIdentity);
  const settlement = settlementForReceipt(value);
  if (
    !contractIdentity ||
    !settlement ||
    typeof value.receiptId !== 'string' ||
    !RECEIPT_ID_PATTERN.test(value.receiptId) ||
    !isExactMemoryProvenanceId(value.toolCallId) ||
    typeof value.toolName !== 'string' ||
    value.toolName !== contractIdentity.toolName ||
    isInternalAgentControlToolName(value.toolName) ||
    value.executionRunId !== runId ||
    typeof value.effectKind !== 'string' ||
    !TOOL_EFFECT_KINDS.includes(value.effectKind as ToolEffectKind) ||
    typeof value.requestDigest !== 'string' ||
    !SHA256_PATTERN.test(value.requestDigest) ||
    typeof value.resultDigest !== 'string' ||
    !SHA256_PATTERN.test(value.resultDigest) ||
    !Number.isSafeInteger(value.recordedAt) ||
    (value.recordedAt as number) < 0
  ) {
    return null;
  }
  return {
    sequence,
    toolName: value.toolName,
    contractIdentity,
    effectKind: value.effectKind as ToolEffectKind,
    settlement,
    receiptId: value.receiptId,
    toolCallId: value.toolCallId,
    recordedAt: value.recordedAt as number,
  };
}

function domainForSteps(steps: ReadonlyArray<ReceiptBackedProcedureStep>): string {
  const domains = Array.from(
    new Set(
      steps
        .map((step) => step.effectKind.split('.')[0]!)
        .filter((domain) => domain !== 'observation' && domain !== 'compute'),
    ),
  ).sort();
  return domains.length === 1 ? domains[0]! : 'cross-domain';
}

function preconditionIds(
  platform: 'android' | 'ios',
  toolNames: ReadonlyArray<string>,
): string[] {
  const ids = [`platform:${platform}`];
  for (const toolName of toolNames) {
    const identity = sha256HexUtf8(toolName).slice(0, 32);
    ids.push(`permission:${identity}:allowed`, `runtime:${identity}:available`);
  }
  return ids.sort();
}

function procedureContract(params: {
  platform: 'android' | 'ios';
  steps: ReadonlyArray<ReceiptBackedProcedureStep>;
}): ReceiptBackedProcedureContract {
  const identity = canonicalJson({
    version: RECEIPT_BACKED_PROCEDURE_LEARNING_VERSION,
    orderedSteps: params.steps.map((step) => ({
      toolName: step.toolName,
      contractIdentity: step.contractIdentity,
      effectKind: step.effectKind,
      settlement: step.settlement,
    })),
  });
  return {
    version: 1,
    procedureId: `receipt-procedure-v1-${sha256HexUtf8(identity)}`,
    platform: params.platform,
    orderedSteps: params.steps,
    replayPolicy: {
      mode: 'advisory_only',
      argumentPolicy: 'derive_from_current_request',
      approvalPolicy: 'normal_product_policy',
      effectPolicy: 'verify_current_effects',
    },
    invalidationPolicy: {
      contractIdentity: 'exact_current_match',
      platform: 'exact_current_match',
      toolPermission: 'must_remain_allowed',
      runtimeAvailability: 'must_remain_available',
      sourceEvidence: 'minimum_three_current_runs',
    },
  };
}

function goalTerms(goal: string, steps: ReadonlyArray<ReceiptBackedProcedureStep>): string[] {
  return Array.from(
    new Set([
      ...tokenizeLexicalUnits(goal),
      ...steps.flatMap((step) => [
        ...tokenizeLexicalUnits(step.toolName),
        ...tokenizeLexicalUnits(step.effectKind),
      ]),
    ]),
  )
    .filter((term) => term.length <= 120)
    .slice(0, 32);
}

export function projectReceiptBackedProcedureObservation(
  fact: MemoryFact,
): ReceiptBackedProcedureObservation | null {
  if (
    fact.memoryKind !== 'agent_run' ||
    fact.attributes.experienceLearningVersion !== undefined ||
    !isExactMemoryProvenanceId(fact.id) ||
    !isExactMemoryProvenanceId(fact.sourceRunId) ||
    fact.deletedAt !== null ||
    fact.invalidAt !== null ||
    fact.sensitivity !== 'normal'
  ) {
    return null;
  }
  const terminal = decodeAgentRunTerminalEvidence(fact.attributes.terminalEvidence);
  const receipts = fact.attributes.effectReceipts;
  if (
    !terminal ||
    terminal.sourceRunId !== fact.sourceRunId ||
    !Array.isArray(receipts) ||
    receipts.length < 2 ||
    receipts.length > MAX_PROCEDURE_STEPS
  ) {
    return null;
  }
  const decoded = receipts.map((receipt, index) =>
    decodeProcedureStep(receipt, index, terminal.sourceRunId),
  );
  if (decoded.some((step) => step === null)) return null;
  const concrete = decoded as Array<
    ReceiptBackedProcedureStep & { receiptId: string; toolCallId: string; recordedAt: number }
  >;
  if (
    new Set(concrete.map((step) => step.receiptId)).size !== concrete.length ||
    new Set(concrete.map((step) => step.toolCallId)).size !== concrete.length ||
    concrete.some(
      (step, index) =>
        terminal.observedToolCallIds.indexOf(step.toolCallId) < 0 ||
        (index > 0 &&
          terminal.observedToolCallIds.indexOf(concrete[index - 1]!.toolCallId) >=
            terminal.observedToolCallIds.indexOf(step.toolCallId)),
    ) ||
    !concrete.some((step) => step.settlement !== 'observed')
  ) {
    return null;
  }
  const tools = Array.from(new Set(concrete.map((step) => step.toolName)));
  if (tools.length > MAX_UNIQUE_TOOLS) return null;
  const steps = concrete.map(
    ({ receiptId: _receiptId, toolCallId: _toolCallId, recordedAt: _recordedAt, ...step }) => step,
  );
  const contract = procedureContract({ platform: terminal.platform, steps });
  const conditions = preconditionIds(terminal.platform, tools);
  if (
    !isExactDurableScopeId(contract.procedureId) ||
    !conditions.every(isExactDurableScopeId) ||
    terminal.goal.length > MAX_GOAL_CHARS
  ) {
    return null;
  }
  return {
    factId: fact.id,
    runId: terminal.sourceRunId,
    domainId: domainForSteps(steps),
    environmentId: `kavi-${terminal.platform}`,
    preconditionIds: conditions,
    goal: terminal.goal,
    observedAt: fact.validAt,
    receiptIds: concrete.map((step) => step.receiptId),
    contract,
  };
}

function observationGroupKey(observation: ReceiptBackedProcedureObservation): string {
  return canonicalJson([
    observation.domainId,
    observation.environmentId,
    observation.contract.procedureId,
    observation.preconditionIds,
  ]);
}

function commonQueryTerms(observations: ReadonlyArray<ReceiptBackedProcedureObservation>): string[] {
  const counts = new Map<string, number>();
  for (const observation of observations) {
    for (const term of new Set(goalTerms(observation.goal, observation.contract.orderedSteps))) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  const minimumCount = Math.ceil(observations.length * 0.6);
  return Array.from(counts.entries())
    .filter(([, count]) => count >= minimumCount)
    .sort(([leftTerm, leftCount], [rightTerm, rightCount]) =>
      rightCount !== leftCount ? rightCount - leftCount : leftTerm.localeCompare(rightTerm),
    )
    .slice(0, 24)
    .map(([term]) => term);
}

export function buildReceiptBackedProcedureLearningArtifact(
  facts: ReadonlyArray<MemoryFact>,
): ReceiptBackedProcedureLearningBuildResult {
  const sourceFacts = facts.slice(0, MAX_SOURCE_FACTS);
  const observations = sourceFacts
    .map(projectReceiptBackedProcedureObservation)
    .filter((value): value is ReceiptBackedProcedureObservation => value !== null);
  const groups = new Map<string, ReceiptBackedProcedureObservation[]>();
  for (const observation of observations) {
    const key = observationGroupKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const records: LearnedReceiptBackedProcedure[] = [];
  let insufficientProcedureCount = 0;
  let invalidProcedureCount = 0;
  for (const grouped of groups.values()) {
    const first = grouped[0]!;
    const groupedReceiptIds = grouped.flatMap((observation) => observation.receiptIds);
    if (
      new Set(groupedReceiptIds).size !== groupedReceiptIds.length ||
      grouped.some(
        (observation) => canonicalJson(observation.contract) !== canonicalJson(first.contract),
      )
    ) {
      invalidProcedureCount += 1;
      continue;
    }
    const decision = evaluateExperienceLearning({
      procedureId: first.contract.procedureId,
      domainId: first.domainId,
      environmentId: first.environmentId,
      preconditionIds: first.preconditionIds,
      attempts: grouped.map((observation) => ({
        runId: observation.runId,
        outcome: 'success',
        authority: 'verified',
        confidence: 1,
        observedAt: observation.observedAt,
      })),
    });
    if (decision.status !== 'learned' || decision.recommendation !== 'prefer') {
      if (decision.status === 'invalid') invalidProcedureCount += 1;
      else insufficientProcedureCount += 1;
      continue;
    }
    const evidenceObservations = grouped
      .filter((observation) => decision.evidence.runIds.includes(observation.runId))
      .sort((left, right) =>
        right.observedAt !== left.observedAt
          ? right.observedAt - left.observedAt
          : left.runId.localeCompare(right.runId),
      )
      .slice(0, MAX_SUPPORT_RUNS);
    const taskExamples = Array.from(
      new Set(evidenceObservations.map((observation) => observation.goal)),
    ).slice(0, MAX_TASK_EXAMPLES);
    records.push({
      id: `receipt-learning-v1-${sha256HexUtf8(observationGroupKey(first))}`,
      domainId: first.domainId,
      environmentId: first.environmentId,
      preconditionIds: first.preconditionIds,
      recommendation: 'prefer',
      confidence: decision.confidence,
      taskExamples,
      commonQueryTerms: commonQueryTerms(evidenceObservations),
      evidence: {
        runIds: evidenceObservations.map((observation) => observation.runId).sort(),
        factIds: evidenceObservations.map((observation) => observation.factId).sort(),
        receiptIds: Array.from(
          new Set(evidenceObservations.flatMap((observation) => observation.receiptIds)),
        ).sort(),
      },
      contract: first.contract,
    });
  }
  records.sort((left, right) => left.id.localeCompare(right.id));
  return {
    artifact: { version: 1, records },
    diagnostics: {
      sourceFactCount: sourceFacts.length,
      validObservationCount: observations.length,
      learnedProcedureCount: records.length,
      insufficientProcedureCount,
      invalidProcedureCount,
    },
  };
}

function recordSearchText(record: LearnedReceiptBackedProcedure): string {
  return [
    ...record.taskExamples,
    ...record.commonQueryTerms,
    ...record.contract.orderedSteps.flatMap((step) => [step.toolName, step.effectKind]),
  ].join(' ');
}

export function selectReceiptBackedProcedureLearnings(input: {
  artifact: ReceiptBackedProcedureLearningArtifact;
  query: string;
  topK?: number;
}): LearnedReceiptBackedProcedure[] {
  const query = typeof input.query === 'string' ? input.query.normalize('NFKC').trim() : '';
  if (!query || query.length > MAX_QUERY_CHARS || input.artifact.version !== 1) return [];
  const queryUnits = tokenizeLexicalUnits(query);
  const topK = Math.max(1, Math.min(3, Math.floor(input.topK ?? 1)));
  return input.artifact.records
    .map((record) => {
      const units = tokenizeLexicalUnits(recordSearchText(record));
      const overlap = Array.from(queryUnits).filter((unit) => units.has(unit)).length;
      return { record, overlap, score: overlap * 2 + record.confidence };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) =>
      right.score !== left.score
        ? right.score - left.score
        : left.record.id.localeCompare(right.record.id),
    )
    .slice(0, topK)
    .map(({ record }) => record);
}

export function renderReceiptBackedProcedureLearning(
  record: LearnedReceiptBackedProcedure,
): string {
  const steps = record.contract.orderedSteps
    .map(
      (step) =>
        `${step.sequence + 1}. ${step.toolName} (${step.effectKind}; ${step.settlement})`,
    )
    .join('\n');
  const examples = record.taskExamples.map((example) => `- ${example}`).join('\n');
  return [
    '### Receipt-backed procedure experience',
    `Scope: ${record.domainId} on ${record.environmentId}.`,
    `Evidence: ${record.evidence.runIds.length} independent finalized runs with exact code-owned receipts (confidence ${record.confidence.toFixed(3)}).`,
    examples ? `Matching past task examples:\n${examples}` : '',
    `Observed order:\n${steps}`,
    'Advisory only: derive arguments from the current request; never reuse prior request digests, resource ids, or side effects. Re-check current tool availability, permission, context, and normal approval requirements. Verify every current effect before claiming completion.',
  ]
    .filter(Boolean)
    .join('\n');
}
