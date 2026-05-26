import type { ToolDefinition } from '../../types';
import { normalizeToolName } from './toolNameNormalization';

export type ToolCapability =
  | 'discover'
  | 'read'
  | 'write'
  | 'commit'
  | 'push'
  | 'deploy'
  | 'monitor'
  | 'wait'
  | 'verify'
  | 'coordinate'
  | 'compute';

export type ToolResourceKind =
  | 'conversation_workspace'
  | 'github_repo'
  | 'github_branch'
  | 'github_workflow'
  | 'expo_account'
  | 'expo_project'
  | 'eas_workflow'
  | 'ssh_host'
  | 'browser'
  | 'canvas'
  | 'memory'
  | 'device'
  | 'unknown';

export type ToolSideEffect =
  | 'none'
  | 'local_artifact'
  | 'remote_mutation'
  | 'external_run'
  | 'destructive';

export type ToolRiskHint =
  | 'read_only'
  | 'destructive'
  | 'idempotent'
  | 'open_world'
  | 'trusted_metadata'
  | 'requires_approval';

export type ToolEvidenceKind =
  | 'local_artifact'
  | 'github_commit'
  | 'github_push'
  | 'github_branch'
  | 'github_workflow'
  | 'expo_project'
  | 'expo_project_ready'
  | 'eas_workflow_triggered'
  | 'eas_workflow_terminal'
  | 'external_run'
  | 'verification'
  | 'blocker';

export type ToolWorkflowStage =
  | 'discover_resource'
  | 'inspect_resource'
  | 'prepare_artifact'
  | 'persist_artifact'
  | 'mutate_remote_state'
  | 'start_external_execution'
  | 'monitor_external_execution'
  | 'await_external_execution'
  | 'verify_evidence'
  | 'guarded_resource_creation';

export interface ToolCapabilityRequirement {
  category?: string;
  capability?: ToolCapability;
  resourceKind?: ToolResourceKind;
  evidenceKind?: ToolEvidenceKind;
  workflowStage?: ToolWorkflowStage;
}

export interface ToolCapabilityDescriptor {
  name: string;
  source: 'built-in' | 'skill' | 'mcp';
  namespace?: string;
  category: string;
  aliases: string[];
  capabilities: ToolCapability[];
  resourceKinds: ToolResourceKind[];
  sideEffects: ToolSideEffect[];
  riskHints: ToolRiskHint[];
  prerequisites: string[];
  providesEvidence: ToolEvidenceKind[];
  workflowStages: ToolWorkflowStage[];
  inputExamples?: Array<Record<string, unknown>>;
  outputSchema?: Record<string, unknown>;
  description?: string;
}

export interface ToolLifecyclePriorityOptions {
  /**
   * When true, locally actionable tools move ahead of broad read-only/meta
   * discovery. This is useful after a workflow has already selected a concrete
   * execution lane; catalog browsing should keep the default discovery-first
   * ordering.
   */
  preferActionable?: boolean;
}

const EMPTY_DESCRIPTOR_ARRAY: never[] = [];

function unique<T>(values: Iterable<T | undefined | null>): T[] {
  return Array.from(new Set(Array.from(values).filter((value): value is T => value != null)));
}

