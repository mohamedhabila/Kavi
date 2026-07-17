import {
  digestToolEffectRequest,
  digestToolEffectText,
  verifyToolEffectReceiptIntegrity,
} from '../../../engine/toolExecution/toolEffectReceipt';
import {
  codeOwnedToolContractIdentitiesEqual,
  digestToolContractIdentity,
} from '../../../engine/toolExecution/toolContractIdentity';
import type { DurableModelEffectAuthority } from '../../../engine/authority/modelTurnMemoryPolicyBinding';
import type { ToolEffectDigest, ToolEffectReceipt } from '../../../types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../../utils/toolEffectReceipt';
import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import { canWriteLongTermMemory, getMemoryPolicyEpoch } from '../policy';
import {
  getCurrentVerifiedProcedureDescriptor,
  type VerifiedProcedureDescriptor,
  type VerifiedProcedureDescriptorKey,
  type VerifiedProcedureStepKey,
} from './descriptorRegistry';

const MAX_RAW_OUTCOME_TEXT_LENGTH = 65_536;
const MAX_RESOURCE_COUNT = 64;
const MAX_RESOURCE_ID_LENGTH = 1_024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type VerifiedProcedureRawOutcome = Readonly<{
  iteration: number;
  batchIndex: number;
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  resultText: string;
  receipt: ToolEffectReceipt;
}>;

export type VerifiedProcedureLedgerRejectionReason =
  | 'ambiguous_coordinate'
  | 'authority_revoked'
  | 'cancelled'
  | 'finalized'
  | 'invalid_linkage'
  | 'invalid_outcome'
  | 'invalid_receipt'
  | 'parallel_execution'
  | 'retry_detected'
  | 'unexpected_tool';

export type VerifiedProcedureStepEvidence = Readonly<{
  stepKey: VerifiedProcedureStepKey;
  iteration: number;
  batchIndex: number;
  receiptId: string;
  contractIdentityDigest: ToolEffectDigest;
  requestDigest: ToolEffectDigest;
  resultDigest: ToolEffectDigest;
  recordedAt: number;
}>;

export type VerifiedProcedureLedgerCandidate = Readonly<{
  contractVersion: 1;
  procedureId: string;
  procedureContractDigest: ToolEffectDigest;
  evidenceId: ToolEffectDigest;
  linkageDigest: ToolEffectDigest;
  observedAt: number;
  steps: readonly [VerifiedProcedureStepEvidence, VerifiedProcedureStepEvidence];
}>;

export type ClaimedVerifiedProcedureLedgerCandidate = Readonly<{
  candidate: VerifiedProcedureLedgerCandidate;
  modelEffectAuthorities: readonly DurableModelEffectAuthority[];
  memoryPolicyEpoch: number;
  runIdDigest: ToolEffectDigest;
}>;

export type VerifiedProcedureAuthorityGuard = () => boolean;

export type VerifiedProcedureFinalizationAuthority = Readonly<{
  isCurrent: VerifiedProcedureAuthorityGuard;
  modelEffectAuthorities: readonly DurableModelEffectAuthority[];
}>;

export type ObserveVerifiedProcedureOutcomeResult =
  | { status: 'accepted'; stepKey: VerifiedProcedureStepKey }
  | { status: 'unchanged'; stepKey: VerifiedProcedureStepKey }
  | { status: 'rejected'; reason: VerifiedProcedureLedgerRejectionReason };

export type FinalizeVerifiedProcedureLedgerResult =
  | { status: 'verified'; candidate: VerifiedProcedureLedgerCandidate }
  | { status: 'rejected'; reason: VerifiedProcedureLedgerRejectionReason };

type AcceptedStep = Readonly<{
  evidence: VerifiedProcedureStepEvidence;
  observedResourceIdHashes?: readonly ToolEffectDigest[];
  selectedResourceIdHash?: ToolEffectDigest;
}>;

const issuedLedgerCandidates = new WeakMap<
  VerifiedProcedureLedgerCandidate,
  ClaimedVerifiedProcedureLedgerCandidate
