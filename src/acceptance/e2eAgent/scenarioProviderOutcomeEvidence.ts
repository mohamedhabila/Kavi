import type { ForegroundScenarioProviderOutcomeEvidenceRequirement } from './foregroundScenarioDriverTypes';
import type { E2EScenario } from './types';

export function resolveScenarioProviderOutcomeEvidenceRequirements(
  scenario: Pick<E2EScenario, 'rubrics'>,
): ReadonlyArray<ForegroundScenarioProviderOutcomeEvidenceRequirement> {
  const requirements = scenario.rubrics.flatMap((rubric) =>
    rubric.kind === 'turn_memory_receipt' && rubric.providerOutcome !== undefined
      ? [{ turnIndex: rubric.turnIndex, providerOutcome: rubric.providerOutcome }]
      : [],
  );
  return Array.from(
    new Map(
      requirements.map((requirement) => [
        `${requirement.turnIndex}:${requirement.providerOutcome}`,
        requirement,
      ]),
    ).values(),
  );
}
