// ---------------------------------------------------------------------------
// Kavi — E2E agent eval types (structural rubrics only)
// ---------------------------------------------------------------------------

import type {
  AgentGoalStatus,
  AgentRunControlGraphState,
  AgentRunPhaseKey,
  AgentRunStatus,
  AgentRunSummary,
} from '../../types/agentRun';
import type { ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import type { MemoryFactScope } from '../../services/memory/facts/types';
import type { IngestionProviderOutcome } from '../../services/memory/ingestionQueue';
import type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioExecutionContextSnapshot,
  ForegroundScenarioFinalAssistantSnapshot,
  ForegroundScenarioLifecycleBoundary,
  ForegroundScenarioLifecycleSnapshot,
  ForegroundScenarioMemoryFinalState,
  ForegroundScenarioMemorySnapshot,
  ForegroundScenarioMemoryTurnEvidence,
  ForegroundScenarioNativeEvidenceSnapshot,
  ForegroundScenarioRouteDirective,
  ForegroundScenarioUserSnapshot,
} from './foregroundScenarioDriverTypes';
import type { ForegroundScenarioRetrievalEvidence } from './foregroundScenarioRetrievalEvidence';
import type { RequestClarificationSemanticRole } from '../../services/agents/requestClarification';

export type E2EToolCallRecord = {
  id: string;
  name: string;
  arguments: string;
};

export type E2EToolResultRecord = {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
};

export type E2ETokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  eventCount: number;
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: E2EPromptCacheSummary;
};

export type E2EEstimatedCostSummary =
  | Readonly<{ status: 'available'; usd: number }>
  | Readonly<{ status: 'unavailable'; usd: null }>;

export type E2EPromptCacheReasonCount = {
  reason: string;
  count: number;
};

export type E2EPromptCachePrefixStability = {
  eventCount: number;
  stableSystemPromptDigestEventCount: number;
  stableToolDeclarationDigestEventCount: number;
  cacheablePrefixDigestEventCount: number;
  toolDeclarationDigestEventCount: number;
  uniqueStableSystemPromptDigestCount: number;
  uniqueStableToolDeclarationDigestCount: number;
  uniqueCacheablePrefixDigestCount: number;
  uniqueToolDeclarationDigestCount: number;
  stableSystemPromptDigestPerEvent: number;
  stableToolDeclarationDigestPerEvent: number;
  cacheablePrefixDigestPerEvent: number;
  toolDeclarationDigestPerEvent: number;
  longestStableSystemPromptRun: number;
  longestStableToolDeclarationRun: number;
  longestCacheablePrefixRun: number;
  longestToolDeclarationRun: number;
};

export type E2EPromptCacheSummary = {
  eligibleTurnCount: number;
  enabledTurnCount: number;
  skippedTurnCount: number;
  createEventCount: number;
  reuseEventCount: number;
  providerManagedEventCount: number;
  thresholdTokens: number[];
  explicitCacheNames: string[];
  reasonCounts: E2EPromptCacheReasonCount[];
  prefixStability?: E2EPromptCachePrefixStability;
  events: UsagePromptCacheTelemetry[];
};

export type E2EAgentRunTrace = {
  runId: string;
  userMessageId: string;
  status: AgentRunStatus;
  currentPhase: AgentRunPhaseKey;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  terminalReason: string | null;
  summary: AgentRunSummary;
};

