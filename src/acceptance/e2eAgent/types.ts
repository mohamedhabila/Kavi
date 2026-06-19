// ---------------------------------------------------------------------------
// Kavi — E2E agent eval types (structural rubrics only)
// ---------------------------------------------------------------------------

import type { AgentGoalStatus, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';

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

export type E2EScenarioTurnTrace = {
  turnIndex: number;
  toolCalls: ReadonlyArray<E2EToolCallRecord>;
  toolResults: ReadonlyArray<E2EToolResultRecord>;
  graphSnapshots: ReadonlyArray<AgentRunControlGraphState>;
  usage: E2ETokenUsageSummary;
  completed: boolean;
};

export type E2EScenarioResult = {
  fixtureId: string;
  conversationId: string;
  toolCalls: ReadonlyArray<E2EToolCallRecord>;
  toolResults: ReadonlyArray<E2EToolResultRecord>;
  graphSnapshots: ReadonlyArray<AgentRunControlGraphState>;
  /** Per-orchestrator-invocation traces for turn-scoped rubrics. */
  turnTraces: ReadonlyArray<E2EScenarioTurnTrace>;
  usage: E2ETokenUsageSummary;
  errors: ReadonlyArray<string>;
  completed: boolean;
  durationMs: number;
  /** User messages sent across sequential orchestrator invocations (multi-turn flow). */
  userTurnCount: number;
};

export type E2EUserTurn = {
  content: string;
};

export type E2EWorkspaceSeedFile = {
  path: string;
  content: string;
};

export type E2ERubric =
  | { kind: 'workspace_file'; path: string; contains?: string }
  | { kind: 'workspace_file_absent'; path: string }
  | { kind: 'goals_bootstrapped'; minGoals?: number }
  | { kind: 'goal_evidence_satisfied' }
  | { kind: 'graph_status'; status: AgentRunControlGraphState['status'] }
  | { kind: 'graph_terminal_success' }
  | { kind: 'completion_gate_hold'; reason?: string }
  | { kind: 'memory_fact'; predicate: string; value: string }
  | { kind: 'memory_fact_absent'; predicate: string; value: string }
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
  | { kind: 'goal_status'; goalId: string; status: AgentGoalStatus }
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
};
