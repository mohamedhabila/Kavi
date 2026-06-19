// ---------------------------------------------------------------------------
// Kavi — Tool surface budget fixture evaluator
// ---------------------------------------------------------------------------

import { computeContextBudget, MAX_TOOL_DEFINITION_TOKENS } from '../../services/context/budgetManager';
import { ALL_BUILTIN_TOOL_DEFINITIONS } from '../../engine/tools/builtin-definitions';
import {
  resolveGoalCapabilityToolNames,
  resolveTurnToolSurface,
} from '../../engine/goals/toolSurface';
import {
  compressToolDefinitions,
  enforceToolTokenBudget,
  estimateAllToolTokens,
} from '../../engine/tools/toolManagerTokenBudget';
import type { AcceptanceFixtureOutcome } from './types';
import type { ToolSurfaceBudgetFixture } from './toolSurfaceBudgetFixtures';

const BENCHMARK_MODEL = 'gpt-5.4';

export function evaluateToolSurfaceBudgetFixture(
  fixture: ToolSurfaceBudgetFixture,
): AcceptanceFixtureOutcome {
  const selectedTools = resolveTurnToolSurface({
    allTools: ALL_BUILTIN_TOOL_DEFINITIONS,
    goals: fixture.goals,
    pendingAsyncMonitorToolNames: new Set<string>(),
    observedToolNames: [],
    recentContinuationToolNames: new Set<string>(),
    activatedCatalogToolNames: new Set<string>(),
    includeToolCatalog: fixture.includeToolCatalog ?? false,
  });

  const pinnedToolNames = new Set(
    resolveGoalCapabilityToolNames(fixture.goals, ALL_BUILTIN_TOOL_DEFINITIONS),
  );
  const compactionOptions = { pinnedToolNames };
  const compressedTools = compressToolDefinitions(selectedTools, compactionOptions);
  const tokenEstimate = estimateAllToolTokens(compressedTools, compactionOptions);
  const toolsBudget = computeContextBudget(BENCHMARK_MODEL).toolsBudget;
  const hardCap = Math.min(toolsBudget, MAX_TOOL_DEFINITION_TOKENS);

  if (tokenEstimate > hardCap) {
    const enforced = enforceToolTokenBudget(compressedTools, hardCap, {
      pinnedToolNames: Array.from(pinnedToolNames),
    });
    const enforcedTokens = estimateAllToolTokens(enforced, compactionOptions);
    if (enforcedTokens > hardCap) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: `tool surface ${tokenEstimate} tokens; enforced ${enforcedTokens} still exceeds ${hardCap}`,
      };
    }
  }

  if (selectedTools.length === 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: 'turn surface selected zero tools',
    };
  }

  return {
    fixtureId: fixture.id,
    passed: true,
    detail: `tools=${selectedTools.length},tokens=${tokenEstimate},cap=${hardCap}`,
  };
}