function hasPrefix(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}__`);
}

function getNamespacedLeafName(normalizedName: string): string {
  return normalizedName.includes('__')
    ? normalizedName.split('__').pop() || normalizedName
    : normalizedName;
}

function resolveSource(normalizedName: string): ToolCapabilityDescriptor['source'] {
  if (normalizedName.startsWith('skill__')) {
    return 'skill';
  }
  if (normalizedName.startsWith('mcp__')) {
    return 'mcp';
  }
  return 'built-in';
}

function resolveNamespace(normalizedName: string): string | undefined {
  if (!normalizedName.includes('__')) {
    return undefined;
  }

  const [source, namespace] = normalizedName.split('__');
  return source && namespace ? namespace : undefined;
}

function baseDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  patch: Partial<Omit<ToolCapabilityDescriptor, 'name' | 'source' | 'namespace'>>,
): ToolCapabilityDescriptor {
  const name = normalizeToolName(tool.name);
  return {
    name,
    source: resolveSource(name),
    namespace: resolveNamespace(name),
    category: patch.category || 'other',
    aliases: unique(patch.aliases ?? EMPTY_DESCRIPTOR_ARRAY),
    capabilities: unique(patch.capabilities ?? EMPTY_DESCRIPTOR_ARRAY),
    resourceKinds: unique(patch.resourceKinds ?? ['unknown']),
    sideEffects: unique(patch.sideEffects ?? ['none']),
    riskHints: unique(patch.riskHints ?? EMPTY_DESCRIPTOR_ARRAY),
    prerequisites: unique(patch.prerequisites ?? EMPTY_DESCRIPTOR_ARRAY),
    providesEvidence: unique(patch.providesEvidence ?? EMPTY_DESCRIPTOR_ARRAY),
    workflowStages: unique(patch.workflowStages ?? EMPTY_DESCRIPTOR_ARRAY),
    inputExamples: patch.inputExamples,
    outputSchema: patch.outputSchema,
    description: tool.description,
  };
}

function inferGithubDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  leafName: string,
): ToolCapabilityDescriptor {
  if (leafName === 'commit_files') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git commit', 'repository commit', 'commit local workspace files'],
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
      outputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          branch: { type: 'string' },
          commitSha: { type: 'string' },
          changedFiles: { type: 'array', items: { type: 'string' } },
        },
      },
    });
  }

  if (leafName === 'create_branch') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git branch', 'create repository branch'],
      capabilities: ['write'],
      resourceKinds: ['github_repo', 'github_branch'],
      sideEffects: ['remote_mutation'],
      prerequisites: ['github token with contents:write', 'repo full name'],
      providesEvidence: ['github_branch'],
      workflowStages: ['mutate_remote_state', 'verify_evidence'],
    });
  }

  if (leafName === 'create_pull_request') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['pull request', 'pr'],
      capabilities: ['write', 'verify'],
      resourceKinds: ['github_repo'],
      sideEffects: ['remote_mutation'],
      prerequisites: ['github token with pull requests:write', 'repo full name'],
      providesEvidence: ['verification'],
    });
  }

  if (leafName === 'issues') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['github issues', 'issue tracker'],
      capabilities: ['read'],
      resourceKinds: ['github_repo'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with issues:read', 'repo full name'],
      providesEvidence: ['verification'],
      workflowStages: ['inspect_resource', 'verify_evidence'],
    });
  }

  if (leafName === 'create_issue') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['create issue', 'open issue'],
      capabilities: ['write'],
      resourceKinds: ['github_repo'],
      sideEffects: ['remote_mutation'],
      riskHints: ['requires_approval'],
      prerequisites: ['github token with issues:write', 'repo full name'],
      providesEvidence: ['verification'],
      workflowStages: ['mutate_remote_state', 'verify_evidence'],
    });
  }

  if (leafName.includes('workflow') || leafName.includes('checks')) {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['github actions', 'checks', 'workflow run'],
      capabilities: leafName.includes('wait') ? ['monitor', 'wait', 'verify'] : ['monitor', 'verify'],
      resourceKinds: ['github_repo', 'github_workflow'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with actions:read', 'repo full name'],
      providesEvidence: ['github_workflow', 'verification'],
      workflowStages: leafName.includes('wait')
        ? ['monitor_external_execution', 'await_external_execution', 'verify_evidence']
        : ['monitor_external_execution', 'verify_evidence'],
    });
  }

  if (leafName === 'repos') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git discovery', 'repository discovery'],
      resourceKinds: ['github_repo'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with repository read access'],
      providesEvidence: ['verification'],
      workflowStages: ['discover_resource'],
      capabilities: ['discover'],
    });
  }

  if (leafName === 'branches') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git branch read', 'repository branch inspect'],
      capabilities: ['discover', 'read'],
      resourceKinds: ['github_repo', 'github_branch'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with repository read access', 'repo full name'],
      providesEvidence: ['verification'],
      workflowStages: ['discover_resource', 'inspect_resource'],
    });
  }

  if (leafName === 'list_files') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git read', 'repository file discovery', 'repository file inspect'],
      capabilities: ['discover', 'read'],
      resourceKinds: ['github_repo'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with repository read access', 'repo full name'],
      providesEvidence: ['verification'],
      workflowStages: ['discover_resource', 'inspect_resource'],
    });
  }

  if (leafName === 'read_file') {
    return baseDescriptor(tool, {
      category: 'github',
      aliases: ['git read', 'repository file inspect'],
      capabilities: ['read'],
      resourceKinds: ['github_repo'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['github token with repository read access', 'repo full name'],
      providesEvidence: ['verification'],
      workflowStages: ['inspect_resource'],
    });
  }

  return baseDescriptor(tool, {
    category: 'github',
    aliases: ['github', 'repository'],
    capabilities: ['discover'],
    resourceKinds: ['github_repo'],
    sideEffects: ['none'],
  });
}

function inferExpoDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  normalizedName: string,
): ToolCapabilityDescriptor | undefined {
  switch (normalizedName) {
    case 'expo_eas_list_projects':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['eas projects', 'expo project discovery'],
        capabilities: ['discover', 'read'],
        resourceKinds: ['expo_account', 'expo_project'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        prerequisites: ['linked Expo account'],
        providesEvidence: ['expo_project'],
        workflowStages: ['discover_resource'],
      });
    case 'expo_eas_status':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['expo readiness', 'eas project status'],
        capabilities: ['read', 'verify'],
        resourceKinds: ['expo_project'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        prerequisites: ['Expo project id or full name'],
        providesEvidence: ['expo_project', 'expo_project_ready'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      });
    case 'expo_eas_probe':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['expo workflow preflight', 'eas readiness probe'],
        capabilities: ['verify'],
        resourceKinds: ['expo_project', 'eas_workflow', 'github_repo'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        prerequisites: ['Expo project id or full name'],
        providesEvidence: ['expo_project_ready', 'verification', 'blocker'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      });
    case 'expo_eas_workflow_runs':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['eas workflow runs', 'expo workflow monitor'],
        capabilities: ['monitor', 'verify'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        prerequisites: ['Expo project id or full name'],
        providesEvidence: ['eas_workflow_triggered', 'verification'],
        workflowStages: ['monitor_external_execution', 'verify_evidence'],
      });
    case 'expo_eas_workflow_status':
    case 'expo_eas_workflow_wait':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['eas workflow status', 'wait for expo workflow'],
        capabilities:
          normalizedName === 'expo_eas_workflow_wait'
            ? ['monitor', 'wait', 'verify']
            : ['monitor', 'verify'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        prerequisites: ['Expo project id or full name', 'workflow run id for exact status'],
        providesEvidence: ['eas_workflow_terminal', 'verification', 'blocker'],
        workflowStages:
          normalizedName === 'expo_eas_workflow_wait'
            ? ['monitor_external_execution', 'await_external_execution', 'verify_evidence']
            : ['monitor_external_execution', 'verify_evidence'],
      });
    case 'expo_eas_create_project':
      return baseDescriptor(tool, {
        category: 'expo',
        aliases: ['create expo project', 'register eas project'],
        capabilities: ['write'],
        resourceKinds: ['expo_account', 'expo_project'],
        sideEffects: ['remote_mutation'],
        riskHints: ['requires_approval'],
        prerequisites: ['linked Expo account', 'confirmed no suitable existing Expo project'],
        providesEvidence: ['expo_project'],
        workflowStages: ['guarded_resource_creation', 'mutate_remote_state'],
      });
    case 'expo_eas_build':
    case 'expo_eas_update':
    case 'expo_eas_submit':
    case 'expo_eas_deploy_web':
      return baseDescriptor(tool, {
        category: 'expo_manual_actions',
        aliases: ['manual eas action'],
        capabilities: ['deploy', 'monitor'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['external_run'],
        prerequisites: ['Expo project id or full name'],
        providesEvidence: ['external_run', 'verification'],
      });
    default:
      return undefined;
  }
}

function inferWorkspaceDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  normalizedName: string,
): ToolCapabilityDescriptor | undefined {
  if (normalizedName === 'write_file' || normalizedName === 'file_edit') {
    return baseDescriptor(tool, {
      category: 'workspace_files',
      aliases: ['local file write', 'conversation workspace artifact'],
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
      prerequisites: ['conversation workspace'],
      providesEvidence: ['local_artifact'],
      workflowStages: ['prepare_artifact', 'persist_artifact'],
    });
  }

  if (normalizedName === 'read_file' || normalizedName === 'list_files' || normalizedName === 'glob_search' || normalizedName === 'text_search') {
    return baseDescriptor(tool, {
      category: 'workspace_files',
      aliases: ['local file read', 'conversation workspace inspect'],
      capabilities: ['discover', 'read'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      prerequisites: ['conversation workspace'],
      providesEvidence: ['verification'],
      workflowStages: ['discover_resource', 'inspect_resource'],
    });
  }

  return undefined;
}

function inferSessionDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  normalizedName: string,
): ToolCapabilityDescriptor | undefined {
  if (normalizedName === 'wait') {
    return baseDescriptor(tool, {
      category: 'async_wait',
      aliases: ['wait for asynchronous work'],
      capabilities: [],
      resourceKinds: ['unknown'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'idempotent'],
      providesEvidence: [],
      workflowStages: [],
    });
  }

  if (!normalizedName.startsWith('sessions_')) {
    return undefined;
  }

  if (normalizedName === 'sessions_spawn' || normalizedName === 'sessions_send') {
    return baseDescriptor(tool, {
      category: 'sessions',
      aliases: ['sub-agent work', 'delegated worker execution'],
      capabilities: ['coordinate', 'write'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['external_run'],
      riskHints: ['requires_approval'],
      providesEvidence: ['external_run'],
      workflowStages: ['start_external_execution'],
    });
  }

  if (normalizedName === 'sessions_cancel') {
    return baseDescriptor(tool, {
      category: 'sessions',
      aliases: ['cancel delegated worker execution'],
      capabilities: ['coordinate'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['destructive'],
      riskHints: ['destructive', 'requires_approval'],
      providesEvidence: ['blocker'],
    });
  }

  if (
    normalizedName === 'sessions_status' ||
    normalizedName === 'sessions_wait' ||
    normalizedName === 'sessions_yield' ||
    normalizedName === 'sessions_list' ||
    normalizedName === 'sessions_history' ||
    normalizedName === 'sessions_output' ||
    normalizedName === 'sessions_surface_output'
  ) {
    return baseDescriptor(tool, {
      category: 'sessions',
      aliases: ['sub-agent monitoring', 'delegated worker results'],
      capabilities:
        normalizedName === 'sessions_wait' || normalizedName === 'sessions_yield'
          ? ['monitor', 'wait', 'verify']
          : ['monitor', 'read', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'idempotent'],
      providesEvidence: ['external_run', 'verification', 'blocker'],
      workflowStages:
        normalizedName === 'sessions_wait' || normalizedName === 'sessions_yield'
          ? ['monitor_external_execution', 'await_external_execution', 'verify_evidence']
          : ['monitor_external_execution', 'verify_evidence'],
    });
  }

  return baseDescriptor(tool, {
    category: 'sessions',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
  });
}

export function inferToolCapabilityDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
): ToolCapabilityDescriptor {
  const normalizedName = normalizeToolName(tool.name);
  const leafName = getNamespacedLeafName(normalizedName);

  if (
    normalizedName.startsWith('skill__github__') ||
    normalizedName.startsWith('mcp__github__') ||
    normalizedName.includes('__github__')
  ) {
    return inferGithubDescriptor(tool, leafName);
  }

  const expoDescriptor = inferExpoDescriptor(tool, normalizedName);
  if (expoDescriptor) {
    return expoDescriptor;
  }

  const workspaceDescriptor = inferWorkspaceDescriptor(tool, normalizedName);
  if (workspaceDescriptor) {
    return workspaceDescriptor;
  }

  const sessionDescriptor = inferSessionDescriptor(tool, normalizedName);
  if (sessionDescriptor) {
    return sessionDescriptor;
  }

  if (hasPrefix(normalizedName, 'browser')) {
    const monitorsBrowser =
      normalizedName.includes('status') ||
      normalizedName.includes('wait') ||
      normalizedName.includes('snapshot');
    return baseDescriptor(tool, {
      category: 'browser',
      capabilities: normalizedName.includes('wait')
        ? ['monitor', 'wait', 'verify']
        : monitorsBrowser
          ? ['monitor', 'read', 'verify']
          : ['read', 'write', 'verify'],
      resourceKinds: ['browser'],
      sideEffects: monitorsBrowser ? ['none'] : ['external_run'],
      providesEvidence: ['verification', 'external_run'],
      workflowStages: monitorsBrowser ? ['monitor_external_execution', 'verify_evidence'] : undefined,
    });
  }

  if (hasPrefix(normalizedName, 'ssh')) {
    const monitorsRemoteJob =
      normalizedName.includes('status') ||
      normalizedName.includes('wait');
    return baseDescriptor(tool, {
      category: 'ssh',
      capabilities: normalizedName.includes('wait')
        ? ['monitor', 'wait', 'verify']
        : monitorsRemoteJob
          ? ['monitor', 'verify']
          : normalizedName.includes('read') || normalizedName.includes('list') ? ['read'] : ['write'],
      resourceKinds: ['ssh_host'],
      sideEffects: monitorsRemoteJob || normalizedName.includes('read') || normalizedName.includes('list') ? ['none'] : ['remote_mutation'],
      providesEvidence: ['verification', 'external_run'],
      workflowStages: normalizedName.includes('wait')
        ? ['monitor_external_execution', 'await_external_execution', 'verify_evidence']
        : monitorsRemoteJob
          ? ['monitor_external_execution', 'verify_evidence']
          : undefined,
    });
  }

  if (normalizedName === 'web_search' || normalizedName === 'web_fetch') {
    return baseDescriptor(tool, {
      category: 'web_research',
      capabilities: ['discover', 'read'],
      resourceKinds: ['unknown'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'open_world'],
      providesEvidence: ['verification'],
    });
  }

  if (normalizedName === 'memory_search' || normalizedName === 'memory_recall') {
    return baseDescriptor(tool, {
      category: 'memory_search',
      capabilities: ['discover', 'read'],
      resourceKinds: ['memory'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      providesEvidence: ['verification'],
    });
  }

  if (normalizedName === 'pdf_read') {
    return baseDescriptor(tool, {
      category: 'pdf',
      capabilities: ['read', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      providesEvidence: ['verification'],
    });
  }

  if (normalizedName === 'record_workflow_evidence' || normalizedName === 'read_workflow_evidence') {
    return baseDescriptor(tool, {
      category: 'tools',
      capabilities: normalizedName === 'read_workflow_evidence' ? ['read'] : ['coordinate'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only'],
      providesEvidence: ['verification'],
    });
  }

  if (normalizedName === 'tool_catalog') {
    return baseDescriptor(tool, {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'idempotent'],
    });
  }

  if (normalizedName === 'python' || normalizedName === 'javascript') {
    return baseDescriptor(tool, {
      category: 'code',
      capabilities: ['compute', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      providesEvidence: ['verification'],
    });
  }

  return baseDescriptor(tool, {
    category: resolveSource(normalizedName) === 'skill'
      ? 'skills'
      : resolveSource(normalizedName) === 'mcp'
        ? 'mcp'
        : 'other',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
  });
}

export function scoreToolLifecyclePriority(
  descriptor: ToolCapabilityDescriptor,
  options?: ToolLifecyclePriorityOptions,
): number {
  const capabilities = new Set(descriptor.capabilities);
  const sideEffects = new Set(descriptor.sideEffects);
  const riskHints = new Set(descriptor.riskHints);
  const workflowStages = new Set(descriptor.workflowStages);
  let score = 100;

  if (workflowStages.has('discover_resource')) score -= 70;
  if (workflowStages.has('inspect_resource')) score -= 62;
  if (workflowStages.has('verify_evidence')) score -= 52;
  if (workflowStages.has('monitor_external_execution')) score -= 42;
  if (workflowStages.has('await_external_execution')) score -= 34;
  if (workflowStages.has('prepare_artifact')) score -= options?.preferActionable ? 30 : 10;
  if (workflowStages.has('persist_artifact')) score -= options?.preferActionable ? 22 : 0;

  if (capabilities.has('discover')) score -= 36;
  if (capabilities.has('read')) score -= 32;
  if (capabilities.has('verify')) score -= 28;
  if (capabilities.has('monitor')) score -= 22;
  if (capabilities.has('wait')) score -= 12;
  if (capabilities.has('compute')) score -= options?.preferActionable ? 14 : 4;
  if (capabilities.has('write')) score += options?.preferActionable ? -6 : 16;
  if (capabilities.has('commit')) score += options?.preferActionable ? -4 : 24;
  if (capabilities.has('push')) score += options?.preferActionable ? 0 : 28;
  if (capabilities.has('deploy')) score += 34;
  if (capabilities.has('coordinate')) score += 12;

  if (sideEffects.has('none')) score -= 24;
  if (sideEffects.has('local_artifact')) score += options?.preferActionable ? -12 : 8;
  if (sideEffects.has('external_run')) score += 38;
  if (sideEffects.has('remote_mutation')) score += 48;
  if (sideEffects.has('destructive')) score += 90;

  if (riskHints.has('read_only')) score -= 22;
  if (riskHints.has('idempotent')) score -= 14;
  if (riskHints.has('trusted_metadata')) score -= 8;
  if (riskHints.has('open_world')) score += 18;
  if (riskHints.has('requires_approval')) score += 38;
  if (riskHints.has('destructive')) score += 90;

  if (workflowStages.has('start_external_execution')) score += options?.preferActionable ? 18 : 44;
  if (workflowStages.has('mutate_remote_state')) score += options?.preferActionable ? 16 : 52;
  if (workflowStages.has('guarded_resource_creation')) score += 86;

  return score;
}

export function compareToolLifecyclePriority(
  left: Pick<ToolDefinition, 'name' | 'description'>,
  right: Pick<ToolDefinition, 'name' | 'description'>,
  options?: ToolLifecyclePriorityOptions,
): number {
  const leftDescriptor = inferToolCapabilityDescriptor(left);
  const rightDescriptor = inferToolCapabilityDescriptor(right);
  const scoreDiff =
    scoreToolLifecyclePriority(leftDescriptor, options) -
    scoreToolLifecyclePriority(rightDescriptor, options);
  return scoreDiff !== 0 ? scoreDiff : leftDescriptor.name.localeCompare(rightDescriptor.name);
}

export function buildToolCapabilityRegistry(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): Map<string, ToolCapabilityDescriptor> {
  return new Map(
    tools.map((tool) => {
      const descriptor = inferToolCapabilityDescriptor(tool);
      return [descriptor.name, descriptor];
    }),
  );
}

export function descriptorSatisfiesRequirement(
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
): boolean {
  return (
    (!requirement.capability || descriptor.capabilities.includes(requirement.capability)) &&
    (!requirement.resourceKind || descriptor.resourceKinds.includes(requirement.resourceKind)) &&
    (!requirement.evidenceKind || descriptor.providesEvidence.includes(requirement.evidenceKind)) &&
    (!requirement.category || descriptor.category === requirement.category) &&
    (!requirement.workflowStage || descriptor.workflowStages.includes(requirement.workflowStage))
  );
}

function scoreDescriptorForRequirement(
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
): number {
  let score = 0;
  if (requirement.workflowStage && descriptor.workflowStages.includes(requirement.workflowStage)) score += 12;
  if (requirement.category && descriptor.category === requirement.category) score += 6;
  if (requirement.capability && descriptor.capabilities.includes(requirement.capability)) score += 8;
  if (requirement.resourceKind && descriptor.resourceKinds.includes(requirement.resourceKind)) score += 6;
  if (requirement.evidenceKind && descriptor.providesEvidence.includes(requirement.evidenceKind)) score += 6;
  if (
    (requirement.workflowStage === 'discover_resource' ||
      requirement.workflowStage === 'inspect_resource') &&
    descriptor.capabilities.includes('discover')
  ) {
    score += 4;
  }
  if (descriptor.riskHints.includes('read_only')) score += 1;
  if (descriptor.sideEffects.includes('destructive')) score -= 6;
  return score;
}

export function selectToolNamesForCapabilityRequirements(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
): string[] {
  const registry = buildToolCapabilityRegistry(tools);
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const requirement of requirements) {
    const candidates = Array.from(registry.values())
      .filter((descriptor) => descriptorSatisfiesRequirement(descriptor, requirement))
      .map((descriptor, index) => ({
        descriptor,
        index,
        score: scoreDescriptorForRequirement(descriptor, requirement),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = candidates[0]?.descriptor;
    if (best && !seen.has(best.name)) {
      seen.add(best.name);
      selected.push(best.name);
    }
  }

  return selected;
}

export function findToolDescriptorByName(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  toolName: string | undefined,
): ToolCapabilityDescriptor | undefined {
  const normalizedName = normalizeToolName(toolName || '');
  if (!normalizedName) {
    return undefined;
  }
  const tool = tools.find((candidate) => normalizeToolName(candidate.name) === normalizedName);
  return tool ? inferToolCapabilityDescriptor(tool) : undefined;
}
