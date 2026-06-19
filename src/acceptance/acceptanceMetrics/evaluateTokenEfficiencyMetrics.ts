// ---------------------------------------------------------------------------
// Kavi — Token efficiency acceptance metrics
// ---------------------------------------------------------------------------

import { ALL_BUILTIN_TOOL_DEFINITIONS } from '../../engine/tools/builtin-definitions';
import { resolveTurnToolSurface } from '../../engine/goals/toolSurface';
import {
  compactToolDefinitionForPrompt,
  compressToolDescription,
  compressToolDefinitions,
  estimateAllToolTokens,
  estimateToolTokens,
} from '../../engine/tools/toolManagerTokenBudget';
import type { ToolDefinition } from '../../types/tool';
import {
  aggregateAcceptanceMetrics,
  buildPassRateSummary,
  isSummaryPassing,
} from './aggregateResults';
import { evaluateCompactionRecallFixture } from './evaluateCompactionRecallFixture';
import { evaluateToolSurfaceBudgetFixture } from './evaluateToolSurfaceBudgetFixture';
import { COMPACTION_RECALL_FIXTURES } from './compactionRecallFixtures';
import { TOOL_SURFACE_BUDGET_FIXTURES } from './toolSurfaceBudgetFixtures';
import type {
  AcceptanceFixtureOutcome,
  AcceptanceMetricEvaluation,
  AcceptanceMetricSummary,
} from './types';
import {
  TOOL_DEFINITION_TOKEN_REDUCTION_MIN_RATE,
  TOOL_SURFACE_BUDGET_MIN_PASS_RATE,
  COMPACTION_RECALL_MIN_PASS_RATE,
} from './thresholds';

function estimateLegacyPromptFacingToolTokens(tools: ReadonlyArray<ToolDefinition>): number {
  let total = 0;
  for (const tool of tools) {
    const legacyCompacted: ToolDefinition = {
      ...tool,
      description: compressToolDescription(tool.description || ''),
      input_schema: compactToolDefinitionForPrompt(tool).input_schema,
    };
    total += estimateToolTokens(legacyCompacted, { precompacted: true });
  }
  return total;
}

export function evaluateToolDefinitionTokenReductionBenchmark(): AcceptanceFixtureOutcome {
  const surface = resolveTurnToolSurface({
    allTools: ALL_BUILTIN_TOOL_DEFINITIONS,
    goals: [
      {
        id: 'benchmark-goal',
        title: 'benchmark-task',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['read', 'write', 'discover'],
        successCriteria: ['evidence.min:1'],
      },
    ],
    pendingAsyncMonitorToolNames: new Set<string>(),
    observedToolNames: ['mcp__docs__search_docs', 'skill__weather__forecast'],
    recentContinuationToolNames: new Set(['browser_navigate']),
    activatedCatalogToolNames: new Set(['pdf_read']),
    includeToolCatalog: true,
  });

  const pinnedToolNames = new Set(['web_search', 'write_file', 'read_file']);
  const optimizedTokens = estimateAllToolTokens(
    compressToolDefinitions(surface, { pinnedToolNames }),
    { pinnedToolNames },
  );
  const legacyTokens = estimateLegacyPromptFacingToolTokens(surface);

  if (legacyTokens <= 0) {
    return {
      fixtureId: 'tool-definition-token-reduction',
      passed: false,
      detail: 'legacy token baseline is zero',
    };
  }

  const reductionRate = (legacyTokens - optimizedTokens) / legacyTokens;
  if (reductionRate < TOOL_DEFINITION_TOKEN_REDUCTION_MIN_RATE) {
    return {
      fixtureId: 'tool-definition-token-reduction',
      passed: false,
      detail: `reduction ${(reductionRate * 100).toFixed(1)}% < ${(TOOL_DEFINITION_TOKEN_REDUCTION_MIN_RATE * 100).toFixed(0)}% (${legacyTokens} -> ${optimizedTokens})`,
    };
  }

  return {
    fixtureId: 'tool-definition-token-reduction',
    passed: true,
    detail: `reduction ${(reductionRate * 100).toFixed(1)}% (${legacyTokens} -> ${optimizedTokens})`,
  };
}

export function evaluateToolSurfaceBudgetOutcomes(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
): AcceptanceMetricSummary {
  return buildPassRateSummary({
    metricId: 'tool-surface-budget',
    label: 'Turn surface token estimate within budget',
    outcomes,
    targetRate: TOOL_SURFACE_BUDGET_MIN_PASS_RATE,
    comparator: 'min',
  });
}

export function evaluateCompactionRecallOutcomes(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
): AcceptanceMetricSummary {
  return buildPassRateSummary({
    metricId: 'compaction-recall',
    label: 'Goals and profile blocks survive aggressive compaction',
    outcomes,
    targetRate: COMPACTION_RECALL_MIN_PASS_RATE,
    comparator: 'min',
  });
}

export function evaluateTokenEfficiencyMetricOutcomes(): AcceptanceMetricEvaluation {
  const toolSurfaceOutcomes = TOOL_SURFACE_BUDGET_FIXTURES.map(evaluateToolSurfaceBudgetFixture);
  const compactionOutcomes = COMPACTION_RECALL_FIXTURES.map(evaluateCompactionRecallFixture);
  const reductionOutcome = evaluateToolDefinitionTokenReductionBenchmark();

  const summaries = [
    evaluateToolSurfaceBudgetOutcomes(toolSurfaceOutcomes),
    evaluateCompactionRecallOutcomes(compactionOutcomes),
    buildPassRateSummary({
      metricId: 'tool-definition-token-reduction',
      label: 'Median tool-definition token reduction benchmark',
      outcomes: [reductionOutcome],
      targetRate: 1,
      comparator: 'min',
    }),
  ];

  return aggregateAcceptanceMetrics(summaries);
}

export function isTokenEfficiencyMetricsPassing(evaluation: AcceptanceMetricEvaluation): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}
