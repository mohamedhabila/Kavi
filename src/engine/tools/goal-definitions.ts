// ---------------------------------------------------------------------------
// Kavi — Goal Management Tool Definitions
// ---------------------------------------------------------------------------
// The update_goals tool lets the model mutate the active goal set during an
// agent run. Mutations are applied by the graph outcome resolver so the graph
// snapshot remains the single source of truth.
// ---------------------------------------------------------------------------

import { formatSuccessCriteriaFormsDescription } from '../goals/completionEvidence';
import type { ToolDefinition } from '../../types/tool';

export const UPDATE_GOALS_TOOL: ToolDefinition = {
  name: 'update_goals',
  description:
    'Add, complete, activate, block, update, or remove goals from the active goal set. ' +
    "Goals are high-level intentions that guide the agent's work. " +
    'Use this tool to track progress, mark blockers, or replan when conditions change. ' +
    'Dependencies must be completed before a goal can be activated. ' +
    'Removing a goal automatically removes any goals that depend on it.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'complete', 'activate', 'block', 'remove', 'update'],
        description: 'Mutation action to perform.',
      },
      id: {
        type: 'string',
        description:
          'Stable goal ID. Required for all actions. Use a short structural ID when adding a new goal.',
      },
      name: {
        type: 'string',
        description:
          'Human-readable goal name. Required for every call; repeat the visible goal name for existing-goal mutations.',
      },
      description: {
        type: 'string',
        description: 'Optional detailed description of the goal.',
      },
      status: {
        type: 'string',
        enum: ['pending', 'active', 'completed', 'blocked'],
        description: 'Goal status. Used for add and update.',
      },
      completionPolicy: {
        type: 'string',
        enum: ['blocking', 'persistent'],
        description:
          'Required for add. Use blocking for finite deliverables that must be completed before finalization; use persistent for ongoing focus or memory scopes that should remain active.',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of goals that must be completed before this goal can be activated.',
      },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional evidence strings to append.',
      },
      requiredCapabilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional capability tags that hint which tools are relevant to this goal.',
      },
      requiredResourceKinds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional resource-kind tags that narrow requiredCapabilities to matching tool contract resources.',
      },
      owner: {
        type: 'string',
        description: 'Optional owner identifier, e.g. "supervisor" or a worker session ID.',
      },
      successCriteria: {
        type: 'array',
        items: {
          type: 'string',
          description:
            'Structural completion criterion. evidence.prefix tokens must reference registered evidence sources such as tool names or worker.',
        },
        description: `Blocking deliverables only. Omit for persistent focus goals. Structural completion tokens for this goal. Supported forms: ${formatSuccessCriteriaFormsDescription()}.`,
      },
      blockedReason: {
        type: 'string',
        description: 'Optional blocker reason when status is blocked.',
      },
    },
    required: ['action', 'id', 'name'],
  },
  strict: true,
  contract: {
    category: 'goal',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
};
