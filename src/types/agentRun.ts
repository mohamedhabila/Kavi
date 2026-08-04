import type { RequestUnderstandingSnapshot } from './requestUnderstanding';
import type { AgentGoal } from '../engine/goals/types';
import type { WorkflowTaskAnchor } from './workflowTaskAnchor';
import type { ToolEffectDigest } from './toolEffectReceipt';

export type {
  AgentGoal,
  AgentGoalCompletionPolicy,
  AgentGoalStatus,
  AgentGoalUserConstraint,
} from '../engine/goals/types';

export type AgentRunTaskOwner = 'supervisor' | 'worker' | 'either';

export interface AgentRunTaskDefinition {
  id: string;
  title: string;
  goal?: string;
  expectedOutput?: string;
  successCriteria?: string[];
  dependencies?: string[];
  owner?: AgentRunTaskOwner;
  requirements?: string[];
  requiredCapabilities?: string[];
}

export type AgentRunTaskStatus = 'done' | 'active' | 'pending';

export interface AgentRunWorkstream extends AgentRunTaskDefinition {}

export interface AgentRunTaskLedgerItem extends AgentRunTaskDefinition {
  status: AgentRunTaskStatus;
  owner: AgentRunTaskOwner;
  completedEvidence?: string[];
}

export interface AgentRunPlan {
  objective: string;
  successCriteria: string[];
  stopConditions: string[];
  workstreams: AgentRunWorkstream[];
  rawPlan?: string;
  updatedAt: number;
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunTerminalReason =
  | 'loop_detected'
  | 'terminal_blocked'
  | 'tool_failure'
  | 'user_cancelled'
  | 'missing_required_side_effect'
  | 'terminal_review_unavailable'
  | 'route_blocked'
  /**
   * The run ended because a required goal was proven unreachable: every available
   * path was tried and failed, and the agent reported that instead of stalling.
   * Distinct from the breakdown reasons above — the turn concluded correctly even
   * though the objective was not met, so it must not be counted as a malfunction.
   */
  | 'goal_infeasible';

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
  evidence?: string[];
}

export interface AgentRunControlGraphAuditEvent {
  type: string;
  timestamp: number;
  iteration?: number;
  detail?: string;
}

export interface AgentRunControlGraphPerformance {
  modelTurnCount: number;
  modelDurationMs: number;
  timeToFirstTokenMs?: number;
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
  | 'async_terminal_completion'
  | 'background_session_started'
  | 'empty_delivery_recovery'
  | 'execution_loop_recovery'
  | 'incomplete_delivery_continuation'
  | 'loop_recovery'
  | 'persistent_context_settled'
  | 'request_clarification'
  | 'request_consent'
  | 'request_decline'
  | 'request_wait'
  | 'workflow_route_completed'
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
  goals?: AgentGoal[];
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
  plan?: AgentRunPlan;
  evidence?: AgentRunEvidenceEntry[];
  controlGraph?: AgentRunControlGraphState;
  terminalReason?: AgentRunTerminalReason;
  latestSummary?: string;
  summary: AgentRunSummary;
}
