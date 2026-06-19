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

export const EXPO_EAS_CREATE_PROJECT_TOOL: ToolDefinition = {
  name: 'expo_eas_create_project',
  description:
    'Create an Expo/EAS project record in a linked Expo account. This tool first resolves existing linked projects and redirects to them unless confirmedCreateNewProject is true. Use creation only when project resolution proves no suitable project exists or the user explicitly asks for a separate new Expo project. After creation, the default production path is to connect the GitHub repo, add .eas/workflows/*.yml on the target branch, push a commit, and monitor the auto-triggered workflow instead of manually dispatching Expo actions.',
  input_schema: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description:
          'Optional linked Expo account ID. Omit when exactly one Expo account is linked.',
      },
      name: { type: 'string', description: 'Human-readable project name.' },
      slug: {
        type: 'string',
        description:
          'Optional Expo/EAS project slug. When omitted, a slug is derived from the name.',
      },
      confirmedCreateNewProject: {
        type: 'boolean',
        description:
          'Set true only after confirming no suitable existing linked Expo project should be used, or when the user explicitly requested a separate new Expo project.',
      },
    },
    required: ['name'],
  },
  contract: expoContract({
    capabilities: ['write'],
    resourceKinds: ['expo_account', 'expo_project'],
    sideEffects: ['remote_mutation'],
    riskHints: ['requires_approval'],
    prerequisites: ['linked Expo account', 'confirmed no suitable existing Expo project'],
    providesEvidence: ['expo_project'],
    workflowStages: ['guarded_resource_creation', 'mutate_remote_state'],
  }),
};

export const EXPO_EAS_LIST_PROJECTS_TOOL: ToolDefinition = {
  name: 'expo_eas_list_projects',
  description:
    'List linked Expo/EAS projects and their automation readiness. Call this once to discover projectId values, then move to expo_eas_status or expo_eas_probe. Do not repeat it with the same arguments unless you need refresh=true or a different account. For GitHub-linked projects, prefer repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring instead of manual Expo action tools.',
  input_schema: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description: 'Optional linked Expo account ID to limit results.',
      },
      refresh: {
        type: 'boolean',
        description: 'When true, refresh linked account projects from Expo before listing them.',
      },
    },
    required: [],
  },
  contract: expoContract({
    capabilities: ['discover', 'read'],
    resourceKinds: ['expo_account', 'expo_project'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['linked Expo account'],
    providesEvidence: ['expo_project'],
    workflowStages: ['discover_resource'],
  }),
};

export const EXPO_EAS_STATUS_TOOL: ToolDefinition = {
  name: 'expo_eas_status',
  description:
    'Inspect a synced Expo/EAS project, returning linked account, execution mode, readiness, and automation metadata. Use this before deployment work to verify the repo link, workflow file, branch, and the commit-driven EAS Workflows path.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    capabilities: ['read', 'verify'],
    resourceKinds: ['expo_project'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['expo_project', 'expo_project_ready'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const EXPO_EAS_PROBE_TOOL: ToolDefinition = {
  name: 'expo_eas_probe',
  description:
    'Validate that a synced Expo/EAS project is actually runnable. In Expo workflow mode this checks the linked repo and .eas/workflows automation so agents can rely on commit-driven runs; direct SSH and GitHub workflow modes are fallbacks.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    capabilities: ['verify'],
    resourceKinds: ['expo_project', 'eas_workflow', 'github_repo'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['expo_project_ready', 'verification', 'blocker'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  }),
};

export const EXPO_EAS_BUILD_TOOL: ToolDefinition = {
  name: 'expo_eas_build',
  description:
    'Manually trigger an Expo EAS build for a synced project. Use this only when the user explicitly wants a manual rerun, backfill, no-commit execution, or when commit-triggered automation is unavailable. For normal GitHub-linked projects, edit the repo, ensure .eas/workflows/*.yml exists on the branch, push a commit, and monitor the auto-triggered workflow with expo_eas_workflow_* tools.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      platform: { type: 'string', description: 'android, ios, or all. Defaults to android.' },
      profile: { type: 'string', description: 'Optional EAS build profile.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    category: 'expo_manual_actions',
    capabilities: ['deploy', 'monitor'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['external_run'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['external_run', 'verification'],
  }),
};

export const EXPO_EAS_UPDATE_TOOL: ToolDefinition = {
  name: 'expo_eas_update',
  description:
    'Manually trigger an Expo EAS update for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. The default GitHub-linked path is repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      branch: {
        type: 'string',
        description: 'Optional update branch. Defaults to the project default update branch.',
      },
      message: { type: 'string', description: 'Optional update message.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    category: 'expo_manual_actions',
    capabilities: ['deploy', 'monitor'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['external_run'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['external_run', 'verification'],
  }),
};

export const EXPO_EAS_SUBMIT_TOOL: ToolDefinition = {
  name: 'expo_eas_submit',
  description:
    'Manually trigger an Expo EAS submit for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. The default GitHub-linked path is repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      platform: { type: 'string', description: 'android or ios. Defaults to android.' },
      profile: { type: 'string', description: 'Optional EAS submit profile.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    category: 'expo_manual_actions',
    capabilities: ['deploy', 'monitor'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['external_run'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['external_run', 'verification'],
  }),
};

export const EXPO_EAS_DEPLOY_WEB_TOOL: ToolDefinition = {
  name: 'expo_eas_deploy_web',
  description:
    'Manually trigger an Expo web hosting deploy for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. If the target branch already carries .eas/workflows/deploy.yml, prefer committing the repo change and monitoring the automatically triggered run instead of calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      alias: {
        type: 'string',
        description: 'Optional hosting alias, such as production or preview.',
      },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
  contract: expoContract({
    category: 'expo_manual_actions',
    capabilities: ['deploy', 'monitor'],
    resourceKinds: ['expo_project', 'eas_workflow'],
    sideEffects: ['external_run'],
    prerequisites: ['Expo project id or full name'],
    providesEvidence: ['external_run', 'verification'],
  }),
};

export const BUILTIN_EXPO_PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [
  EXPO_EAS_CREATE_PROJECT_TOOL,
  EXPO_EAS_LIST_PROJECTS_TOOL,
  EXPO_EAS_STATUS_TOOL,
  EXPO_EAS_PROBE_TOOL,
  EXPO_EAS_BUILD_TOOL,
  EXPO_EAS_UPDATE_TOOL,
  EXPO_EAS_SUBMIT_TOOL,
  EXPO_EAS_DEPLOY_WEB_TOOL,
];
