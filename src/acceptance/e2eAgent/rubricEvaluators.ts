// ---------------------------------------------------------------------------
// Kavi — E2E structural rubric evaluators (no language heuristics)
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import {
  evaluateGoalEvidenceGaps,
  isSuccessCriterionMet,
} from '../../engine/goals/completionEvidence';
import { getE2ENativeMobileFixtureStateSnapshot } from '../../engine/tools/e2eNativeCalendarFixtures';
import {
  readJsonFieldAtPath,
  structuralValuesMatch,
} from '../../engine/goals/structuralCriterionValues';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import { estimateUsageCacheEligibleInputTokens } from './evaluateE2EAgentMetrics';
import {
  countE2ECompletedIngestionJobs,
  countE2EEpisodes,
  findMemoryFactsMatching,
  readE2EWorkingBlockContent,
} from './sandboxMemory';
import { readWorkspaceRelativeFile, workspaceFileExists } from './sandboxWorkspace';
import type { E2ERubric, E2EScenarioResult, E2ETokenUsageSummary } from './types';
import type { UsagePromptCacheTelemetry } from '../../types/usage';

function hasGraphAuditObservation(
  result: E2EScenarioResult,
  auditType: string,
  detailContains?: string,
): number {
  const normalizedType = auditType.trim();
  const normalizedDetail = detailContains?.trim();
  let count = 0;

  for (const snapshot of result.graphSnapshots) {
    for (const event of snapshot.audit ?? []) {
      if (event.type?.trim() !== normalizedType) {
        continue;
      }
      if (normalizedDetail && !event.detail?.includes(normalizedDetail)) {
        continue;
      }
      count += 1;
    }
  }

  return count;
}

function findGoalById(result: E2EScenarioResult, goalId: string) {
  const normalizedGoalId = goalId.trim();
  const goals = getLatestGraphSnapshot(result)?.goals ?? [];
  return goals.find((goal) => goal.id.trim() === normalizedGoalId);
}

const E2E_GRAPH_TERMINAL_SUCCESS_STATUSES = new Set<AgentRunControlGraphState['status']>([
  'finalized',
  'awaiting_review',
]);

function getLatestGraphSnapshot(result: E2EScenarioResult) {
  return result.graphSnapshots[result.graphSnapshots.length - 1];
}

function hasCompletionGateHold(result: E2EScenarioResult, reason?: string): boolean {
  const normalizedReason = reason?.trim().toLowerCase();
  for (const snapshot of result.graphSnapshots) {
    if (
      normalizedReason &&
      snapshot.finalizationHoldReason?.trim().toLowerCase() === normalizedReason
    ) {
      return true;
    }

    for (const event of snapshot.audit ?? []) {
      const detail = event.detail?.trim().toLowerCase() ?? '';
      if (!detail.includes('decision:hold')) {
        continue;
      }
      if (!normalizedReason || detail.includes(`reason:${normalizedReason}`)) {
        return true;
      }
    }
  }

  return (
    !normalizedReason &&
    result.graphSnapshots.some((snapshot) => Boolean(snapshot.finalizationHoldReason?.trim()))
  );
}

function promptCacheOpportunityKey(event: UsagePromptCacheTelemetry): string {
  const explicitCacheName = event.explicitCacheName?.trim();
  if (explicitCacheName) {
    return `${event.mode}:explicit:${explicitCacheName}`;
  }

  const cacheablePrefixDigest = event.cacheablePrefixDigest?.trim();
  return cacheablePrefixDigest ? `${event.mode}:provider:${cacheablePrefixDigest}` : '';
}

function estimateWarmupAwareCacheEligibleInputTokens(
  usageBuckets: ReadonlyArray<{ usage: E2ETokenUsageSummary; score: boolean }>,
): { eligibleInputTokens: number; eligibleTurnCount: number } {
  const seenKeys = new Set<string>();
  let sawUnkeyedEligibleEvent = false;
  let eligibleInputTokens = 0;
  let eligibleTurnCount = 0;

  for (const bucket of usageBuckets) {
    let bucketEligibleInputTokens = 0;

    if (!bucket.usage.promptCache) {
      if (
        bucket.score &&
        bucket.usage.inputTokens > 0 &&
        estimateUsageCacheEligibleInputTokens(bucket.usage) > 0
      ) {
        bucketEligibleInputTokens += bucket.usage.inputTokens;
      }
    } else {
      let bucketEligibleEventCount = 0;
      let bucketEligibleEstimatedTokens = 0;
      let bucketEligibleTotalEventCount = 0;

      for (const event of bucket.usage.promptCache.events) {
        if (!event.eligible) {
          continue;
        }
        bucketEligibleTotalEventCount += 1;

        const estimatedInputTokens = Math.max(0, event.estimatedInputTokens);
        let eligibleForRead = event.event === 'reuse' || bucket.usage.cacheReadTokens > 0;

        if (!eligibleForRead) {
          const key = promptCacheOpportunityKey(event);
          if (!key) {
            eligibleForRead = sawUnkeyedEligibleEvent;
            sawUnkeyedEligibleEvent = true;
          } else if (seenKeys.has(key)) {
            eligibleForRead = true;
          } else {
            seenKeys.add(key);
          }
        }

        if (bucket.score && eligibleForRead) {
          bucketEligibleEventCount += 1;
          bucketEligibleEstimatedTokens += estimatedInputTokens;
        }
      }

      if (bucket.score && bucketEligibleEventCount > 0) {
        const actualInputTokens = Math.max(0, bucket.usage.inputTokens);
        bucketEligibleInputTokens =
          actualInputTokens > 0 && bucketEligibleEventCount === bucketEligibleTotalEventCount
            ? actualInputTokens
            : bucketEligibleEstimatedTokens;
      }
    }

    if (bucket.score && bucketEligibleInputTokens > 0) {
      eligibleTurnCount += 1;
      eligibleInputTokens += bucketEligibleInputTokens;
    }
  }

  return { eligibleInputTokens, eligibleTurnCount };
}

