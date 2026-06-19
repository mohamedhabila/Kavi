import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import type { SubAgentSnapshot } from '../../types/subAgent';
import type { SubAgentOrchestratorCallbackParams } from './subAgentOrchestratorCallbackTypes';
import { createSubAgentOrchestratorProgressCallbacks } from './subAgentOrchestratorProgressCallbacks';
import { createSubAgentOrchestratorToolCallbacks } from './subAgentOrchestratorToolCallbacks';

export type { SubAgentExecutionRuntimeState } from './subAgentOrchestratorCallbackTypes';

export function createSubAgentOrchestratorCallbacks<TAgent extends SubAgentSnapshot>(
  params: SubAgentOrchestratorCallbackParams<TAgent>,
): OrchestratorCallbacks {
  return {
    ...createSubAgentOrchestratorProgressCallbacks(params),
    ...createSubAgentOrchestratorToolCallbacks(params),
  };
}
