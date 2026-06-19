// ---------------------------------------------------------------------------
// Kavi — Session tool activation fixture evaluator
// ---------------------------------------------------------------------------

import { resolveDefaultGroundedRequestScopedTools } from '../../engine/graph/turnToolSurface';
import { DEFAULT_CORE_TOOL_NAMES } from '../../engine/goals/toolSurface';
import type { AcceptanceFixtureOutcome } from './types';
import type { SessionToolActivationFixture } from './sessionToolActivationFixtures';

const DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

export async function evaluateSessionToolActivationFixture(
  fixture: SessionToolActivationFixture,
): Promise<AcceptanceFixtureOutcome> {
  const selectedTools = await resolveDefaultGroundedRequestScopedTools({
    allTools: fixture.allTools,
    observedToolNames: new Set<string>(),
    sessionActivatedToolNames: fixture.sessionActivatedToolNames,
    workingMessages: fixture.workingMessages,
  });
  const selectedNames = new Set(selectedTools.map((tool) => tool.name));

  if (fixture.expectedActivatedTools.length === 0) {
    const leaked = fixture.allTools
      .map((tool) => tool.name)
      .filter(
        (toolName) =>
          !DEFAULT_CORE_TOOL_NAMES.has(toolName) &&
          !DISCOVERY_TOOL_NAMES.has(toolName) &&
          selectedNames.has(toolName),
      );
    if (leaked.length > 0) {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: `catalog activation leaked into new user turn without session cache [${leaked.join(', ')}]`,
      };
    }
    return {
      fixtureId: fixture.id,
      passed: true,
      detail: 'catalog activation did not carry into new user turn without session cache',
    };
  }

  const missing = fixture.expectedActivatedTools.filter((toolName) => !selectedNames.has(toolName));
  if (missing.length > 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `missing session-activated tools [${missing.join(', ')}]; selected [${Array.from(selectedNames).sort().join(', ')}]`,
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
        detail: `discovery tools leaked after session cache [${leakedDiscovery.join(', ')}]`,
      };
    }
  }

  return {
    fixtureId: fixture.id,
    passed: true,
    detail: `session cache retained [${fixture.expectedActivatedTools.join(', ')}]`,
  };
}
