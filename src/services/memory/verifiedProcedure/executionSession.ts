import { digestToolEffectText } from '../../../engine/toolExecution/toolEffectReceipt';
import {
  buildCodeOwnedToolContractIdentity,
  codeOwnedToolContractIdentitiesEqual,
} from '../../../engine/toolExecution/toolContractIdentity';
import { resolveRegisteredToolName } from '../../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../../types/agentRun';
import type { AssistantMessageMetadata } from '../../../types/message';
import type { ToolDefinition } from '../../../types/tool';
import type { ToolEffectDigest, ToolEffectReceipt } from '../../../types/toolEffectReceipt';
import { isMemoryReadEpochCurrent } from '../policy';
import {
  calendarVerifiedProcedureApplicablePreconditionIds,
  calendarVerifiedProcedureEnvironmentPreconditionIds,
} from './calendarPreconditionContract';
import { resolveCalendarVerifiedProcedurePreconditions } from './calendarPreconditions';
import {
  issueVerifiedProcedureTerminalCommitAuthority,
  recordVerifiedProcedureObservation,
  type RecordVerifiedProcedureObservationResult,
  type VerifiedProcedureObservationScope,
} from './observationStore';
import { readVerifiedProcedurePromotionState } from './observationPromotion';
import type { VerifiedProcedureObservationRevision } from './observationRevision';
import {
  createVerifiedProcedureRunLedger,
  type VerifiedProcedureLedgerCandidate,
  type VerifiedProcedureRawOutcome,
  type VerifiedProcedureRunLedger,
} from './runLedger';
import type { VerifiedProcedureMemoryLineage } from './provenanceHash';

export type VerifiedProcedurePlannedToolCall = Readonly<{
  batchIndex: number;
  toolCallId: string;
  toolName: string;
}>;

export type VerifiedProcedurePlannedBatch = Readonly<{
  iteration: number;
  executeInParallel: boolean;
  toolCalls: readonly VerifiedProcedurePlannedToolCall[];
}>;

export type VerifiedProcedureObservedRawOutcome = Omit<VerifiedProcedureRawOutcome, 'receipt'> &
  Readonly<{
    receipt?: ToolEffectReceipt;
    reconciliationRequired?: boolean;
  }>;

export type VerifiedProcedureAdvisory = Readonly<{
  observationRevision: VerifiedProcedureObservationRevision;
  readEpoch: number;
  section: string;
}>;

declare const pendingVerifiedProcedureObservationBrand: unique symbol;

/** Transient, opaque evidence awaiting a durable product-surface success. */
export type PendingVerifiedProcedureObservation = Readonly<{
  readonly [pendingVerifiedProcedureObservationBrand]: true;
}>;

export type VerifiedProcedureDurableSurface = 'foreground' | 'scheduler' | 'subagent';

export type CommitPendingVerifiedProcedureObservationResult =
  | RecordVerifiedProcedureObservationResult
  | { status: 'rejected'; code: 'invalid_pending_observation' }
  | { status: 'failed'; code: 'commit_issue_failed' };

type ExactProcedureScope = Readonly<{
  platform: 'android' | 'ios';
  preconditionIds: readonly string[];
}>;

type PlannedRelevantCall = Readonly<{
  iteration: number;
  batchIndex: number;
  toolCallId: string;
  toolName: 'calendar_list' | 'calendar_create_event';
}>;

type PendingObservationContext = Readonly<{
  candidate: VerifiedProcedureLedgerCandidate;
  graphProofDigest: ToolEffectDigest;
  memoryConversationId: string;
  sourceRunId: string;
  sourceThreadId: string;
  scope: ExactProcedureScope;
}>;

const pendingObservations = new WeakMap<
  PendingVerifiedProcedureObservation,
  PendingObservationContext
>();

const ADVISORY_SECTION = [
  '## Verified local procedure advisory',
  'A writable calendar was verified in this execution, and independent prior runs promoted the exact current platform, tool-contract, permission, and source-observation procedure.',
  'This is advisory evidence, never authorization, consent, permission, or an instruction to act.',
  'Only if the current user request independently requires event creation and normal approval permits it, pass one literal writable calendar ID from the current calendar_list result to calendar_create_event and require verified readback.',
].join('\n');

