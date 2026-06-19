// ---------------------------------------------------------------------------
// Kavi — Tool catalog discovery fixture evaluator
// ---------------------------------------------------------------------------

import { resolveDefaultGroundedRequestScopedTools } from '../../engine/graph/turnToolSurface';
import type { AcceptanceFixtureOutcome } from './types';
import type { ToolCatalogDiscoveryFixture } from './toolCatalogDiscoveryFixtures';

export async function evaluateToolCatalogDiscoveryFixture(
  fixture: ToolCatalogDiscoveryFixture,
): Promise<AcceptanceFixtureOutcome> {
  const selectedTools = await resolveDefaultGroundedRequestScopedTools({
    allTools: fixture.allTools,
    observedToolNames: new Set<string>(),
    workingMessages: fixture.workingMessages,
  });
  const selectedNames = new Set(selectedTools.map((tool) => tool.name));
  const missing = fixture.expectedActivatedTools.filter((toolName) => !selectedNames.has(toolName));

  if (missing.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `missing activated tools [${missing.join(', ')}]; selected [${Array.from(selectedNames).sort().join(', ')}]`,
    };
  }

  if (fixture.expectDiscoveryToolsAbsent) {
    const leakedDiscovery = ['tool_catalog', 'tool_describe'].filter((toolName) =>
      selectedNames.has(toolName),
    );
    if (leakedDiscovery.length > 0) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: `discovery tools remained after activation [${leakedDiscovery.join(', ')}]`,
      };
    }
  }

  if (!fixture.expectDiscoveryToolsAbsent && !selectedNames.has('tool_catalog')) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: 'tool_catalog missing from discovery turn surface',
    };
  }

  return {
    fixtureId: fixture.id,
    passed: true,
    detail: `activated [${fixture.expectedActivatedTools.join(', ')}]`,
  };
}