export type E2EScenarioTurnTrace = {
  turnIndex: number;
  lifecycleBefore: ForegroundScenarioLifecycleSnapshot | null;
  user: ForegroundScenarioUserSnapshot;
  route: Readonly<{
    directive: ForegroundScenarioRouteDirective;
  }> &
    ForegroundScenarioExecutionContextSnapshot;
  finalAssistant: ForegroundScenarioFinalAssistantSnapshot | null;
  finalAssistantCandidateCount: number;
  completion: ForegroundScenarioCompletionSnapshot;
  agentRun: E2EAgentRunTrace | null;
  memory: ReadonlyArray<ForegroundScenarioMemorySnapshot>;
  memoryEvidence: ForegroundScenarioMemoryTurnEvidence;
  native: ForegroundScenarioNativeEvidenceSnapshot;
  retrieval: ForegroundScenarioRetrievalEvidence;
  toolCalls: ReadonlyArray<E2EToolCallRecord>;
  toolResults: ReadonlyArray<E2EToolResultRecord>;
  graphSnapshots: ReadonlyArray<AgentRunControlGraphState>;
  usage: E2ETokenUsageSummary;
  completed: boolean;
};

export type E2EScenarioResult = {
  contentClass: E2EScenarioContentClass;
  fixtureId: string;
  conversationId: string;
  toolCalls: ReadonlyArray<E2EToolCallRecord>;
  toolResults: ReadonlyArray<E2EToolResultRecord>;
  graphSnapshots: ReadonlyArray<AgentRunControlGraphState>;
  memoryFinalState: ForegroundScenarioMemoryFinalState;
  /** Per-orchestrator-invocation traces for turn-scoped rubrics. */
  turnTraces: ReadonlyArray<E2EScenarioTurnTrace>;
  usage: E2ETokenUsageSummary;
  estimatedCost: E2EEstimatedCostSummary;
  errors: ReadonlyArray<string>;
  completed: boolean;
  durationMs: number;
  /** User messages sent across sequential orchestrator invocations (multi-turn flow). */
  userTurnCount: number;
};

export type E2EUserTurn = {
  content: string;
  route?: ForegroundScenarioRouteDirective;
  lifecycleBefore?: ForegroundScenarioLifecycleBoundary;
  /** Simulates the user choosing a chat mode in the product UI before this turn. */
  selectedMode?: ConversationMode;
};

export type E2EScenarioContentClass = 'private' | 'synthetic_public';

export type E2EScenarioExecution = {
  initialMode: ConversationMode;
  route: ForegroundScenarioRouteDirective;
};

export type E2EPairedCausalMemoryContract = Readonly<{
  kind: 'causal_memory';
  referenceCondition: 'memory_off';
  candidateCondition: 'production_auto';
  neutralRubricIndexes: ReadonlyArray<number>;
  causalRubricIndexes: ReadonlyArray<number>;
}>;

export type E2EWorkspaceSeedFile = {
  path: string;
  content: string;
};

export type E2EMemoryFactExpectation = Readonly<{
  subject: string;
  predicate: string;
  value: string;
  scope: MemoryFactScope;
}>;

export type E2EMemoryProbeAnswerExpectation =
  | Readonly<{
      kind: 'fact_values';
      requiredValues: ReadonlyArray<string>;
      forbiddenValues?: ReadonlyArray<string>;
    }>
  | Readonly<{
      kind: 'abstention';
      exactText: string;
    }>;

export type E2EClarificationMissingInformation = Readonly<{
  semanticRole: RequestClarificationSemanticRole;
  key?: string;
}>;