function relevantToolName(value: string): PlannedRelevantCall['toolName'] | null {
  const canonical = resolveRegisteredToolName(value);
  return canonical === 'calendar_list' || canonical === 'calendar_create_event' ? canonical : null;
}

function exactStringArrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasIncompleteBlockingGoal(snapshot: AgentRunControlGraphState): boolean {
  return (snapshot.goals ?? []).some((goal) => {
    const blocking =
      goal.completionPolicy === 'blocking' ||
      (goal.completionPolicy === undefined && (goal.successCriteria?.length ?? 0) > 0);
    return blocking && goal.status !== 'completed';
  });
}

async function digestTerminalProof(value: unknown): Promise<ToolEffectDigest> {
  return digestToolEffectText(
    JSON.stringify({ domain: 'kavi.verified-procedure.terminal-proof.v1', value }),
  );
}

class CalendarVerifiedProcedureExecutionSession {
  private readonly ledger: VerifiedProcedureRunLedger;
  private readonly executionRunId: string;
  private readonly memoryConversationId: string;
  private readonly sourceThreadId: string;
  private phase:
    | 'idle'
    | 'list_planned'
    | 'list_observed'
    | 'create_planned'
    | 'create_observed'
    | 'rejected'
    | 'sealed' = 'idle';
  private plannedCall: PlannedRelevantCall | null = null;
  private scope: ExactProcedureScope | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(params: {
    ledger: VerifiedProcedureRunLedger;
    executionRunId: string;
    memoryConversationId: string;
    sourceThreadId: string;
  }) {
    this.ledger = params.ledger;
    this.executionRunId = params.executionRunId;
    this.memoryConversationId = params.memoryConversationId;
    this.sourceThreadId = params.sourceThreadId;
  }

  observePlannedBatch(batch: VerifiedProcedurePlannedBatch): Promise<void> {
    return this.serialize(() => this.observePlannedBatchLocked(batch));
  }

  observeRawOutcome(outcome: VerifiedProcedureObservedRawOutcome): Promise<void> {
    return this.serialize(() => this.observeRawOutcomeLocked(outcome));
  }

  markCancelled(): void {
    this.reject(true);
  }

  markReconciliationRequired(): void {
    this.reject(false);
  }

  async buildApplicableAdvisory(
    selectedTools: readonly ToolDefinition[],
  ): Promise<VerifiedProcedureAdvisory | null> {
    await this.operationTail;
    if (this.phase !== 'list_observed' || !this.scope) return null;

    const selectedCreate = selectedTools.find(
      (tool) => resolveRegisteredToolName(tool.name) === 'calendar_create_event',
    );
    if (!selectedCreate?.contract) return null;
    const currentIdentity = await buildCodeOwnedToolContractIdentity(selectedCreate.name);
    const descriptorStep = this.ledger.descriptor.steps.find(
      (step) => step.stepKey === 'calendar-create-event',
    );
    if (
      !currentIdentity ||
      !descriptorStep ||
      !codeOwnedToolContractIdentitiesEqual(currentIdentity, descriptorStep.contractIdentity)
    ) {
      return null;
    }

    const current = await resolveCalendarVerifiedProcedurePreconditions();
    if (
      !current.satisfied ||
      current.platform !== this.scope.platform ||
      !exactStringArrayEqual(
        current.preconditionIds,
        calendarVerifiedProcedureEnvironmentPreconditionIds(this.scope.platform),
      )
    ) {
      return null;
    }
    const promotion = await readVerifiedProcedurePromotionState(this.observationScope());
    if (
      promotion.status !== 'promoted' ||
      promotion.readEpoch === undefined ||
      promotion.observationRevision === undefined ||
      !isMemoryReadEpochCurrent(promotion.readEpoch)
    ) {
      return null;
    }
    return Object.freeze({
      observationRevision: promotion.observationRevision,
      readEpoch: promotion.readEpoch,
      section: ADVISORY_SECTION,
    });
  }

