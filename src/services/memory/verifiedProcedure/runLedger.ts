import {
  digestToolEffectRequest,
  digestToolEffectText,
  verifyToolEffectReceiptIntegrity,
} from '../../../engine/toolExecution/toolEffectReceipt';
import {
  codeOwnedToolContractIdentitiesEqual,
  digestToolContractIdentity,
} from '../../../engine/toolExecution/toolContractIdentity';
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
const MAX_CALENDAR_COUNT = 64;
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
  memoryPolicyEpoch: number;
  runIdDigest: ToolEffectDigest;
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
  writableCalendarIdHashes?: readonly ToolEffectDigest[];
  selectedCalendarIdHash?: ToolEffectDigest;
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
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CALENDAR_COUNT) {
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
  observe(input: VerifiedProcedureRawOutcome): Promise<ObserveVerifiedProcedureOutcomeResult>;
  markCancelled(): void;
  markAmbiguous(): void;
  finalize(): Promise<FinalizeVerifiedProcedureLedgerResult>;
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

  observe(input: VerifiedProcedureRawOutcome): Promise<ObserveVerifiedProcedureOutcomeResult> {
    const operation = this.operationTail.then(() => this.observeLocked(input));
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

  async finalize(): Promise<FinalizeVerifiedProcedureLedgerResult> {
    await this.operationTail;
    if (this.rejectionReason) return { status: 'rejected', reason: this.rejectionReason };
    if (this.finalizationState !== 'open') return { status: 'rejected', reason: 'finalized' };
    this.finalizationState = 'finalizing';
    const startingRejectionGeneration = this.rejectionGeneration;

    const list = this.acceptedByStep.get('calendar-list');
    const create = this.acceptedByStep.get('calendar-create-event');
    if (!list || !create || this.acceptedByStep.size !== this.descriptor.steps.length) {
      return this.rejectResult('invalid_outcome');
    }
    if (
      list.evidence.iteration >= create.evidence.iteration ||
      list.evidence.recordedAt > create.evidence.recordedAt ||
      !list.writableCalendarIdHashes ||
      !create.selectedCalendarIdHash ||
      !list.writableCalendarIdHashes.includes(create.selectedCalendarIdHash)
    ) {
      return this.rejectResult('invalid_linkage');
    }

    const linkageDigest = await digestEvidence('linkage-evidence', {
      procedureContractDigest: this.descriptor.contractDigest,
      selectedCalendarIdHash: create.selectedCalendarIdHash,
      writableCalendarIdHashes: list.writableCalendarIdHashes,
    });
    const interruptedAfterLinkage = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterLinkage) return interruptedAfterLinkage;
    const steps = Object.freeze([list.evidence, create.evidence]) as unknown as readonly [
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
    const interruptedAfterEvidence = this.interruptionSince(startingRejectionGeneration);
    if (interruptedAfterEvidence) return interruptedAfterEvidence;
    const candidate = Object.freeze({
      contractVersion: 1 as const,
      procedureId: this.descriptor.procedureId,
      procedureContractDigest: this.descriptor.contractDigest,
      evidenceId,
      linkageDigest,
      observedAt: Math.max(list.evidence.recordedAt, create.evidence.recordedAt),
      steps,
    });
    issuedLedgerCandidates.set(
      candidate,
      Object.freeze({
        candidate,
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
  ): Promise<ObserveVerifiedProcedureOutcomeResult> {
    if (this.rejectionReason) return { status: 'rejected', reason: this.rejectionReason };
    if (this.finalizationState !== 'open') return this.rejectResult('finalized');
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
    if (step.stepKey === 'calendar-list') {
      if (
        receipt.transportState !== 'returned' ||
        receipt.effectKind !== 'observation.read' ||
        receipt.effectState !== 'none' ||
        receipt.verificationState !== 'not_applicable'
      ) {
        return this.rejectResult('invalid_outcome');
      }
      const writableCalendarIdHashes = await parseWritableCalendarHashes(input.resultText);
      const interruptedAfterList = this.interruptionSince(startingRejectionGeneration);
      if (interruptedAfterList) return interruptedAfterList;
      if (!writableCalendarIdHashes) return this.rejectResult('invalid_outcome');
      accepted = Object.freeze({
        evidence,
        writableCalendarIdHashes,
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
      const selectedCalendarIdHash = await parseCreateLinkage({
        argumentsText: input.argumentsText,
        resultText: input.resultText,
        receipt,
      });
      const interruptedAfterCreate = this.interruptionSince(startingRejectionGeneration);
      if (interruptedAfterCreate) return interruptedAfterCreate;
      if (!selectedCalendarIdHash) return this.rejectResult('invalid_linkage');
      accepted = Object.freeze({
        evidence,
        selectedCalendarIdHash,
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

    this.acceptedByCoordinate.set(coordinate, accepted);
    this.acceptedByStep.set(step.stepKey, accepted);
    this.seenIterations.add(input.iteration);
    return { status: 'accepted', stepKey: step.stepKey };
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