>();

/**
 * Claims one genuine candidate produced by this module. A structurally similar
 * object is never authority, and a genuine candidate can be claimed once.
 */
export function claimVerifiedProcedureLedgerCandidate(
  value: unknown,
): ClaimedVerifiedProcedureLedgerCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as VerifiedProcedureLedgerCandidate;
  const claimed = issuedLedgerCandidates.get(candidate);
  if (!claimed) return null;
  issuedLedgerCandidates.delete(candidate);
  return claimed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedLiteralId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RESOURCE_ID_LENGTH &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
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

async function digestEvidence(domain: string, value: unknown): Promise<ToolEffectDigest> {
  return digestToolEffectText(
    JSON.stringify(canonicalize({ domain: `kavi.verified-procedure.${domain}.v1`, value })),
  );
}

export async function digestVerifiedProcedureRunId(runId: string): Promise<ToolEffectDigest> {
  if (!isExactMemoryProvenanceId(runId)) {
    throw new TypeError('verified_procedure_run_id_invalid');
  }
  return digestEvidence('run-id', runId);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

async function parseWritableCalendarHashes(resultText: string): Promise<ToolEffectDigest[] | null> {
  const value = parseJson(resultText);
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESOURCE_COUNT) {
    return null;
  }
  const writableIds: string[] = [];
  for (const calendar of value) {
    if (
      !isPlainRecord(calendar) ||
      !boundedLiteralId(calendar.id) ||
      typeof calendar.allowsModifications !== 'boolean'
    ) {
      return null;
    }
    if (calendar.allowsModifications === true) writableIds.push(calendar.id);
  }
  if (writableIds.length === 0 || new Set(writableIds).size !== writableIds.length) return null;
  const hashes = await Promise.all(writableIds.map((id) => digestEvidence('calendar-link-id', id)));
  return hashes.sort();
}

async function parseCalendarEventHashes(resultText: string): Promise<ToolEffectDigest[] | null> {
  const value = parseJson(resultText);
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESOURCE_COUNT) {
    return null;
  }
  const eventIds: string[] = [];
  for (const event of value) {
    if (!isPlainRecord(event) || !boundedLiteralId(event.id)) {
      return null;
    }
    eventIds.push(event.id);
  }
  if (new Set(eventIds).size !== eventIds.length) return null;
  const hashes = await Promise.all(eventIds.map((id) => digestEvidence('calendar-event-id', id)));
  return hashes.sort();
}

async function parseCreateLinkage(params: {
  argumentsText: string;
  resultText: string;
  receipt: ToolEffectReceipt;
}): Promise<ToolEffectDigest | null> {
  const argumentsValue = parseJson(params.argumentsText);
  const resultValue = parseJson(params.resultText);
  if (!isPlainRecord(argumentsValue) || !isPlainRecord(resultValue)) return null;
  const calendarId = argumentsValue.calendarId;
  const resultCalendarId = resultValue.calendarId;
  const eventId = resultValue.eventId;
  if (
    !boundedLiteralId(calendarId) ||
    !boundedLiteralId(resultCalendarId) ||
    calendarId !== resultCalendarId ||
    resultValue.status !== 'created_verified' ||
    !boundedLiteralId(eventId) ||
    params.receipt.resource?.kind !== 'calendar_event' ||
    params.receipt.resource.id !== eventId
  ) {
    return null;
  }
  return digestEvidence('calendar-link-id', calendarId);
}

async function parseUpdateLinkage(params: {
  argumentsText: string;
  resultText: string;
  receipt: ToolEffectReceipt;
}): Promise<ToolEffectDigest | null> {
  const argumentsValue = parseJson(params.argumentsText);
  const resultValue = parseJson(params.resultText);
  if (!isPlainRecord(argumentsValue) || !isPlainRecord(resultValue)) return null;
  const eventId = argumentsValue.id;
  const resultEventId = resultValue.eventId;
  if (
    !boundedLiteralId(eventId) ||
    !boundedLiteralId(resultEventId) ||
    eventId !== resultEventId ||
    resultValue.status !== 'updated_verified' ||
    params.receipt.resource?.kind !== 'calendar_event' ||
    params.receipt.resource.id !== eventId
  ) {
    return null;
  }
  return digestEvidence('calendar-event-id', eventId);
}

