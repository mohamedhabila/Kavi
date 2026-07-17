import { digestToolEffectText } from '../../../engine/toolExecution/toolEffectReceipt';
import {
  buildDurableModelEffectAuthority,
  isModelTurnMemoryPolicyBindingDurablyCurrent,
  type ModelTurnMemoryPolicyBinding,
} from '../../../engine/authority/modelTurnMemoryPolicyBinding';
import {
  buildCodeOwnedToolContractIdentity,
  codeOwnedToolContractIdentitiesEqual,
} from '../../../engine/toolExecution/toolContractIdentity';
import { resolveRegisteredToolName } from '../../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../../types/agentRun';
import type { AssistantMessageMetadata } from '../../../types/message';
import type { ToolDefinition } from '../../../types/tool';
import type { ToolEffectDigest, ToolEffectReceipt } from '../../../types/toolEffectReceipt';
import { isDeliverableAssistantCompletionMetadata } from '../../../utils/assistantMessageMetadata';
import { isMemoryReadEpochCurrent } from '../policy';
import {
  issueVerifiedProcedureTerminalCommitAuthority,
  recordVerifiedProcedureObservation,
  type RecordVerifiedProcedureObservationResult,
  type VerifiedProcedureObservationScope,
} from './observationStore';
import { readVerifiedProcedurePromotionState } from './observationPromotion';
import type { VerifiedProcedureAuthoritySnapshot } from './observationAuthority';
import {
  createVerifiedProcedureRunLedger,
  type VerifiedProcedureLedgerCandidate,
  type VerifiedProcedureRawOutcome,
  type VerifiedProcedureRunLedger,
} from './runLedger';
import type { VerifiedProcedureMemoryLineage } from './provenanceHash';
import {
  bindVerifiedProcedureOriginAuthority,
  digestTerminalProof,
  exactStringArrayEqual,
  hasIncompleteBlockingGoal,
  relevantToolName,
  VERIFIED_PROCEDURE_BEHAVIORS,
  type VerifiedProcedureBehavior,
} from './executionSessionSupport';

export type VerifiedProcedurePlannedToolCall = Readonly<{
  batchIndex: number;
  toolCallId: string;
  toolName: string;
}>;

export type VerifiedProcedurePlannedBatch = Readonly<{
  iteration: number;
  executeInParallel: boolean;
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  toolCalls: readonly VerifiedProcedurePlannedToolCall[];
}>;

export type VerifiedProcedureObservedRawOutcome = Omit<VerifiedProcedureRawOutcome, 'receipt'> &
  Readonly<{
    receipt?: ToolEffectReceipt;
    reconciliationRequired?: boolean;
  }>;

