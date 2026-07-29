import { normalizeToolName } from '../tools/toolNameNormalization';
import { isSessionCoordinationToolName } from '../tools/sessionToolKinds';

export interface AgentExecutionTurnContract {
  allowSessionCoordinationTools: boolean;
}

export function resolveAgentExecutionTurnContract(params: {
  groundedToolNames: Iterable<string>;
}): AgentExecutionTurnContract {
  const groundedNames = new Set(
    Array.from(params.groundedToolNames)
      .map((value) => normalizeToolName(value))
      .filter(Boolean),
  );

  return {
    // The grounded surface is already policy-authorized and mode-scoped. Basing this gate on
    // that structural result avoids a second prompt-language classifier and keeps catalog- or
    // workflow-activated coordination tools callable.
    allowSessionCoordinationTools: Array.from(groundedNames).some(isSessionCoordinationToolName),
  };
}
