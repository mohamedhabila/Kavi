// ---------------------------------------------------------------------------
// Kavi — E2E agent eval types (structural rubrics only)
// ---------------------------------------------------------------------------

import type {
  AgentRunControlGraphState,
  AgentRunPhaseKey,
  AgentRunStatus,
  AgentRunSummary,
} from '../../types/agentRun';
import type { Message, ToolCallFailureKind } from '../../types/message';
import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioFinalAssistantSnapshot,
  ForegroundScenarioLifecycleBoundary,
  ForegroundScenarioLifecycleSnapshot,
  ForegroundScenarioNativeEvidenceSnapshot,
  ForegroundScenarioSteerDirective,
  ForegroundScenarioUserSnapshot,
} from './foregroundScenarioDriverTypes';
import type {
  ForegroundScenarioMemoryItemsState,
  ForegroundScenarioMemoryPromptEvidence,
} from './foregroundScenarioMemoryItemsEvidence';
import type { RequestClarificationSemanticRole } from '../../services/agents/requestClarification';
import type { E2ENativeFixtureSeed } from './e2eNativeMobileFixtures';

export type E2EToolCallRecord = {
  id: string;
  name: string;
  arguments: string;
  /** Why the call failed, as the runtime recorded it (e.g. `invalid_arguments`). */
  failureKind?: ToolCallFailureKind;
};

export type E2EToolResultRecord = {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
};

/** One model call's usage, in call order, so cache behavior can be read per call. */
export type E2EModelCallUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 0 on a call that declared no tools — a forced-text turn. */
  toolDeclarationTokens?: number;
  toolDeclarationDigest?: string;
  upstreamProvider?: string;
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
  calls: E2EModelCallUsage[];
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
  finalAssistant: ForegroundScenarioFinalAssistantSnapshot | null;
  finalAssistantCandidateCount: number;
  completion: ForegroundScenarioCompletionSnapshot;
  agentRun: E2EAgentRunTrace | null;
  memoryExtractionSettled: boolean;
  /** Time spent waiting for background extraction after the reply (not user-facing latency). */
  memoryExtractionWaitMs: number;
  native: ForegroundScenarioNativeEvidenceSnapshot;
  memoryPrompt: ForegroundScenarioMemoryPromptEvidence;
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
  memoryItems: ForegroundScenarioMemoryItemsState;
  /** Per-orchestrator-invocation traces for turn-scoped rubrics. */
  turnTraces: ReadonlyArray<E2EScenarioTurnTrace>;
  /** The conversation's model calls; token budgets are graded on these. */
  usage: E2ETokenUsageSummary;
  /** Background memory extraction calls, kept apart so budgets measure the conversation. */
  memoryUsage: E2ETokenUsageSummary;
  /** Everything the scenario spent, memory extraction included. */
  estimatedCost: E2EEstimatedCostSummary;
  errors: ReadonlyArray<string>;
  completed: boolean;
  durationMs: number;
  /** User messages sent across sequential orchestrator invocations (multi-turn flow). */
  userTurnCount: number;
};

export type E2EUserTurn = {
  content: string;
  lifecycleBefore?: ForegroundScenarioLifecycleBoundary;
  /** Simulates the user sending another message while this turn's run works. */
  steer?: ForegroundScenarioSteerDirective;
};

export type E2EScenarioContentClass = 'private' | 'synthetic_public';

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

/**
 * A memory item the scenario expects: its text contains every string in `contains` and
 * none in `excludes` (case-insensitive, NFKC). Pick the smallest tokens that identify the
 * memory (a code, a name, a number) rather than a phrase the model may word differently.
 * `excludes` tells a stale value from a correction that mentions it ("45, not 30").
 */
export type E2EMemoryItemExpectation = Readonly<{
  contains: ReadonlyArray<string>;
  excludes?: ReadonlyArray<string>;
}>;

export type E2EMemorySelectionExpectation = Readonly<{
  /** Each must match an item the turn was shown, in its memory section or a memory_search. */
  requiredItems: ReadonlyArray<E2EMemoryItemExpectation>;
  /** None may match an item the turn was shown. */
  forbiddenItems?: ReadonlyArray<E2EMemoryItemExpectation>;
}>;

export type E2EMemoryProbeAnswerExpectation =
  | Readonly<{
      kind: 'fact_values';
      requiredValues: ReadonlyArray<string>;
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
  | { kind: 'workspace_file'; path: string; contains?: string; excludes?: string }
  | { kind: 'workspace_file_absent'; path: string }
  | { kind: 'graph_status'; status: AgentRunControlGraphState['status'] }
  | { kind: 'graph_terminal_success' }
  | { kind: 'completion_gate_hold'; reason?: string }
  | ({ kind: 'memory_item' } & E2EMemoryItemExpectation)
  | ({ kind: 'memory_item_absent' } & E2EMemoryItemExpectation)
  | { kind: 'token_budget'; maxTotalTokens: number }
  /** Every tool call the conversation made, all turns together; a worker's own calls are not counted. */
  | { kind: 'tool_call_budget'; maxToolCalls: number }
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
      kind: 'turn_completion';
      turnIndex: number;
      field: 'execution' | 'final_response' | 'agent_run';
      expected: boolean;
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
      /** Count calls to any of these tools (e.g. a text sent or composed); not with toolName. */
      toolNames?: ReadonlyArray<string>;
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
  | ({ kind: 'turn_memory_selection'; turnIndex: number } & E2EMemorySelectionExpectation)
  /** A delegated worker's result, as a sessions tool returned it, carries this exact token. */
  | { kind: 'worker_result_token'; token: string }
  /** At least `min` closed turns were captured in the past-turn index. */
  | { kind: 'memory_turns_indexed'; min: number }
  | {
      kind: 'native_fixture_state';
      path: string;
      expectedValue: string;
    }
  /** The device field's text contains this, ignoring case (an address in a drafted message). */
  | { kind: 'native_fixture_contains'; path: string; contains: string }
  | {
      kind: 'file_hash';
      path: string;
      expectedHash: string;
      algorithm?: 'sha256';
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
  /** The phone's contacts and calendar before the first turn; the default device otherwise. */
  initialNativeFixture?: E2ENativeFixtureSeed;
  /** Frozen condition-aware scoring contract used only by paired evaluation. */
  pairedEvaluation?: E2EPairedCausalMemoryContract;
};