async function parseSourceResourceHashes(
  stepKey: VerifiedProcedureStepKey,
  resultText: string,
): Promise<ToolEffectDigest[] | null> {
  switch (stepKey) {
    case 'calendar-list':
      return parseWritableCalendarHashes(resultText);
    case 'calendar-events':
      return parseCalendarEventHashes(resultText);
    default:
      return null;
  }
}

async function parseTargetResourceHash(params: {
  stepKey: VerifiedProcedureStepKey;
  argumentsText: string;
  resultText: string;
  receipt: ToolEffectReceipt;
}): Promise<ToolEffectDigest | null> {
  switch (params.stepKey) {
    case 'calendar-create-event':
      return parseCreateLinkage(params);
    case 'calendar-update-event':
      return parseUpdateLinkage(params);
    default:
      return null;
  }
}

function validCoordinate(input: VerifiedProcedureRawOutcome): boolean {
  return (
    Number.isSafeInteger(input.iteration) &&
    input.iteration >= 0 &&
    Number.isSafeInteger(input.batchIndex) &&
    input.batchIndex >= 0
  );
}

function expectedStep(
  descriptor: VerifiedProcedureDescriptor,
  toolName: string,
): VerifiedProcedureDescriptor['steps'][number] | undefined {
  return descriptor.steps.find((step) => step.toolName === toolName);
}

export interface VerifiedProcedureRunLedger {
  readonly descriptor: VerifiedProcedureDescriptor;
  observe(
    input: VerifiedProcedureRawOutcome,
    authorityGuard: VerifiedProcedureAuthorityGuard,
  ): Promise<ObserveVerifiedProcedureOutcomeResult>;
  markCancelled(): void;
  markAmbiguous(): void;
  finalize(
    authority: VerifiedProcedureFinalizationAuthority,
  ): Promise<FinalizeVerifiedProcedureLedgerResult>;
}

class CodeOwnedVerifiedProcedureRunLedger implements VerifiedProcedureRunLedger {
  readonly descriptor: VerifiedProcedureDescriptor;

  private readonly runIdDigest: ToolEffectDigest;
  private readonly memoryPolicyEpoch: number;
  private readonly acceptedByCoordinate = new Map<string, AcceptedStep>();
  private readonly acceptedByStep = new Map<VerifiedProcedureStepKey, AcceptedStep>();
  private readonly seenIterations = new Set<number>();
  private operationTail: Promise<void> = Promise.resolve();
  private rejectionReason: VerifiedProcedureLedgerRejectionReason | null = null;
  private rejectionGeneration = 0;
  private finalizationState: 'open' | 'finalizing' | 'issued' = 'open';

  constructor(
    descriptor: VerifiedProcedureDescriptor,
    runIdDigest: ToolEffectDigest,
    memoryPolicyEpoch: number,
  ) {
    this.descriptor = descriptor;
    this.runIdDigest = runIdDigest;
    this.memoryPolicyEpoch = memoryPolicyEpoch;
  }