export type E2ERubric =
  | { kind: 'workspace_file'; path: string; contains?: string }
  | { kind: 'workspace_file_absent'; path: string }
  | { kind: 'goals_bootstrapped'; minGoals?: number }
  | { kind: 'goal_evidence_satisfied' }
  | { kind: 'graph_status'; status: AgentRunControlGraphState['status'] }
  | { kind: 'graph_terminal_success' }
  | { kind: 'completion_gate_hold'; reason?: string }
  | ({ kind: 'memory_fact' } & E2EMemoryFactExpectation)
  | ({ kind: 'memory_fact_absent' } & E2EMemoryFactExpectation)
  | { kind: 'token_budget'; maxTotalTokens: number }
  | { kind: 'cache_read_tokens'; minCacheReadTokens: number }
  | {
      kind: 'cache_prefix_readiness';
      minEligibleInputTokens?: number;
      minEligibleTurns?: number;
      afterWarmupTurns?: number;
    }
  | {
      kind: 'cache_eligible_read_rate';
      minRate: number;
      minEligibleInputTokens?: number;
      minEligibleTurns?: number;
      afterWarmupTurns?: number;
    }
  | { kind: 'min_user_turns'; min: number }
  | {
      kind: 'turn_route';
      turnIndex: number;
      directive: ForegroundScenarioRouteDirective;
      mode: ConversationMode;
    }
  | {
      kind: 'turn_completion';
      turnIndex: number;
      field: 'execution' | 'final_response';
      expected: boolean;
    }
  | {
      kind: 'turn_completion';
      turnIndex: number;
      field: 'agent_run';
      expected: boolean | null;
    }
  | {
      kind: 'turn_memory_receipt';
      turnIndex: number;
      providerOutcome?: IngestionProviderOutcome;
    }
  | {
      kind: 'turn_lifecycle_boundary';
      turnIndex: number;
      boundary: ForegroundScenarioLifecycleBoundary;
    }
  | { kind: 'turn_final_response_token'; turnIndex: number; token: string }
  | {
      kind: 'turn_clarification';
      turnIndex: number;
      requiredMissingInformation: ReadonlyArray<E2EClarificationMissingInformation>;
    }
  | {
      kind: 'turn_native_invocation_count';
      turnIndex: number;
      toolName?: string;
      expectedCount: number;
    }
  | {
      kind: 'turn_tool_call_count';
      turnIndex: number;
      scope: 'all' | 'side_effectful';
      expectedCount: number;
    }
  | {
      kind: 'turn_memory_answer';
      turnIndex: number;
      answer: E2EMemoryProbeAnswerExpectation;
    }
  | {
      kind: 'turn_memory_selection';
      turnIndex: number;
      requiredFacts: ReadonlyArray<E2EMemoryFactExpectation>;
      forbiddenFacts?: ReadonlyArray<E2EMemoryFactExpectation>;
      maxSelectedFacts?: number;
    }
  | { kind: 'goal_status'; goalId: string; status: AgentGoalStatus }
  | { kind: 'ingestion_job_checkpointed'; minCount?: number }
  | { kind: 'ingestion_job_completed'; minCount?: number }
  | { kind: 'memory_episode_count'; min: number }
  | {
      kind: 'native_fixture_state';
      path: string;
      expectedValue: string;
    }
  | {
      kind: 'file_hash';
      path: string;
      expectedHash: string;
      algorithm?: 'sha256';
    }
  | {
      kind: 'goal_criterion';
      goalId: string;
      criterion: string;
      met: boolean;
    }
  | {
      kind: 'working_block_token';
      label: 'active_focus' | 'open_threads';
      token: string;
    }
  | {
      kind: 'graph_audit_observed';
      auditType: string;
      detailContains?: string;
      minCount?: number;
    };

export type E2EScenario = {
  id: string;
  conversationId: string;
  contentClass: E2EScenarioContentClass;
  /** Product route applied unless a turn explicitly overrides it. */
  execution: E2EScenarioExecution;
  /** Structural thread title token used by passive memory ingestion. */
  threadTitle?: string;
  /** Single-turn prompt when `userTurns` is omitted. */
  prompt: string;
  /** Sequential user messages — each invokes the orchestrator with accumulated history. */
  userTurns?: ReadonlyArray<E2EUserTurn>;
  rubrics: ReadonlyArray<E2ERubric>;
  maxTokens?: number;
  systemPrompt?: string;
  initialMessages?: ReadonlyArray<Message>;
  initialWorkspaceFiles?: ReadonlyArray<E2EWorkspaceSeedFile>;
  /** Frozen condition-aware scoring contract used only by paired evaluation. */
  pairedEvaluation?: E2EPairedCausalMemoryContract;
};
