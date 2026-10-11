// ---------------------------------------------------------------------------
// Kavi — update_plan tool definition
// ---------------------------------------------------------------------------
// The model's checklist for multi-step work, in the shape Codex's update_plan uses. The
// graph stores the plan and shows it back each turn; nothing gates on it.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { MAX_AGENT_PLAN_STEPS } from '../plan/agentPlan';

export const UPDATE_PLAN_TOOL_NAME = 'update_plan';

export const UPDATE_PLAN_TOOL: ToolDefinition = {
  name: UPDATE_PLAN_TOOL_NAME,
  description:
    'Updates the task plan: the full list of steps, each with a status. Use it for work ' +
    'with several steps, and skip it for a request one step answers. At most one step ' +
    'can be in_progress at a time; mark steps completed as they finish. Each call ' +
    'replaces the whole plan.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      explanation: {
        type: 'string',
        description: 'Optional explanation for this plan update.',
      },
      plan: {
        type: 'array',
        maxItems: MAX_AGENT_PLAN_STEPS,
        description: 'The list of steps.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', description: 'Task step text.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Step status.',
            },
          },
          required: ['step', 'status'],
        },
      },
    },
    required: ['plan'],
  },
  contract: {
    category: 'plan',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: [],
    workflowStages: [],
  },
};
