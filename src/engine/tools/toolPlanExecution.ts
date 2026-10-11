// ---------------------------------------------------------------------------
// Kavi — update_plan executor
// ---------------------------------------------------------------------------
// Checks the call's shape and answers. The graph applies the plan when it canonicalizes
// the outcome, so the graph snapshot stays the one owner of run state.
// ---------------------------------------------------------------------------

import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { parseUpdatePlanArguments } from '../plan/agentPlan';

export const PLAN_UPDATED_RESULT = 'Plan updated';

export function executeUpdatePlan(args: unknown): ToolRuntimeOutcome {
  const parsed = parseUpdatePlanArguments(args);
  return 'error' in parsed
    ? failedToolOutcome(parsed.error, 'invalid_arguments')
    : completedToolOutcome(PLAN_UPDATED_RESULT);
}
