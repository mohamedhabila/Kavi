import {
  estimateE2EEligibleCacheReadStats,
  estimateE2EProviderManagedCacheReadinessTokens,
} from './evaluateE2EAgentMetrics';
import { lookupE2EScenarioBenchmarkMeta } from './e2eBenchmarkRegistry';
import { safeRate } from './e2eRunReportMath';
import type {
  E2ERunReportRubricAuditRisk,
  E2ERunReportScenarioCache,
  E2ERunReportScenarioEntry,
  E2ERunReportScenarioLoopDiagnostics,
  E2ERunReportScenarioRubricAudit,
} from './e2eRunReport';
import { buildE2EScenarioTraceSummary } from './e2eTraceArtifacts';
import { evaluateE2EScenarioRubrics } from './rubricEvaluators';
import type { E2ERubric, E2EScenarioResult, E2ETokenUsageSummary } from './types';
import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type { UsageTokenBuckets } from '../../types/usage';

const ASSISTANT_PROSE_RUBRIC_KIND_HINTS = new Set([
  'assistant_text',
  'assistant_contains',
  'assistant_regex',
  'final_text',
  'final_response',
  'response_contains',
]);

const WEAK_PATTERN_RUBRIC_KIND_HINTS = new Set(['regex', 'pattern', 'text_match']);

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash.toString(36);
}

function emptyUsageTokenBuckets(): UsageTokenBuckets {
  return {
    systemPromptTokens: 0,
    toolDeclarationTokens: 0,
    memoryContextTokens: 0,
    conversationHistoryTokens: 0,
    userTurnTokens: 0,
    toolResultTokens: 0,
  };
}

function resolveUsageTokenBuckets(usage: E2ETokenUsageSummary): UsageTokenBuckets {
  return usage.tokenBuckets ? { ...usage.tokenBuckets } : emptyUsageTokenBuckets();
}

function buildGoalEvidenceFingerprints(result: E2EScenarioResult): string[] {
  return result.graphSnapshots
    .map((snapshot) =>
      (snapshot.goals ?? [])
        .map((goal) => `${goal.id}:${goal.status}:${goal.evidence.join('|')}`)
        .sort()
        .join(';'),
    )
    .filter(Boolean);
}

function countCatalogResultsAfterActivation(result: E2EScenarioResult): number {
  const seenCatalogResultIds = new Set<string>();
  let activationSeen = false;
  let count = 0;

  for (const snapshot of result.graphSnapshots) {
    for (const toolResult of snapshot.observedToolResults ?? []) {
      if (toolResult.name !== 'tool_catalog' || seenCatalogResultIds.has(toolResult.id)) {
        continue;
      }
      seenCatalogResultIds.add(toolResult.id);
      if (activationSeen) {
        count += 1;
      }
    }

    if ((snapshot.sessionActivatedToolNames ?? []).length > 0) {
      activationSeen = true;
    }
  }

  return count;
}

function countHoldReasonEpisodes(
  snapshots: ReadonlyArray<E2EScenarioResult['graphSnapshots'][number]>,
): Map<string, number> {
  const holdReasonCounts = new Map<string, number>();
  let previousReason = '';

  for (const snapshot of snapshots) {
    const reason = snapshot.finalizationHoldReason?.trim() ?? '';
    if (!reason) {
      previousReason = '';
      continue;
    }
    if (reason === previousReason) {
      continue;
    }
    previousReason = reason;
    holdReasonCounts.set(reason, (holdReasonCounts.get(reason) ?? 0) + 1);
  }

  return holdReasonCounts;
}

function buildScenarioLoopDiagnostics(
  result: E2EScenarioResult,
): E2ERunReportScenarioLoopDiagnostics {
  const toolCounts = new Map<string, { name: string; argsHash: string; count: number }>();
  for (const call of result.toolCalls) {
    const name = call.name.trim();
    const argsHash = stableHash(call.arguments || '{}');
    const key = `${name}:${argsHash}`;
    const existing = toolCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      toolCounts.set(key, { name, argsHash, count: 1 });
    }
  }

  const evidenceFingerprints = buildGoalEvidenceFingerprints(result);
  const noNewEvidence =
    evidenceFingerprints.length === 0 || new Set(evidenceFingerprints).size <= 1;
  const repeatedToolCalls = Array.from(toolCounts.values())
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      ...entry,
      noNewEvidence,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.argsHash.localeCompare(right.argsHash),
    );

  const repeatedCatalogAfterActivationCount = countCatalogResultsAfterActivation(result);
  const holdReasonCounts = countHoldReasonEpisodes(result.graphSnapshots);
  const repeatedHoldReasons = Array.from(holdReasonCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));

  return {
    repeatedToolCalls,
    repeatedCatalogAfterActivationCount,
    repeatedHoldReasons,
    passing:
      repeatedCatalogAfterActivationCount === 0 &&
      repeatedToolCalls.every((entry) => !entry.noNewEvidence || entry.count < 3) &&
      repeatedHoldReasons.every((entry) => entry.count < 3),
  };
}