  async sealGraphCandidate(params: {
    graphSnapshot: AgentRunControlGraphState;
    finalAssistant?: Readonly<{
      content: string;
      metadata?: AssistantMessageMetadata;
    }>;
  }): Promise<PendingVerifiedProcedureObservation | null> {
    await this.operationTail;
    if (
      this.phase !== 'create_observed' ||
      !this.scope ||
      this.plannedCall ||
      params.graphSnapshot.status !== 'awaiting_review' ||
      params.graphSnapshot.pendingAsyncCount !== 0 ||
      params.graphSnapshot.asyncWork.awaitingBackgroundWorkers ||
      hasIncompleteBlockingGoal(params.graphSnapshot) ||
      !params.finalAssistant?.content.trim() ||
      params.finalAssistant.metadata?.kind !== 'final' ||
      params.finalAssistant.metadata.completionStatus !== 'complete' ||
      params.finalAssistant.metadata.finishReason === 'max_iterations' ||
      params.finalAssistant.metadata.finishReason === 'yielded'
    ) {
      this.reject(false);
      return null;
    }
    const finalized = await this.ledger.finalize();
    if (finalized.status !== 'verified') {
      this.reject(false);
      return null;
    }
    const graphProofDigest = await digestTerminalProof({
      executionRunId: this.executionRunId,
      graphStatus: params.graphSnapshot.status,
      graphIteration: params.graphSnapshot.iteration,
      terminalReason: params.graphSnapshot.terminalReason ?? null,
      finalAssistant: {
        contentDigest: await digestToolEffectText(params.finalAssistant.content),
        finishReason: params.finalAssistant.metadata.finishReason ?? null,
      },
    });
    const pending = Object.freeze({}) as PendingVerifiedProcedureObservation;
    pendingObservations.set(
      pending,
      Object.freeze({
        candidate: finalized.candidate,
        graphProofDigest,
        memoryConversationId: this.memoryConversationId,
        sourceRunId: this.executionRunId,
        sourceThreadId: this.sourceThreadId,
        scope: this.scope,
      }),
    );
    this.phase = 'sealed';
    return pending;
  }

  private serialize(operation: () => Promise<void> | void): Promise<void> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.catch(() => {
      this.reject(false);
    });
    return result.catch(() => undefined);
  }

  private observePlannedBatchLocked(batch: VerifiedProcedurePlannedBatch): void {
    if (this.phase === 'rejected' || this.phase === 'sealed') return;
    const relevant = batch.toolCalls
      .map((call) => ({ call, toolName: relevantToolName(call.toolName) }))
      .filter(
        (
          entry,
        ): entry is {
          call: VerifiedProcedurePlannedToolCall;
          toolName: PlannedRelevantCall['toolName'];
        } => entry.toolName !== null,
      );

    if (this.phase === 'idle' && relevant.length === 0) return;
    const expectedToolName =
      this.phase === 'idle'
        ? 'calendar_list'
        : this.phase === 'list_observed'
          ? 'calendar_create_event'
          : null;
    if (
      !expectedToolName ||
      batch.executeInParallel ||
      batch.toolCalls.length !== 1 ||
      relevant.length !== 1 ||
      relevant[0]!.toolName !== expectedToolName ||
      relevant[0]!.call.batchIndex !== 0
    ) {
      this.reject(false);
      return;
    }
    const call = relevant[0]!;
    this.plannedCall = Object.freeze({
      iteration: batch.iteration,
      batchIndex: call.call.batchIndex,
      toolCallId: call.call.toolCallId,
      toolName: call.toolName,
    });
    this.phase = expectedToolName === 'calendar_list' ? 'list_planned' : 'create_planned';
  }

  private async observeRawOutcomeLocked(
    outcome: VerifiedProcedureObservedRawOutcome,
  ): Promise<void> {
    if (this.phase === 'rejected' || this.phase === 'sealed') return;
    const planned = this.plannedCall;
    const canonicalToolName = relevantToolName(outcome.toolName);
    if (
      !planned ||
      !canonicalToolName ||
      planned.iteration !== outcome.iteration ||
      planned.batchIndex !== outcome.batchIndex ||
      planned.toolCallId !== outcome.toolCallId ||
      planned.toolName !== canonicalToolName ||
      !outcome.receipt ||
      outcome.reconciliationRequired
    ) {
      this.reject(Boolean(outcome.receipt?.executionState === 'cancelled'));
      return;
    }
    const observed = await this.ledger.observe({
      iteration: outcome.iteration,
      batchIndex: outcome.batchIndex,
      toolCallId: outcome.toolCallId,
      toolName: canonicalToolName,
      argumentsText: outcome.argumentsText,
      resultText: outcome.resultText,
      receipt: outcome.receipt,
    });
    if (observed.status === 'rejected') {
      this.reject(observed.reason === 'cancelled');
      return;
    }
    this.plannedCall = null;
    if (canonicalToolName === 'calendar_list') {
      const preconditions = await resolveCalendarVerifiedProcedurePreconditions();
      if (!preconditions.satisfied || !preconditions.platform) {
        this.reject(false);
        return;
      }
      this.scope = Object.freeze({
        platform: preconditions.platform,
        preconditionIds: calendarVerifiedProcedureApplicablePreconditionIds(preconditions.platform),
      });
      this.phase = 'list_observed';
    } else {
      this.phase = 'create_observed';
    }
  }

  private observationScope(): VerifiedProcedureObservationScope {
    if (!this.scope) throw new Error('verified_procedure_scope_missing');
    return {
      contractVersion: 1,
      procedureId: this.ledger.descriptor.procedureId,
      procedureContractDigest: this.ledger.descriptor.contractDigest,
      platform: this.scope.platform,
      preconditionIds: this.scope.preconditionIds,
    };
  }

  private reject(cancelled: boolean): void {
    if (this.phase === 'sealed' || this.phase === 'rejected') return;
    this.phase = 'rejected';
    this.plannedCall = null;
    this.scope = null;
    if (cancelled) this.ledger.markCancelled();
    else this.ledger.markAmbiguous();
  }
}