  observe(
    input: VerifiedProcedureRawOutcome,
    authorityGuard: VerifiedProcedureAuthorityGuard,
  ): Promise<ObserveVerifiedProcedureOutcomeResult> {
    const operation = this.operationTail.then(() => this.observeLocked(input, authorityGuard));
    this.operationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  markCancelled(): void {
    this.reject('cancelled');
  }

  markAmbiguous(): void {
    this.reject('ambiguous_coordinate');
  }

  async finalize(
    authority: VerifiedProcedureFinalizationAuthority,
  ): Promise<FinalizeVerifiedProcedureLedgerResult> {
    await this.operationTail;
    if (this.rejectionReason) return { status: 'rejected', reason: this.rejectionReason };
    if (this.finalizationState !== 'open') return { status: 'rejected', reason: 'finalized' };
    if (!this.finalizationAuthorityCurrent(authority)) {
      return this.rejectResult('authority_revoked');
    }
    this.finalizationState = 'finalizing';
    const startingRejectionGeneration = this.rejectionGeneration;

    const source = this.acceptedByStep.get(this.descriptor.steps[0].stepKey);
    const target = this.acceptedByStep.get(this.descriptor.steps[1].stepKey);
    if (!source || !target || this.acceptedByStep.size !== this.descriptor.steps.length) {
      return this.rejectResult('invalid_outcome');
    }
    if (
      source.evidence.iteration >= target.evidence.iteration ||
      source.evidence.recordedAt > target.evidence.recordedAt ||
      !source.observedResourceIdHashes ||
      !target.selectedResourceIdHash ||
      !source.observedResourceIdHashes.includes(target.selectedResourceIdHash)
    ) {
      return this.rejectResult('invalid_linkage');
    }

    const linkageDigest = await digestEvidence('linkage-evidence', {
      procedureContractDigest: this.descriptor.contractDigest,
      sourceStepKey: this.descriptor.linkage.sourceStepKey,
      sourceResultSelector: this.descriptor.linkage.sourceResultSelector,
      targetStepKey: this.descriptor.linkage.targetStepKey,
      targetArgumentKey: this.descriptor.linkage.targetArgumentKey,
      selectedResourceIdHash: target.selectedResourceIdHash,
      observedResourceIdHashes: source.observedResourceIdHashes,
    });
    if (!this.finalizationAuthorityCurrent(authority)) {
      return this.rejectResult('authority_revoked');
    }
    const interruptedAfterLinkage = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterLinkage) return interruptedAfterLinkage;
    const steps = Object.freeze([source.evidence, target.evidence]) as unknown as readonly [
      VerifiedProcedureStepEvidence,
      VerifiedProcedureStepEvidence,
    ];
    const evidenceId = await digestEvidence('run-evidence', {
      procedureId: this.descriptor.procedureId,
      procedureContractDigest: this.descriptor.contractDigest,
      runIdDigest: this.runIdDigest,
      linkageDigest,
      steps,
    });
    if (!this.finalizationAuthorityCurrent(authority)) {
      return this.rejectResult('authority_revoked');
    }
    const interruptedAfterEvidence = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterEvidence) return interruptedAfterEvidence;
    const candidate = Object.freeze({
      contractVersion: 1 as const,
      procedureId: this.descriptor.procedureId,
      procedureContractDigest: this.descriptor.contractDigest,
      evidenceId,
      linkageDigest,
      observedAt: Math.max(source.evidence.recordedAt, target.evidence.recordedAt),
      steps,
    });
    issuedLedgerCandidates.set(
      candidate,
      Object.freeze({
        candidate,
        modelEffectAuthorities: Object.freeze([...authority.modelEffectAuthorities]),
        memoryPolicyEpoch: this.memoryPolicyEpoch,
        runIdDigest: this.runIdDigest,
      }),
    );
    this.finalizationState = 'issued';
    this.acceptedByCoordinate.clear();
    this.acceptedByStep.clear();
    this.seenIterations.clear();
    return { status: 'verified', candidate };
  }

  private async observeLocked(
    input: VerifiedProcedureRawOutcome,
    authorityGuard: VerifiedProcedureAuthorityGuard,
  ): Promise<ObserveVerifiedProcedureOutcomeResult> {
    if (this.rejectionReason) return { status: 'rejected', reason: this.rejectionReason };
    if (this.finalizationState !== 'open') return this.rejectResult('finalized');
    if (!this.authorityGuardCurrent(authorityGuard)) {
      return this.rejectResult('authority_revoked');
    }
    const startingRejectionGeneration = this.rejectionGeneration;
    if (
      !validCoordinate(input) ||
      input.argumentsText.length > MAX_RAW_OUTCOME_TEXT_LENGTH ||
      input.resultText.length > MAX_RAW_OUTCOME_TEXT_LENGTH
    ) {
      return this.rejectResult('invalid_outcome');
    }

    const receipt = decodeToolEffectReceipt(input.receipt);
    if (!receipt || receipt.contractIdentity.kind !== 'code_owned') {
      return this.rejectResult('invalid_receipt');
    }
    const [receiptRunIdDigest, receiptIntegrityValid] = await Promise.all([
      digestVerifiedProcedureRunId(receipt.executionRunId),
      verifyToolEffectReceiptIntegrity(receipt),
    ]);
    if (!this.authorityGuardCurrent(authorityGuard)) {
      return this.rejectResult('authority_revoked');
    }
    const interruptedAfterReceipt = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterReceipt) return interruptedAfterReceipt;
    if (
      receipt.toolCallId !== input.toolCallId ||
      receipt.toolName !== input.toolName ||
      receiptRunIdDigest !== this.runIdDigest ||
      !receiptIntegrityValid
    ) {
      return this.rejectResult('invalid_receipt');
    }
    const step = expectedStep(this.descriptor, input.toolName);
    if (!step) return this.rejectResult('unexpected_tool');
    if (!codeOwnedToolContractIdentitiesEqual(step.contractIdentity, receipt.contractIdentity)) {
      return this.rejectResult('invalid_receipt');
    }

    const [requestDigest, resultDigest, contractIdentityDigest] = await Promise.all([
      digestToolEffectRequest(input.argumentsText),
      digestToolEffectText(input.resultText),
      digestToolContractIdentity(receipt.contractIdentity),
    ]);
    if (!this.authorityGuardCurrent(authorityGuard)) {
      return this.rejectResult('authority_revoked');
    }
    const interruptedAfterDigests = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterDigests) return interruptedAfterDigests;
    if (requestDigest !== receipt.requestDigest || resultDigest !== receipt.resultDigest) {
      return this.rejectResult('invalid_receipt');
    }
    if (receipt.effectState === 'cancelled' || receipt.executionState === 'cancelled') {
      return this.rejectResult('cancelled');
    }

    const evidence = Object.freeze({
      stepKey: step.stepKey,
      iteration: input.iteration,
      batchIndex: input.batchIndex,
      receiptId: receipt.receiptId,
      contractIdentityDigest,
      requestDigest,
      resultDigest,
      recordedAt: receipt.recordedAt,
    });
    let accepted: AcceptedStep;
    const sourceStep = step.stepKey === this.descriptor.steps[0].stepKey;
    if (sourceStep) {
      if (
        receipt.transportState !== 'returned' ||
        receipt.effectKind !== 'observation.read' ||
        receipt.effectState !== 'none' ||
        receipt.verificationState !== 'not_applicable'
      ) {
        return this.rejectResult('invalid_outcome');
      }
      const observedResourceIdHashes = await parseSourceResourceHashes(
        step.stepKey,
        input.resultText,
      );
      if (!this.authorityGuardCurrent(authorityGuard)) {
        return this.rejectResult('authority_revoked');
      }
      const interruptedAfterSource = this.interruptionSince(startingRejectionGeneration);
      if (interruptedAfterSource) return interruptedAfterSource;
      if (!observedResourceIdHashes) return this.rejectResult('invalid_outcome');
      accepted = Object.freeze({
        evidence,
        observedResourceIdHashes,
      });
    } else {
      if (
        receipt.transportState !== 'returned' ||
        receipt.effectKind !== this.descriptor.verifier.receiptEffectKind ||
        receipt.effectState !== this.descriptor.verifier.receiptEffectState ||
        receipt.verificationState !== this.descriptor.verifier.receiptVerificationState
      ) {
        return this.rejectResult('invalid_outcome');
      }
      const selectedResourceIdHash = await parseTargetResourceHash({
        stepKey: step.stepKey,
        argumentsText: input.argumentsText,
        resultText: input.resultText,
        receipt,
      });
      if (!this.authorityGuardCurrent(authorityGuard)) {
        return this.rejectResult('authority_revoked');
      }
      const interruptedAfterTarget = this.interruptionSince(startingRejectionGeneration);
      if (interruptedAfterTarget) return interruptedAfterTarget;
      if (!selectedResourceIdHash) return this.rejectResult('invalid_linkage');
      accepted = Object.freeze({
        evidence,
        selectedResourceIdHash,
      });
    }

    const coordinate = `${input.iteration}:${input.batchIndex}`;
    const existingCoordinate = this.acceptedByCoordinate.get(coordinate);
    if (existingCoordinate) {
      if (existingCoordinate.evidence.receiptId === receipt.receiptId) {
        return { status: 'unchanged', stepKey: step.stepKey };
      }
      return this.rejectResult('ambiguous_coordinate');
    }
    if (this.seenIterations.has(input.iteration) || input.batchIndex !== 0) {
      return this.rejectResult('parallel_execution');
    }
    if (this.acceptedByStep.has(step.stepKey)) return this.rejectResult('retry_detected');
    const interruptedBeforeAcceptance = this.interruptionSince(startingRejectionGeneration);
    if (interruptedBeforeAcceptance) return interruptedBeforeAcceptance;
    if (!this.authorityGuardCurrent(authorityGuard)) {
      return this.rejectResult('authority_revoked');
    }

    this.acceptedByCoordinate.set(coordinate, accepted);
    this.acceptedByStep.set(step.stepKey, accepted);
    this.seenIterations.add(input.iteration);
    return { status: 'accepted', stepKey: step.stepKey };
  }

  private authorityGuardCurrent(authorityGuard: VerifiedProcedureAuthorityGuard): boolean {
    try {
      return authorityGuard() === true;
    } catch {
      return false;
    }
  }

  private finalizationAuthorityCurrent(authority: VerifiedProcedureFinalizationAuthority): boolean {
    return (
      Array.isArray(authority.modelEffectAuthorities) &&
      authority.modelEffectAuthorities.length > 0 &&
      authority.modelEffectAuthorities.every((candidate) => candidate.kind === 'memory_epoch') &&
      this.authorityGuardCurrent(authority.isCurrent)
    );
  }

  private reject(reason: VerifiedProcedureLedgerRejectionReason): void {
    if (!this.rejectionReason && this.finalizationState !== 'issued') {
      this.rejectionReason = reason;
      this.rejectionGeneration += 1;
    }
  }

  private interruptionSince(
    startingGeneration: number,
  ): { status: 'rejected'; reason: VerifiedProcedureLedgerRejectionReason } | null {
    if (this.rejectionReason === null && this.rejectionGeneration === startingGeneration) {
      return null;
    }
    return {
      status: 'rejected',
      reason: this.rejectionReason ?? 'ambiguous_coordinate',
    };
  }

  private rejectResult(reason: VerifiedProcedureLedgerRejectionReason): {
    status: 'rejected';
    reason: VerifiedProcedureLedgerRejectionReason;
  } {
    this.reject(reason);
    return { status: 'rejected', reason: this.rejectionReason ?? reason };
  }
}

export async function createVerifiedProcedureRunLedger(params: {
  registryKey: VerifiedProcedureDescriptorKey;
  runId: string;
}): Promise<VerifiedProcedureRunLedger> {
  if (!isExactMemoryProvenanceId(params.runId)) {
    throw new TypeError('verified_procedure_run_id_invalid');
  }
  if (!canWriteLongTermMemory()) {
    throw new Error('verified_procedure_memory_disabled');
  }
  const memoryPolicyEpoch = getMemoryPolicyEpoch();
  const [descriptor, runIdDigest] = await Promise.all([
    getCurrentVerifiedProcedureDescriptor(params.registryKey),
    digestVerifiedProcedureRunId(params.runId),
  ]);
  return new CodeOwnedVerifiedProcedureRunLedger(descriptor, runIdDigest, memoryPolicyEpoch);
}
