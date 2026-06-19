import { ToolDefinition } from '../../types/tool';

type ToolContract = NonNullable<ToolDefinition['contract']>;

function expoContract(
  patch: Partial<ToolContract> &
    Pick<ToolContract, 'capabilities' | 'resourceKinds' | 'sideEffects'>,
): ToolContract {
  return {
    category: 'expo',
    capabilities: [],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: [],
    prerequisites: [],
    providesEvidence: [],
    workflowStages: [],
    ...patch,
  };
}

export const EXPO_EAS_WORKFLOW_RUNS_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_runs',
  description:
    'List recent workflow runs for a synced Expo project. Use this after pushing a commit to the branch that contains the .eas/workflows file, or when you need the latest run id before inspecting or waiting on a workflow.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of workflow runs to return (default: 5, max: 20).',
      },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['eas_workflow_triggered', 'verification'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  }),
};

export const EXPO_EAS_WORKFLOW_STATUS_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_status',
  description:
    'Inspect a workflow run for a synced Expo project. Use this to debug the automatically triggered run from a recent commit; it returns normalized status, detailed job and step status when available, and failure log excerpts suitable for agentic debugging.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      workflowRunId: {
        type: 'string',
        description:
          'Optional workflow run id. Include this when inspecting execution evidence for a specific mutation; otherwise first list runs and correlate the desired run.',
      },
      includeJobs: {
        type: 'boolean',
        description: 'Whether to include job and step data when available (default: true).',
      },
      includeLogs: {
        type: 'boolean',
        description:
          'Whether to include failure log excerpts and attempt to resolve a log archive URL when the backend supports it (default: true). Leave this enabled for build debugging; the returned failureLogs should be treated as the primary root-cause signal.',
      },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['Expo project id or full name', 'workflow run id for exact status'],
    providesEvidence: ['eas_workflow_terminal', 'verification', 'blocker'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  }),
};

export const EXPO_EAS_WORKFLOW_WAIT_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_wait',
  description:
    'Poll an Expo or GitHub-backed workflow run until it reaches a terminal state or the timeout is hit. Use this after the repo-triggered workflow starts so the agent can stay on the monitor -> fix -> commit loop. When a build fails, inspect failureLogs first and treat missing dependency installation as the default hypothesis unless the logs show a different root cause.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      workflowRunId: {
        type: 'string',
        description:
          'Workflow run id to wait on. Required for safe waits; list and correlate runs first instead of waiting on an ambiguous latest run.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum wait time in milliseconds (default: 600000).',
      },
      pollIntervalMs: {
        type: 'number',
        description: 'Polling interval in milliseconds (default: 5000).',
      },
      includeJobs: {
        type: 'boolean',
        description: 'Whether to include job and step data in the final snapshot when available.',
      },
      includeLogs: {
        type: 'boolean',
        description:
          'Whether to include failure log excerpts and attempt to resolve a log archive URL in the final snapshot (default: true). Keep this enabled so the final result includes build-stage evidence for agentic repair loops.',
      },
    },
    required: ['projectId', 'workflowRunId'],
  },
  contract: expoContract({
    capabilities: ['monitor', 'wait', 'verify'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['Expo project id or full name', 'workflow run id for exact status'],
    providesEvidence: ['eas_workflow_terminal', 'verification', 'blocker'],
    workflowStages: ['monitor_external_execution', 'await_external_execution', 'verify_evidence'],
  }),
};

export const EXPO_EAS_GRAPHQL_TOOL: ToolDefinition = {
  name: 'expo_eas_graphql',
  description:
    'Run an authenticated raw Expo GraphQL query against expo.dev. Use this only for advanced EAS fields not covered by the normalized status and monitoring tools, such as schema introspection, branches, channels, builds, updates, submissions, deployments, and workflow internals. When projectId is omitted, the tool will try to infer the target account from common variables such as appId, fullName, or owner+slug.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The GraphQL query or mutation document to execute.' },
      variables: { type: 'object', description: 'Optional GraphQL variables object.' },
      projectId: {
        type: 'string',
        description:
          'Optional project reference used to resolve the Expo account token automatically.',
      },
      accountId: {
        type: 'string',
        description: 'Optional Expo account id used when no projectId is supplied.',
      },
    },
    required: ['query'],
  },
  contract: expoContract({
    capabilities: ['read', 'write', 'verify'],
    resourceKinds: ['expo_account', 'expo_project', 'eas_workflow'],
    sideEffects: ['remote_mutation'],
    riskHints: ['open_world', 'requires_approval'],
    prerequisites: ['Expo account token'],
    providesEvidence: ['verification', 'blocker'],
    workflowStages: ['inspect_resource', 'mutate_remote_state', 'verify_evidence'],
  }),
};

export const BUILTIN_EXPO_WORKFLOW_TOOL_DEFINITIONS: ToolDefinition[] = [
  EXPO_EAS_WORKFLOW_RUNS_TOOL,
  EXPO_EAS_WORKFLOW_STATUS_TOOL,
  EXPO_EAS_WORKFLOW_WAIT_TOOL,
  EXPO_EAS_GRAPHQL_TOOL,
];
