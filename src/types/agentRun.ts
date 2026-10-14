import type { RequestUnderstandingSnapshot } from './requestUnderstanding';
import type { WorkflowTaskAnchor } from './workflowTaskAnchor';
import type { ToolEffectDigest } from './toolEffectReceipt';

export type AgentRunTaskOwner = 'supervisor' | 'worker' | 'either';

export type AgentRunTaskStatus = 'done' | 'active' | 'pending';

/** One step of a worker's progress, as the plan it keeps with update_plan states it. */
export interface AgentRunTaskLedgerItem {
  id: string;
  title: string;
  status: AgentRunTaskStatus;
  owner: AgentRunTaskOwner;
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunTerminalReason =
  | 'loop_detected'
  | 'terminal_blocked'
  | 'tool_failure'
  | 'user_cancelled'
  | 'missing_required_side_effect'
  | 'terminal_review_unavailable'
  | 'route_blocked';

export type AgentRunPhaseKey = 'assess' | 'plan' | 'work' | 'review' | 'pilot' | 'deliver';

export type AgentRunPhaseStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface AgentRunPhase {
  key: AgentRunPhaseKey;
  title: string;
  status: AgentRunPhaseStatus;
  detail?: string;
  updatedAt: number;
}

export type AgentRunCheckpointKind = 'run' | 'phase' | 'tool' | 'sub-agent' | 'note';

export interface AgentRunCheckpoint {
  id: string;
  timestamp: number;
  kind: AgentRunCheckpointKind;
  title: string;
  detail?: string;
}

export interface AgentRunSummary {
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
  durationMs?: number;
}

export type AgentRunEvidenceKind =
  | 'fact'
  | 'source'
  | 'decision'
  | 'risk'
  | 'question'
  | 'artifact'
  | 'summary';

export type AgentRunEvidenceStatus = 'candidate' | 'verified' | 'open' | 'resolved';

export type AgentRunEvidenceRecorder =
  | 'supervisor'
  | 'worker'
  | 'pilot'
  | 'python'
  | 'tool'
  | 'system';

export interface AgentRunEvidenceEntry {
  id: string;
  kind: AgentRunEvidenceKind;
  status: AgentRunEvidenceStatus;
  recorder: AgentRunEvidenceRecorder;
  title: string;
  content: string;
  dedupeKey?: string;
  sourceName?: string;
  sourceUri?: string;
  toolName?: string;
  workerSessionId?: string;
  artifactWorkspacePath?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentRunAsyncOperationKind =
  | 'session'
  | 'expo-workflow'
  | 'ssh-background-job'
  | 'mobile-controller-handoff';

export type AgentRunAsyncOperationStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'cancel_requested';

export interface AgentRunMobileControllerHandoffRef {
  readonly version: 1;
  readonly effectRunId: string;
  readonly executionRunId: string;
  readonly effectId: string;
  readonly externalHandleId: string;
  readonly toolCallId: string;
  readonly controlEpoch: number;
  readonly handoffId: string;
  readonly controllerId: string;
  readonly controllerContractVersion: number;
  readonly capabilityDigest: ToolEffectDigest;
  readonly actionDigest: ToolEffectDigest;
  readonly beforeObservationId: string;
  readonly beforeObservationDigest: ToolEffectDigest;
  readonly expiresAt: number;
}

export interface AgentRunAsyncOperation {
  key: string;
  kind: AgentRunAsyncOperationKind;
  resourceId: string;
  displayName: string;
  status: AgentRunAsyncOperationStatus;
  blocksFinalization?: boolean;
  lastUpdatedByTool: string;
  updatedAt: number;
  monitorToolNames: string[];
  statusArgs?: Record<string, unknown>;
  waitToolName?: string;
  waitArgs?: Record<string, unknown>;
  mobileControllerHandoff?: AgentRunMobileControllerHandoffRef;
}

export type AgentRunControlGraphStatus =
  | 'ready'
  | 'model_turn'
  | 'awaiting_tool_results'
  | 'recovering'
  | 'waiting_async'
  | 'awaiting_user'
  | 'awaiting_review'
  | 'blocked'
  | 'finalized'
  | 'yielded'
  | 'cancelled'
  | 'failed';

export interface AgentRunControlGraphToolCallRef {
  id: string;
  name: string;
}

export interface AgentRunControlGraphToolResultRef extends AgentRunControlGraphToolCallRef {
  failed?: boolean;
  canonicalized?: boolean;
  graphApplied?: boolean;
}

export interface AgentRunControlGraphAuditEvent {
  type: string;
  timestamp: number;
  iteration?: number;
  detail?: string;
}

/**
 * Milestones a foreground turn passes between the user's send and the model's first
 * output, in the order the turn reaches them. {@link AgentRunTurnLatency} stores each as
 * elapsed milliseconds since the send, so the cost of a stage is the gap to its
 * predecessor and a missing mark means the turn never reached that stage.
 */
export const AGENT_RUN_TURN_LATENCY_STAGES = [
  'user_message_added',
  'recovery_ready',
  'request_reserved',
  'provider_ready',
  'journal_active',
  'session_bootstrapped',
  'request_context_prepared',
  'model_request_dispatched',
  'first_model_output',
] as const;

export type AgentRunTurnLatencyStage = (typeof AGENT_RUN_TURN_LATENCY_STAGES)[number];

export type AgentRunTurnLatency = Partial<Record<AgentRunTurnLatencyStage, number>>;

export interface AgentRunControlGraphPerformance {
  modelTurnCount: number;
  modelDurationMs: number;
  timeToFirstTokenMs?: number;
  /** Send-to-first-output breakdown of the latest foreground turn of this run. */
  turnLatency?: AgentRunTurnLatency;
  toolExecutionCount: number;
  toolExecutionDurationMs: number;
  lastCandidateToolCount: number;
  lastActiveToolCount: number;
  maxActiveToolCount: number;
  lastActiveToolTokenEstimate: number;
  maxActiveToolTokenEstimate: number;
  updatedAt: number;
}

export type AgentRunControlGraphForcedTextReason =
  | 'background_session_started'
  | 'empty_delivery_recovery'
  | 'execution_loop_recovery'
  | 'incomplete_delivery_continuation'
  | 'loop_recovery'
  | 'request_clarification'
  | 'request_consent'
  | 'request_decline'
  | 'request_wait'
  | 'yield_finalization';

export type AgentRunMobileControllerRecoveryState =
  | Readonly<{
      version: 1;
      phase: 'action_in_flight';
      strategyFingerprint: ToolEffectDigest;
      consecutiveStallCount: number;
      toolCallId: string;
    }>
  | Readonly<{
      version: 1;
      phase: 'tracking';
      strategyFingerprint: ToolEffectDigest;
      consecutiveStallCount: number;
    }>
  | Readonly<{
      version: 1;
      phase: 'strategy_change_required';
      strategyFingerprint: ToolEffectDigest;
      consecutiveStallCount: number;
    }>
  | Readonly<{
      version: 1;
      phase: 'recovery_in_flight';
      strategyFingerprint: ToolEffectDigest;
      blockedStrategyFingerprint: ToolEffectDigest;
      toolCallId: string;
    }>
  | Readonly<{
      version: 1;
      phase: 'recovery_stalled' | 'recovery_uncertain';
      strategyFingerprint: ToolEffectDigest;
      blockedStrategyFingerprint: ToolEffectDigest;
    }>
  | Readonly<{
      version: 1;
      phase: 'outcome_uncertain';
      strategyFingerprint: ToolEffectDigest;
    }>;

export interface AgentRunControlGraphTurnDirectives {
  forceFinalText: boolean;
  forcedTextReason?: AgentRunControlGraphForcedTextReason;
  requireWorkflowTool: boolean;
  maxTokensOverride?: number;
  incompleteFinalTextRecoveryCount: number;
  incompleteFinalTextContinuationPrefix?: string;
  /** Persisted across automatic resumes so recovery cannot loop indefinitely. */
  automaticRecoveryAttemptCount?: number;
  /** Content-free controller progress state; raw actions and observations remain ephemeral. */
  mobileControllerRecovery?: AgentRunMobileControllerRecoveryState;
}

export interface AgentRunControlGraphAsyncWorkState {
  awaitingBackgroundWorkers: boolean;
  pendingOperations: AgentRunAsyncOperation[];
  updatedAt: number;
}

export type AgentRunControlGraphUserInformationSemanticRole =
  | 'authorization'
  | 'constraint'
  | 'content'
  | 'identifier'
  | 'location'
  | 'other'
  | 'preference'
  | 'quantity'
  | 'recipient'
  | 'selection'
  | 'time'
  | 'title';

export interface AgentRunControlGraphRequiredUserInformation {
  key: string;
  requiredFor: 'understanding' | 'execution';
  semanticRole: AgentRunControlGraphUserInformationSemanticRole;
  resolution: 'unresolved' | 'user_provided';
}

export interface AgentRunControlGraphPendingUserInput {
  requestedAfterUserMessageId: string;
  requiredInformation: AgentRunControlGraphRequiredUserInformation[];
  updatedAt: number;
}

export type AgentPlanStepStatus = 'pending' | 'in_progress' | 'completed';

/** One step of the run's plan, as the model last stated it through update_plan. */
export interface AgentPlanStep {
  step: string;
  status: AgentPlanStepStatus;
}

export interface AgentRunControlGraphState {
  version: number;
  status: AgentRunControlGraphStatus;
  iteration: number;
  expectedToolCalls: AgentRunControlGraphToolCallRef[];
  observedToolResults: AgentRunControlGraphToolResultRef[];
  pendingAsyncCount: number;
  lastModelToolNames: string[];
  sessionActivatedToolNames?: string[];
  finalizationHoldReason?: string;
  terminalReason?: string;
  activeTaskId?: string;
  plan?: AgentPlanStep[];
  requestUnderstanding?: RequestUnderstandingSnapshot;
  pendingUserInput?: AgentRunControlGraphPendingUserInput;
  asyncWork: AgentRunControlGraphAsyncWorkState;
  performance: AgentRunControlGraphPerformance;
  turnDirectives: AgentRunControlGraphTurnDirectives;
  audit: AgentRunControlGraphAuditEvent[];
  updatedAt: number;
}

export interface AgentRun {
  id: string;
  userMessageId: string;
  goal: string;
  workflowTaskAnchor?: WorkflowTaskAnchor;
  status: AgentRunStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  currentPhase: AgentRunPhaseKey;
  phases: AgentRunPhase[];
  checkpoints: AgentRunCheckpoint[];
  evidence?: AgentRunEvidenceEntry[];
  controlGraph?: AgentRunControlGraphState;
  terminalReason?: AgentRunTerminalReason;
  latestSummary?: string;
  summary: AgentRunSummary;
}