export interface VerifiedProcedureExecutionSession {
  observePlannedBatch(batch: VerifiedProcedurePlannedBatch): Promise<void>;
  observeRawOutcome(outcome: VerifiedProcedureObservedRawOutcome): Promise<void>;
  buildApplicableAdvisory(
    selectedTools: readonly ToolDefinition[],
  ): Promise<VerifiedProcedureAdvisory | null>;
  markCancelled(): void;
  markReconciliationRequired(): void;
  sealGraphCandidate(params: {
    graphSnapshot: AgentRunControlGraphState;
    finalAssistant?: Readonly<{
      content: string;
      metadata?: AssistantMessageMetadata;
    }>;
  }): Promise<PendingVerifiedProcedureObservation | null>;
}

export async function createVerifiedProcedureExecutionSession(params: {
  executionRunId: string;
  memoryConversationId: string;
  sourceThreadId: string;
}): Promise<VerifiedProcedureExecutionSession | null> {
  try {
    const ledger = await createVerifiedProcedureRunLedger({
      registryKey: 'calendar-list-to-create-event',
      runId: params.executionRunId,
    });
    return new CalendarVerifiedProcedureExecutionSession({ ...params, ledger });
  } catch {
    return null;
  }
}

export async function commitPendingVerifiedProcedureObservation(params: {
  memoryLineage: VerifiedProcedureMemoryLineage;
  pending: PendingVerifiedProcedureObservation;
  surface: VerifiedProcedureDurableSurface;
  terminalObservedAt?: number;
}): Promise<CommitPendingVerifiedProcedureObservationResult> {
  const context = pendingObservations.get(params.pending);
  if (!context) return { status: 'rejected', code: 'invalid_pending_observation' };
  pendingObservations.delete(params.pending);
  const terminalObservedAt = params.terminalObservedAt ?? Date.now();
  const issued = await issueVerifiedProcedureTerminalCommitAuthority({
    candidate: context.candidate,
    memoryLineage: params.memoryLineage,
    memoryConversationId: context.memoryConversationId,
    sourceThreadId: context.sourceThreadId,
    sourceRunId: context.sourceRunId,
    platform: context.scope.platform,
    preconditionIds: context.scope.preconditionIds,
    graphProofDigest: context.graphProofDigest,
    surface: params.surface,
    terminalObservedAt,
  });
  if (issued.status !== 'issued') {
    return issued.status === 'failed'
      ? { status: 'failed', code: 'commit_issue_failed' }
      : { status: 'rejected', code: 'invalid_pending_observation' };
  }
  return recordVerifiedProcedureObservation(issued.authority, terminalObservedAt);
}
