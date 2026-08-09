// ---------------------------------------------------------------------------
// Kavi — Goal Management Tool Definitions
// ---------------------------------------------------------------------------
// The update_goals tool lets the model mutate the active goal set during an
// agent run. Mutations are applied by the graph outcome resolver so the graph
// snapshot remains the single source of truth.
// ---------------------------------------------------------------------------

import { formatModelAuthoredSuccessCriteriaFormsDescription } from '../goals/completionEvidence';
import type { ToolDefinition } from '../../types/tool';

export const UPDATE_GOALS_TOOL: ToolDefinition = {
  name: 'update_goals',
  description:
    'Add, complete, activate, block, update, or remove goals from the active goal set. ' +
    "Goals are high-level intentions that guide the agent's work. " +
    'Pass a `goals` array to change several goals in ONE call — declaring a plan or closing ' +
    'it is a single call, never one call per goal. Set `status` on each entry so a separate ' +
    'activate is never needed. Example: ' +
    '{"action":"add","goals":[{"id":"study","name":"Study","status":"active",' +
    '"completionPolicy":"blocking","successCriteria":["evidence.artifact:artifacts/out.md"]},' +
    '{"id":"worker","name":"Worker","status":"active","completionPolicy":"blocking",' +
    '"owner":"delegated-worker","requiredCapabilities":["coordinate"],' +
    '"successCriteria":["evidence.prefix:worker","evidence.min:1"]}]} — then close both with ' +
    '{"action":"complete","goals":[{"id":"worker"},{"id":"study"}]}. ' +
    'A single-goal change may instead use the flat root fields. ' +
    'Note that every field is listed as required by the provider schema: send null for any ' +
    'field you are not using, and send `goals` as null when using the flat root form. ' +
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
          'Human-readable goal name. Required for add; optional for mutations of an existing goal.',
      },
      description: {
        type: 'string',
        description: 'Optional detailed description of the goal.',
      },
      status: {
        type: 'string',
        enum: ['pending', 'active', 'completed', 'blocked'],
        description:
          'Goal status. Used for add and update. Set "active" on the add itself when you ' +
          'are starting the work now — a separate activate call is not needed. A goal is ' +
          'always created open; it closes when its success criteria are met.',
      },
      completionPolicy: {
        type: 'string',
        enum: ['blocking', 'persistent'],
        description:
          'Optional. Use blocking for finite deliverables that must be completed before finalization; use persistent for ongoing focus or memory scopes that should remain active. When omitted it is derived from successCriteria: blocking when a specific structural criterion is present, otherwise persistent.',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of goals that must be completed before this goal can be activated.',
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
            'Structural completion criterion. For a workspace deliverable use evidence.artifact:<exact-workspace-relative-path>, never evidence.prefix:artifact. evidence.prefix tokens must reference registered evidence sources such as tool names or worker.',
        },
        description: `Blocking deliverables only. Omit for persistent focus goals. Include at least one specific criterion; evidence.min and evidence.count cannot stand alone. For workspace files, use one evidence.artifact:<exact-workspace-relative-path> criterion per required file. Supported forms: ${formatModelAuthoredSuccessCriteriaFormsDescription()}.`,
      },
      retainCurrentUserConstraint: {
        type: 'boolean',
        enum: [true],
        description:
          'Add or update incomplete blocking goals only. When true, code captures the entire normalized current user message with code-owned source identity. The retained statement constrains execution but never authorizes effects, proves completion, or counts as evidence.',
      },
      blockedReason: {
        type: 'string',
        description: 'Optional blocker reason when status is blocked.',
      },
      goals: {
        type: 'array',
        description:
          'Optional batch: several goals under one action, each entry taking the same ' +
          'fields as a single call. Declare a whole plan in one call — for example add ' +
          'the deliverable goal as "active" alongside its worker goal — and close a plan ' +
          'with one complete. Omit this when mutating a single goal.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'complete', 'activate', 'block', 'remove', 'update'],
              description: 'Optional per-goal action. Defaults to the top-level action.',
            },
            id: { type: 'string', description: 'Stable goal ID.' },
            name: { type: 'string', description: 'Human-readable goal name. Required for add.' },
            description: { type: 'string', description: 'Optional detailed description.' },
            status: {
              type: 'string',
              enum: ['pending', 'active', 'completed', 'blocked'],
              description: 'Goal status. Set "active" on the add itself to start it now.',
            },
            completionPolicy: {
              type: 'string',
              enum: ['blocking', 'persistent'],
              description: 'Whether the goal gates completion or tracks ongoing focus.',
            },
            successCriteria: {
              type: 'array',
              items: { type: 'string' },
              description: 'Structural criteria that close the goal.',
            },
            owner: { type: 'string', description: 'Optional goal owner.' },
            requiredCapabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional capabilities the goal needs.',
            },
            blockedReason: { type: 'string', description: 'Why the goal is blocked.' },
          },
          required: ['id'],
        },
      },
    },
    required: ['action'],
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