function buildScenarioCacheSummary(result: E2EScenarioResult): E2ERunReportScenarioCache {
  const eligibleStats = estimateE2EEligibleCacheReadStats(result);
  const eligibleInputTokens = eligibleStats.eligibleInputTokens;
  const providerManagedReadinessTokens = estimateE2EProviderManagedCacheReadinessTokens(result);
  return {
    inputTokens: result.usage.inputTokens,
    eligibleInputTokens,
    providerManagedReadinessTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    cacheReadRate: safeRate(result.usage.cacheReadTokens, result.usage.inputTokens),
    eligibleCacheReadRate: safeRate(eligibleStats.eligibleCacheReadTokens, eligibleInputTokens),
    eligible: eligibleInputTokens > 0,
  };
}

function buildRubricAudit(
  rubrics: ReadonlyArray<E2ERubric> | undefined,
): E2ERunReportScenarioRubricAudit {
  const risks: E2ERunReportRubricAuditRisk[] = [];
  let assistantProseRubricCount = 0;
  let weakPatternRubricCount = 0;
  let structuralSubstringRubricCount = 0;

  for (const rubric of rubrics ?? []) {
    const rubricKind = String((rubric as { kind: string }).kind);
    if (ASSISTANT_PROSE_RUBRIC_KIND_HINTS.has(rubricKind)) {
      assistantProseRubricCount += 1;
      risks.push({
        rubricKind,
        reason: 'assistant-prose grader is not benchmark-grade evidence',
      });
    }
    if (WEAK_PATTERN_RUBRIC_KIND_HINTS.has(rubricKind)) {
      weakPatternRubricCount += 1;
      risks.push({
        rubricKind,
        reason: 'pattern-matching grader is not structural evidence',
      });
    }
    if (
      (rubric.kind === 'workspace_file' && Boolean(rubric.contains)) ||
      rubric.kind === 'working_block_token' ||
      (rubric.kind === 'graph_audit_observed' && Boolean(rubric.detailContains))
    ) {
      structuralSubstringRubricCount += 1;
    }
  }

  return {
    rubricCount: rubrics?.length ?? 0,
    assistantProseRubricCount,
    weakPatternRubricCount,
    structuralSubstringRubricCount,
    risks,
  };
}

function buildRubricSummary(
  result: E2EScenarioResult,
  rubrics: ReadonlyArray<E2ERubric> | undefined,
): Pick<E2ERunReportScenarioEntry, 'rubricPassed' | 'rubricTotal' | 'failedRubrics'> {
  if (!rubrics?.length) {
    return {};
  }
  const rubricOutcomes = evaluateE2EScenarioRubrics(result, rubrics);
  const failedRubrics = rubricOutcomes
    .filter((outcome) => !outcome.passed)
    .map((outcome) => ({
      fixtureId: outcome.fixtureId,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    }));
  return {
    rubricPassed: rubricOutcomes.filter((outcome) => outcome.passed).length,
    rubricTotal: rubricOutcomes.length,
    ...(failedRubrics.length > 0 ? { failedRubrics } : {}),
  };
}

export function buildE2ERunReportScenarioEntry(params: {
  suite: string;
  result: E2EScenarioResult;
  outcome: AcceptanceFixtureOutcome;
  attemptCount: number;
  rubrics?: ReadonlyArray<E2ERubric>;
}): E2ERunReportScenarioEntry {
  const lastGraph = params.result.graphSnapshots[params.result.graphSnapshots.length - 1];
  const benchmarkMeta = lookupE2EScenarioBenchmarkMeta(params.result.fixtureId);
  return {
    suite: params.suite,
    fixtureId: params.result.fixtureId,
    passed: params.outcome.passed,
    attemptCount: params.attemptCount,
    durationMs: params.result.durationMs,
    completed: params.result.completed,
    userTurnCount: params.result.userTurnCount,
    toolCallCount: params.result.toolCalls.length,
    turnCount: params.result.turnTraces?.length ?? params.result.userTurnCount,
    graphStatus: lastGraph?.status ?? null,
    usage: params.result.usage,
    tokenBuckets: resolveUsageTokenBuckets(params.result.usage),
    cache: buildScenarioCacheSummary(params.result),
    ...(params.result.usage.promptCache ? { promptCache: params.result.usage.promptCache } : {}),
    loopDiagnostics: buildScenarioLoopDiagnostics(params.result),
    benchmarkFamilies: [...benchmarkMeta.benchmarkFamilies],
    assessmentDimensions: [...benchmarkMeta.assessmentDimensions],
    ...buildRubricSummary(params.result, params.rubrics),
    rubricAudit: buildRubricAudit(params.rubrics),
    trace: buildE2EScenarioTraceSummary({
      result: params.result,
      rubrics: params.rubrics,
    }),
    ...(params.outcome.detail ? { detail: params.outcome.detail } : {}),
    errors: params.result.errors,
  };
}
