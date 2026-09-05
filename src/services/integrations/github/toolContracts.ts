import { secretRuntimeRequirement, type ToolDefinition } from '../../../types/tool';

type ToolContract = NonNullable<ToolDefinition['contract']>;

// Every GitHub tool calls the GitHub API directly and fails without a token, so each
// contract's runtimeRequirements below also gates on the secret alongside developer_mode.
const GITHUB_TOKEN_REQUIREMENT = secretRuntimeRequirement('GITHUB_TOKEN');

const GITHUB_COMMIT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    repo: { type: 'string' },
    branch: { type: 'string' },
    commitSha: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
  },
};

const GITHUB_TOOL_CONTRACTS: Record<string, ToolContract> = {
  repos: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['discover'],
    resourceKinds: ['github_repo'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with repository read access'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource'],
  },
  branches: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['discover', 'read'],
    resourceKinds: ['github_repo', 'github_branch'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with repository read access', 'repo full name'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
  },
  list_files: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['discover', 'read'],
    resourceKinds: ['github_repo'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with repository read access', 'repo full name'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
  },
  read_file: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['read'],
    resourceKinds: ['github_repo'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with repository read access', 'repo full name'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource'],
  },
  create_branch: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['write'],
    resourceKinds: ['github_repo', 'github_branch'],
    sideEffects: ['remote_mutation'],
    prerequisites: ['github token with contents:write', 'repo full name'],
    providesEvidence: ['github_branch'],
    workflowStages: ['mutate_remote_state', 'verify_evidence'],
  },
  commit_files: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['write', 'commit', 'push'],
    resourceKinds: ['github_repo', 'github_branch', 'conversation_workspace'],
    sideEffects: ['remote_mutation'],
    riskHints: ['requires_approval'],
    prerequisites: ['github token with contents:write', 'repo full name', 'target branch'],
    providesEvidence: ['github_commit', 'github_push'],
    workflowStages: ['persist_artifact', 'mutate_remote_state', 'verify_evidence'],
    inputExamples: [
      {
        repo: 'owner/repo',
        branch: 'main',
        message: 'Add Expo web app',
        changes: [{ path: 'package.json', filePath: '/package.json' }],
      },
    ],
    outputSchema: GITHUB_COMMIT_OUTPUT_SCHEMA,
  },
  issues: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['read'],
    resourceKinds: ['github_repo'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with issues:read', 'repo full name'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  },
  create_issue: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['write'],
    resourceKinds: ['github_repo'],
    sideEffects: ['remote_mutation'],
    riskHints: ['requires_approval'],
    prerequisites: ['github token with issues:write', 'repo full name'],
    providesEvidence: ['verification'],
    workflowStages: ['mutate_remote_state', 'verify_evidence'],
  },
  create_pull_request: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['write', 'verify'],
    resourceKinds: ['github_repo'],
    sideEffects: ['remote_mutation'],
    prerequisites: ['github token with pull requests:write', 'repo full name'],
    providesEvidence: ['verification'],
  },
  workflow_runs: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['github_repo', 'github_workflow'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with actions:read', 'repo full name'],
    providesEvidence: ['github_workflow', 'verification'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  },
  checks_status: {
    runtimeRequirements: ['developer_mode', GITHUB_TOKEN_REQUIREMENT],
    category: 'github',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['github_repo', 'github_workflow'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    prerequisites: ['github token with actions:read', 'repo full name'],
    providesEvidence: ['github_workflow', 'verification'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  },
};

export function getGitHubToolContract(toolName: string): ToolDefinition['contract'] | undefined {
  return GITHUB_TOOL_CONTRACTS[toolName];
}