function evaluateCacheEligibleReadRate(
  result: E2EScenarioResult,
  rubric: Extract<E2ERubric, { kind: 'cache_eligible_read_rate' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = `${result.fixtureId}:${rubric.kind}`;
  const afterWarmupTurns = Math.max(0, Math.floor(rubric.afterWarmupTurns ?? 0));
  const usageBuckets =
    result.turnTraces.length > 0
      ? result.turnTraces
          .slice()
          .sort((left, right) => left.turnIndex - right.turnIndex)
          .map((trace) => ({
            usage: trace.usage,
            score: trace.turnIndex >= afterWarmupTurns,
          }))
      : [{ usage: result.usage, score: true }];
  const { eligibleInputTokens, eligibleTurnCount } =
    estimateWarmupAwareCacheEligibleInputTokens(usageBuckets);
  const cacheReadTokens = usageBuckets
    .filter((bucket) => bucket.score)
    .reduce((sum, bucket) => sum + Math.max(0, bucket.usage.cacheReadTokens), 0);
  const minEligibleInputTokens = Math.max(0, Math.floor(rubric.minEligibleInputTokens ?? 1));
  const minEligibleTurns = Math.max(0, Math.floor(rubric.minEligibleTurns ?? 1));

  if (eligibleInputTokens < minEligibleInputTokens) {
    return {
      fixtureId,
      passed: false,
      detail: `cache eligible input tokens ${eligibleInputTokens} below minimum ${minEligibleInputTokens}`,
    };
  }

  if (eligibleTurnCount < minEligibleTurns) {
    return {
      fixtureId,
      passed: false,
      detail: `cache eligible turns ${eligibleTurnCount} below minimum ${minEligibleTurns}`,
    };
  }

  const rate = eligibleInputTokens > 0 ? cacheReadTokens / eligibleInputTokens : 0;
  if (rate < rubric.minRate) {
    return {
      fixtureId,
      passed: false,
      detail: `eligible cache read rate ${rate.toFixed(3)} below minimum ${rubric.minRate.toFixed(3)} (${cacheReadTokens}/${eligibleInputTokens})`,
    };
  }

  return {
    fixtureId,
    passed: true,
    detail: `eligible cache read rate ${rate.toFixed(3)} (${cacheReadTokens}/${eligibleInputTokens})`,
  };
}

function evaluateCachePrefixReadiness(
  result: E2EScenarioResult,
  rubric: Extract<E2ERubric, { kind: 'cache_prefix_readiness' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = `${result.fixtureId}:${rubric.kind}`;
  const afterWarmupTurns = Math.max(0, Math.floor(rubric.afterWarmupTurns ?? 0));
  const usageBuckets =
    result.turnTraces.length > 0
      ? result.turnTraces
          .slice()
          .sort((left, right) => left.turnIndex - right.turnIndex)
          .map((trace) => ({
            usage: trace.usage,
            score: trace.turnIndex >= afterWarmupTurns,
          }))
      : [{ usage: result.usage, score: true }];
  const { eligibleInputTokens, eligibleTurnCount } =
    estimateWarmupAwareCacheEligibleInputTokens(usageBuckets);
  const minEligibleInputTokens = Math.max(0, Math.floor(rubric.minEligibleInputTokens ?? 1));
  const minEligibleTurns = Math.max(0, Math.floor(rubric.minEligibleTurns ?? 1));

  if (eligibleInputTokens < minEligibleInputTokens) {
    return {
      fixtureId,
      passed: false,
      detail: `cache prefix readiness tokens ${eligibleInputTokens} below minimum ${minEligibleInputTokens}`,
    };
  }

  if (eligibleTurnCount < minEligibleTurns) {
    return {
      fixtureId,
      passed: false,
      detail: `cache prefix readiness turns ${eligibleTurnCount} below minimum ${minEligibleTurns}`,
    };
  }

  return {
    fixtureId,
    passed: true,
    detail: `cache prefix readiness ${eligibleTurnCount} turns ${eligibleInputTokens} tokens`,
  };
}

export function evaluateE2ERubric(
  result: E2EScenarioResult,
  rubric: E2ERubric,
): AcceptanceFixtureOutcome {
  const fixtureId = `${result.fixtureId}:${rubric.kind}`;

  switch (rubric.kind) {
    case 'workspace_file': {
      if (!workspaceFileExists(result.conversationId, rubric.path)) {
        return {
          fixtureId,
          passed: false,
          detail: `workspace file missing: ${rubric.path}`,
        };
      }

      if (rubric.contains) {
        const content = readWorkspaceRelativeFile(result.conversationId, rubric.path) ?? '';
        if (!content.includes(rubric.contains)) {
          return {
            fixtureId,
            passed: false,
            detail: `workspace file ${rubric.path} missing token ${rubric.contains}`,
          };
        }
      }

      return { fixtureId, passed: true };
    }

    case 'workspace_file_absent': {
      if (workspaceFileExists(result.conversationId, rubric.path)) {
        return {
          fixtureId,
          passed: false,
          detail: `workspace file present: ${rubric.path}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'goals_bootstrapped': {
      const snapshot = getLatestGraphSnapshot(result);
      const goalCount = snapshot?.goals?.length ?? 0;
      const minimum = rubric.minGoals ?? 1;
      if (goalCount < minimum) {
        return {
          fixtureId,
          passed: false,
          detail: `goals bootstrapped: ${goalCount} (expected >= ${minimum})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'goal_evidence_satisfied': {
      const goals = getLatestGraphSnapshot(result)?.goals ?? [];
      const gaps = evaluateGoalEvidenceGaps(goals);
      if (gaps.length > 0) {
        return {
          fixtureId,
          passed: false,
          detail: `goal evidence gaps: ${gaps.map((gap) => `${gap.goalId}:${gap.criterionId}`).join(', ')}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'graph_status': {
      const status = getLatestGraphSnapshot(result)?.status;
      if (status !== rubric.status) {
        return {
          fixtureId,
          passed: false,
          detail: `graph status ${status ?? 'missing'} (expected ${rubric.status})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'graph_terminal_success': {
      const status = getLatestGraphSnapshot(result)?.status;
      if (!status || !E2E_GRAPH_TERMINAL_SUCCESS_STATUSES.has(status)) {
        return {
          fixtureId,
          passed: false,
          detail: `graph terminal status ${status ?? 'missing'} (expected finalized or awaiting_review)`,
        };
      }
      if (!result.completed) {
        return {
          fixtureId,
          passed: false,
          detail: 'orchestrator did not complete',
        };
      }
      return { fixtureId, passed: true };
    }

    case 'completion_gate_hold': {
      if (!hasCompletionGateHold(result, rubric.reason)) {
        return {
          fixtureId,
          passed: false,
          detail: rubric.reason
            ? `completion gate hold not observed for reason ${rubric.reason}`
            : 'completion gate hold not observed',
        };
      }
      return { fixtureId, passed: true };
    }

    case 'memory_fact': {
      const matches = findMemoryFactsMatching({
        predicate: rubric.predicate,
        value: rubric.value,
      });
      if (matches.length === 0) {
        return {
          fixtureId,
          passed: false,
          detail: `memory fact missing: ${rubric.predicate}=${rubric.value}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'memory_fact_absent': {
      const matches = findMemoryFactsMatching({
        predicate: rubric.predicate,
        value: rubric.value,
      });
      if (matches.length > 0) {
        return {
          fixtureId,
          passed: false,
          detail: `memory fact present: ${rubric.predicate}=${rubric.value}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'token_budget': {
      if (result.usage.totalTokens > rubric.maxTotalTokens) {
        return {
          fixtureId,
          passed: false,
          detail: `token total ${result.usage.totalTokens} exceeds budget ${rubric.maxTotalTokens}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'cache_read_tokens': {
      if (result.usage.cacheReadTokens < rubric.minCacheReadTokens) {
        return {
          fixtureId,
          passed: false,
          detail: `cache read tokens ${result.usage.cacheReadTokens} below minimum ${rubric.minCacheReadTokens}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'cache_prefix_readiness': {
      return evaluateCachePrefixReadiness(result, rubric);
    }

    case 'cache_eligible_read_rate': {
      return evaluateCacheEligibleReadRate(result, rubric);
    }

    case 'min_user_turns': {
      if (result.userTurnCount < rubric.min) {
        return {
          fixtureId,
          passed: false,
          detail: `user turns ${result.userTurnCount} (expected >= ${rubric.min})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'goal_status': {
      const goal = findGoalById(result, rubric.goalId);
      if (!goal) {
        return {
          fixtureId,
          passed: false,
          detail: `goal missing: ${rubric.goalId}`,
        };
      }
      if (goal.status !== rubric.status) {
        return {
          fixtureId,
          passed: false,
          detail: `goal ${rubric.goalId} status ${goal.status} (expected ${rubric.status})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'ingestion_job_completed': {
      const count = countE2ECompletedIngestionJobs(result.conversationId);
      const minimum = rubric.minCount ?? 1;
      if (count < minimum) {
        return {
          fixtureId,
          passed: false,
          detail: `completed ingestion jobs ${count} (expected >= ${minimum})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'memory_episode_count': {
      const count = countE2EEpisodes(result.conversationId);
      if (count < rubric.min) {
        return {
          fixtureId,
          passed: false,
          detail: `episode count ${count} (expected >= ${rubric.min})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'native_fixture_state': {
      const snapshot = getE2ENativeMobileFixtureStateSnapshot();
      const actual = readJsonFieldAtPath(snapshot, rubric.path);
      if (!structuralValuesMatch(actual, rubric.expectedValue)) {
        return {
          fixtureId,
          passed: false,
          detail: `native fixture state ${rubric.path}=${String(actual ?? 'missing')} (expected ${rubric.expectedValue})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'working_block_token': {
      const content = readE2EWorkingBlockContent(
        result.conversationId,
        rubric.label,
        result.graphSnapshots,
      );
      if (!content.includes(rubric.token)) {
        return {
          fixtureId,
          passed: false,
          detail: `${rubric.label} missing token ${rubric.token}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'file_hash': {
      const content = readWorkspaceRelativeFile(result.conversationId, rubric.path);
      if (content === undefined) {
        return {
          fixtureId,
          passed: false,
          detail: `workspace file missing ${rubric.path}`,
        };
      }
      const algorithm = rubric.algorithm ?? 'sha256';
      if (algorithm !== 'sha256') {
        return {
          fixtureId,
          passed: false,
          detail: `unsupported hash algorithm ${algorithm}`,
        };
      }
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== rubric.expectedHash) {
        return {
          fixtureId,
          passed: false,
          detail: `file_hash ${rubric.path} expected ${rubric.expectedHash} got ${actualHash}`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'goal_criterion': {
      const goal = findGoalById(result, rubric.goalId);
      if (!goal) {
        return {
          fixtureId,
          passed: false,
          detail: `goal missing ${rubric.goalId}`,
        };
      }
      const met = isSuccessCriterionMet(goal, rubric.criterion);
      if (met !== rubric.met) {
        return {
          fixtureId,
          passed: false,
          detail: `goal ${rubric.goalId} criterion ${rubric.criterion} met=${met} (expected ${rubric.met})`,
        };
      }
      return { fixtureId, passed: true };
    }

    case 'graph_audit_observed': {
      const observedCount = hasGraphAuditObservation(
        result,
        rubric.auditType,
        rubric.detailContains,
      );
      const minimum = rubric.minCount ?? 1;
      if (observedCount < minimum) {
        return {
          fixtureId,
          passed: false,
          detail: `graph audit ${rubric.auditType} observed ${observedCount} times (expected >= ${minimum})`,
        };
      }
      return { fixtureId, passed: true };
    }

    default: {
      const exhaustive: never = rubric;
      return {
        fixtureId,
        passed: false,
        detail: `unsupported rubric: ${(exhaustive as E2ERubric).kind}`,
      };
    }
  }
}

export function evaluateE2EScenarioRubrics(
  result: E2EScenarioResult,
  rubrics: ReadonlyArray<E2ERubric>,
): AcceptanceFixtureOutcome[] {
  return rubrics.map((rubric) => evaluateE2ERubric(result, rubric));
}

export function evaluateE2EScenario(
  result: E2EScenarioResult,
  rubrics: ReadonlyArray<E2ERubric>,
): AcceptanceFixtureOutcome {
  const rubricOutcomes = evaluateE2EScenarioRubrics(result, rubrics);
  const failed = rubricOutcomes.filter((outcome) => !outcome.passed);
  if (!result.completed) {
    return {
      fixtureId: result.fixtureId,
      passed: false,
      detail: result.errors.length > 0 ? result.errors.join('; ') : 'orchestrator did not complete',
    };
  }

  if (failed.length > 0) {
    return {
      fixtureId: result.fixtureId,
      passed: false,
      detail: failed.map((outcome) => outcome.detail ?? outcome.fixtureId).join('; '),
    };
  }

  return { fixtureId: result.fixtureId, passed: true };
}