export type VerifiedProcedureAdvisory = Readonly<{
  authoritySnapshot: VerifiedProcedureAuthoritySnapshot;
  readEpoch: number;
  validUntil: number;
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
  | {
      status: 'rejected';
      code: 'invalid_pending_observation' | 'memory_authority_changed';
    }
  | { status: 'failed'; code: 'commit_issue_failed' };

type ExactProcedureScope = Readonly<{
  platform: 'android' | 'ios';
  preconditionIds: readonly string[];
}>;

type PlannedRelevantCall = Readonly<{
  iteration: number;
  batchIndex: number;
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  toolCallId: string;
  toolName: string;
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

class TwoStepVerifiedProcedureExecutionSession {
  private readonly ledger: VerifiedProcedureRunLedger;
  private readonly behavior: VerifiedProcedureBehavior;
  private readonly executionRunId: string;
  private readonly memoryConversationId: string;
  private readonly sourceThreadId: string;
  private phase:
    | 'idle'
    | 'source_planned'
    | 'source_observed'
    | 'target_planned'
    | 'target_observed'
    | 'rejected'
    | 'sealed' = 'idle';
  private plannedCall: PlannedRelevantCall | null = null;
  private originatingMemoryPolicyBindings: ModelTurnMemoryPolicyBinding[] = [];
  private scope: ExactProcedureScope | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(params: {
    ledger: VerifiedProcedureRunLedger;
    behavior: VerifiedProcedureBehavior;
    executionRunId: string;
    memoryConversationId: string;
    sourceThreadId: string;
  }) {
    this.ledger = params.ledger;
    this.behavior = params.behavior;
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
    const planningPhase = this.phase === 'idle';
    const sourceObservedPhase = this.phase === 'source_observed' && this.scope !== null;
    if (!planningPhase && !sourceObservedPhase) return null;
    if (sourceObservedPhase && !this.originatingAuthorityCurrent()) {
      this.reject(false);
      return null;
    }

    const requiredSteps = planningPhase
      ? this.ledger.descriptor.steps
      : ([this.ledger.descriptor.steps[1]] as const);
    const selectedSteps = requiredSteps.map((descriptorStep) => {
      const selectedTool = selectedTools.find(
        (tool) => resolveRegisteredToolName(tool.name) === descriptorStep.toolName,
      );
      return { descriptorStep, selectedTool };
    });
    if (
      selectedSteps.some(
        ({ descriptorStep, selectedTool }) => !descriptorStep || !selectedTool?.contract,
      )
    ) {
      return null;
    }
    const currentIdentities = await Promise.all(
      selectedSteps.map(({ selectedTool }) =>
        buildCodeOwnedToolContractIdentity(selectedTool!.name),
      ),
    );
    if (sourceObservedPhase && !this.originatingAuthorityCurrent()) {
      this.reject(false);
      return null;
    }
    if (
      currentIdentities.some(
        (identity, index) =>
          !identity ||
          !codeOwnedToolContractIdentitiesEqual(
            identity,
            selectedSteps[index]!.descriptorStep!.contractIdentity,
          ),
      )
    ) {
      return null;
    }

    const current = await this.behavior.resolvePreconditions();
    if (sourceObservedPhase && !this.originatingAuthorityCurrent()) {
      this.reject(false);
      return null;
    }
    const expectedEnvironmentPreconditions = current.platform
      ? this.behavior.environmentPreconditionIds(current.platform)
      : [];
    if (
      !current.satisfied ||
      !current.platform ||
      !exactStringArrayEqual(current.preconditionIds, expectedEnvironmentPreconditions)
    ) {
      return null;
    }
    const observationScope: VerifiedProcedureObservationScope = planningPhase
      ? {
          contractVersion: 1,
          procedureId: this.ledger.descriptor.procedureId,
          procedureContractDigest: this.ledger.descriptor.contractDigest,
          platform: current.platform,
          preconditionIds: this.behavior.applicablePreconditionIds(current.platform),
        }
      : this.observationScope();
    if (
      sourceObservedPhase &&
      (current.platform !== this.scope!.platform ||
        !exactStringArrayEqual(
          this.scope!.preconditionIds,
          this.behavior.applicablePreconditionIds(current.platform),
        ))
    ) {
      return null;
    }
    const promotion = await readVerifiedProcedurePromotionState(observationScope);
    if (sourceObservedPhase && !this.originatingAuthorityCurrent()) {
      this.reject(false);
      return null;
    }
    if (
      promotion.status !== 'promoted' ||
      promotion.readEpoch === undefined ||
      promotion.authoritySnapshot === undefined ||
      promotion.validUntil === undefined ||
      !isMemoryReadEpochCurrent(promotion.readEpoch)
    ) {
      return null;
    }
    return Object.freeze({
      authoritySnapshot: promotion.authoritySnapshot,
      readEpoch: promotion.readEpoch,
      validUntil: promotion.validUntil,
      section: planningPhase
        ? this.behavior.planningAdvisorySection
        : this.behavior.observedSourceAdvisorySection,
    });
  }

  async isReadyToSeal(): Promise<boolean> {
    await this.operationTail;
    return this.phase === 'target_observed';
  }

  async sealGraphCandidate(params: {
    graphSnapshot: AgentRunControlGraphState;
    finalAssistant?: Readonly<{
      content: string;
      metadata?: AssistantMessageMetadata;
    }>;
  }): Promise<PendingVerifiedProcedureObservation | null> {
    await this.operationTail;
    if (!this.originatingAuthorityCurrent()) {
      this.reject(false);
      return null;
    }
    if (
      this.phase !== 'target_observed' ||
      !this.scope ||
      this.plannedCall ||
      params.graphSnapshot.status !== 'awaiting_review' ||
      params.graphSnapshot.pendingAsyncCount !== 0 ||
      params.graphSnapshot.asyncWork.awaitingBackgroundWorkers ||
      hasIncompleteBlockingGoal(params.graphSnapshot) ||
      !params.finalAssistant?.content.trim() ||
      !isDeliverableAssistantCompletionMetadata(params.finalAssistant.metadata)
    ) {
      this.reject(false);
      return null;
    }
    const originatingMemoryPolicyBindings = Object.freeze([
      ...this.originatingMemoryPolicyBindings,
    ]);
    const authorityGuard = () =>
      originatingMemoryPolicyBindings.every((binding) =>
        isModelTurnMemoryPolicyBindingDurablyCurrent(binding),
      );
    const finalized = await this.ledger.finalize({
      isCurrent: authorityGuard,
      modelEffectAuthorities: Object.freeze(
        originatingMemoryPolicyBindings.map(buildDurableModelEffectAuthority),
      ),
    });
    if (!authorityGuard()) {
      this.reject(false);
      return null;
    }
    if (finalized.status !== 'verified') {
      this.reject(false);
      return null;
    }
    const finalContentDigest = await digestToolEffectText(params.finalAssistant.content);
    if (!authorityGuard()) {
      this.reject(false);
      return null;
    }
    const graphProofDigest = await digestTerminalProof({
      executionRunId: this.executionRunId,
      graphStatus: params.graphSnapshot.status,
      graphIteration: params.graphSnapshot.iteration,
      terminalReason: params.graphSnapshot.terminalReason ?? null,
      finalAssistant: {
        contentDigest: finalContentDigest,
        finishReason: params.finalAssistant.metadata.finishReason ?? null,
      },
    });
    if (!authorityGuard()) {
      this.reject(false);
      return null;
    }
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
      .map((call) => ({
        call,
        toolName: relevantToolName(this.ledger.descriptor, call.toolName),
      }))
      .filter(
        (
          entry,
        ): entry is {
          call: VerifiedProcedurePlannedToolCall;
          toolName: PlannedRelevantCall['toolName'];
        } => entry.toolName !== null,
      );

    if (this.phase === 'idle' && relevant.length === 0) return;
    const originatingBinding = bindVerifiedProcedureOriginAuthority(batch.memoryPolicyBinding);
    if (
      !originatingBinding ||
      !isModelTurnMemoryPolicyBindingDurablyCurrent(originatingBinding) ||
      !this.originatingAuthorityCurrent(originatingBinding)
    ) {
      this.reject(false);
      return;
    }
    const expectedToolName =
      this.phase === 'idle'
        ? this.ledger.descriptor.steps[0].toolName
        : this.phase === 'source_observed'
          ? this.ledger.descriptor.steps[1].toolName
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
      memoryPolicyBinding: originatingBinding,
      toolCallId: call.call.toolCallId,
      toolName: call.toolName,
    });
    this.phase =
      expectedToolName === this.ledger.descriptor.steps[0].toolName
        ? 'source_planned'
        : 'target_planned';
  }

  private async observeRawOutcomeLocked(
    outcome: VerifiedProcedureObservedRawOutcome,
  ): Promise<void> {
    if (this.phase === 'rejected' || this.phase === 'sealed') return;
    const planned = this.plannedCall;
    const authorityGuard = () => this.originatingAuthorityCurrent(planned?.memoryPolicyBinding);
    if (!authorityGuard()) {
      this.reject(false);
      return;
    }
    const canonicalToolName = relevantToolName(this.ledger.descriptor, outcome.toolName);
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
    const observed = await this.ledger.observe(
      {
        iteration: outcome.iteration,
        batchIndex: outcome.batchIndex,
        toolCallId: outcome.toolCallId,
        toolName: canonicalToolName,
        argumentsText: outcome.argumentsText,
        resultText: outcome.resultText,
        receipt: outcome.receipt,
      },
      authorityGuard,
    );
    if (!authorityGuard()) {
      this.reject(false);
      return;
    }
    if (observed.status === 'rejected') {
      this.reject(observed.reason === 'cancelled');
      return;
    }
    this.plannedCall = null;
    if (canonicalToolName === this.ledger.descriptor.steps[0].toolName) {
      const preconditions = await this.behavior.resolvePreconditions();
      if (!authorityGuard()) {
        this.reject(false);
        return;
      }
      if (!preconditions.satisfied || !preconditions.platform) {
        this.reject(false);
        return;
      }
      this.scope = Object.freeze({
        platform: preconditions.platform,
        preconditionIds: this.behavior.applicablePreconditionIds(preconditions.platform),
      });
      this.originatingMemoryPolicyBindings.push(planned.memoryPolicyBinding);
      this.phase = 'source_observed';
    } else {
      this.originatingMemoryPolicyBindings.push(planned.memoryPolicyBinding);
      this.phase = 'target_observed';
    }
  }

  private originatingAuthorityCurrent(additionalBinding?: ModelTurnMemoryPolicyBinding): boolean {
    const bindings = additionalBinding
      ? [...this.originatingMemoryPolicyBindings, additionalBinding]
      : this.plannedCall
        ? [...this.originatingMemoryPolicyBindings, this.plannedCall.memoryPolicyBinding]
        : this.originatingMemoryPolicyBindings;
    return (
      bindings.length > 0 &&
      bindings.every((binding) => isModelTurnMemoryPolicyBindingDurablyCurrent(binding))
    );
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
    this.originatingMemoryPolicyBindings = [];
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

class CompositeVerifiedProcedureExecutionSession implements VerifiedProcedureExecutionSession {
  private readonly sessions: readonly TwoStepVerifiedProcedureExecutionSession[];

  constructor(sessions: readonly TwoStepVerifiedProcedureExecutionSession[]) {
    this.sessions = Object.freeze([...sessions]);
  }

  async observePlannedBatch(batch: VerifiedProcedurePlannedBatch): Promise<void> {
    await Promise.all(this.sessions.map((session) => session.observePlannedBatch(batch)));
  }

  async observeRawOutcome(outcome: VerifiedProcedureObservedRawOutcome): Promise<void> {
    await Promise.all(this.sessions.map((session) => session.observeRawOutcome(outcome)));
  }

  async buildApplicableAdvisory(
    selectedTools: readonly ToolDefinition[],
  ): Promise<VerifiedProcedureAdvisory | null> {
    const advisories = (
      await Promise.all(
        this.sessions.map((session) => session.buildApplicableAdvisory(selectedTools)),
      )
    ).filter((advisory): advisory is VerifiedProcedureAdvisory => advisory !== null);

    // Multiple exact procedures on one model turn would be ambiguous guidance.
    // Let the normal planner proceed without learned advice instead.
    return advisories.length === 1 ? advisories[0]! : null;
  }

  markCancelled(): void {
    for (const session of this.sessions) session.markCancelled();
  }

  markReconciliationRequired(): void {
    for (const session of this.sessions) session.markReconciliationRequired();
  }

  async sealGraphCandidate(params: {
    graphSnapshot: AgentRunControlGraphState;
    finalAssistant?: Readonly<{
      content: string;
      metadata?: AssistantMessageMetadata;
    }>;
  }): Promise<PendingVerifiedProcedureObservation | null> {
    const readiness = await Promise.all(this.sessions.map((session) => session.isReadyToSeal()));
    const readySessions = this.sessions.filter((_, index) => readiness[index] === true);
    if (readySessions.length !== 1) {
      if (readySessions.length > 1) this.markReconciliationRequired();
      return null;
    }
    return readySessions[0]!.sealGraphCandidate(params);
  }
}

export async function createVerifiedProcedureExecutionSession(params: {
  executionRunId: string;
  memoryConversationId: string;
  sourceThreadId: string;
}): Promise<VerifiedProcedureExecutionSession | null> {
  try {
    const sessions = await Promise.all(
      VERIFIED_PROCEDURE_BEHAVIORS.map(async (behavior) => {
        const ledger = await createVerifiedProcedureRunLedger({
          registryKey: behavior.registryKey,
          runId: params.executionRunId,
        });
        return new TwoStepVerifiedProcedureExecutionSession({
          ...params,
          behavior,
          ledger,
        });
      }),
    );
    return new CompositeVerifiedProcedureExecutionSession(sessions);
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
      : issued.code === 'memory_authority_changed'
        ? { status: 'rejected', code: 'memory_authority_changed' }
        : { status: 'rejected', code: 'invalid_pending_observation' };
  }
  return recordVerifiedProcedureObservation(issued.authority, terminalObservedAt);
}
