import { resolveExpoAccount, resolveExpoProject } from '../../services/expo/projectState';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import type { ExecutionExternalHandleStatus } from '../../services/executionJournal/types';
import { classifyCurrentToolTaskDurability, type ExternalDurableHandle } from './taskDurability';

const EXPO_EXTERNAL_ACTION_TOOLS = new Set([
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
]);

const EXPO_EXACT_MONITOR_TOOLS = new Set(['expo_eas_workflow_status', 'expo_eas_workflow_wait']);

interface ExpoProjectContext {
  project: ExpoProjectConfig;
  account: ExpoAccountConfig;
}

export interface ExternalToolResultResolverDependencies {
  resolveExpoProjectContext(projectRef: string): ExpoProjectContext;
}

const DEFAULT_DEPENDENCIES: ExternalToolResultResolverDependencies = {
  resolveExpoProjectContext(projectRef) {
    const settings = useSettingsStore.getState();
    const project = resolveExpoProject(projectRef, settings);
    return {
      project,
      account: resolveExpoAccount(project.accountId, settings),
    };
  },
};

export interface ExternalToolRemoteIdentity {
  provider: 'expo' | 'github';
  target: string;
  workflowRunId: string;
}

export type ExternalToolResultDurabilityResolution =
  | { kind: 'not_external' }
  | {
      kind: 'untracked_external';
      reason:
        | 'invalid_tool_arguments'
        | 'provider_contract_invalid'
        | 'external_run_unidentified'
        | 'project_configuration_invalid';
      remote: ExternalToolRemoteIdentity | null;
    }
  | {
      kind: 'external';
      handle: ExternalDurableHandle;
      observedStatus: ExecutionExternalHandleStatus;
      remote: ExternalToolRemoteIdentity;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function exactString(value: unknown): string | null {
  return typeof value === 'string' && value === value.trim() && value.length > 0 ? value : null;
}

function exactRunId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return exactString(value);
}

function expoStatus(value: unknown): ExecutionExternalHandleStatus {
  switch (value) {
    case 'NEW':
    case 'ACTION_REQUIRED':
      return 'pending';
    case 'IN_PROGRESS':
      return 'running';
    case 'SUCCESS':
      return 'succeeded';
    case 'FAILURE':
      return 'failed';
    case 'CANCELED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function githubStatus(status: unknown, conclusion: unknown): ExecutionExternalHandleStatus {
  if (status === 'queued' || status === 'requested' || status === 'pending') return 'pending';
  if (status === 'in_progress' || status === 'waiting') return 'running';
  if (status !== 'completed') return 'unknown';
  if (conclusion === 'success') return 'succeeded';
  if (conclusion === 'cancelled') return 'cancelled';
  if (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'startup_failure' ||
    conclusion === 'stale' ||
    conclusion === 'neutral' ||
    conclusion === 'skipped' ||
    conclusion === 'action_required'
  ) {
    return 'failed';
  }
  return 'unknown';
}

function untracked(
  reason: Extract<ExternalToolResultDurabilityResolution, { kind: 'untracked_external' }>['reason'],
  remote: ExternalToolRemoteIdentity | null = null,
): ExternalToolResultDurabilityResolution {
  return { kind: 'untracked_external', reason, remote };
}

/**
 * Resolve one exact code-owned remote workflow result before tool-output spilling.
 * List tools deliberately never select a relative first/latest run.
 */
export function resolveExternalToolResultDurability(
  input: {
    toolName: string;
    argumentsText: string;
    resultText: string;
  },
  dependencies: ExternalToolResultResolverDependencies = DEFAULT_DEPENDENCIES,
): ExternalToolResultDurabilityResolution {
  const isAction = EXPO_EXTERNAL_ACTION_TOOLS.has(input.toolName);
  const isExactMonitor = EXPO_EXACT_MONITOR_TOOLS.has(input.toolName);
  if (!isAction && !isExactMonitor) return { kind: 'not_external' };

  const argumentsRecord = parseRecord(input.argumentsText);
  const projectRef = exactString(argumentsRecord?.projectId);
  if (!projectRef) return untracked('invalid_tool_arguments');

  const result = parseRecord(input.resultText);
  if (!result) return isAction ? untracked('provider_contract_invalid') : { kind: 'not_external' };
  const mode = exactString(result.mode);
  if (mode === 'direct-ssh') return { kind: 'not_external' };
  if (mode !== 'eas-workflow' && mode !== 'github-workflow') {
    return isAction ? untracked('provider_contract_invalid') : { kind: 'not_external' };
  }

  const workflowRun = isRecord(result.workflowRun) ? result.workflowRun : null;
  const workflowRunId = exactRunId(workflowRun?.id);
  if (!workflowRunId) {
    return isAction ? untracked('external_run_unidentified') : { kind: 'not_external' };
  }

  let context: ExpoProjectContext;
  try {
    context = dependencies.resolveExpoProjectContext(projectRef);
  } catch {
    return untracked('project_configuration_invalid');
  }
  if (context.project.mode !== mode) {
    return untracked('provider_contract_invalid');
  }

  let candidate: unknown;
  let observedStatus: ExecutionExternalHandleStatus;
  let remote: ExternalToolRemoteIdentity;
  if (mode === 'eas-workflow') {
    const projectId = exactString(context.project.easProjectId);
    const credentialRef = exactString(context.account.tokenRef);
    remote = { provider: 'expo', target: projectId ?? context.project.id, workflowRunId };
    if (!projectId || !credentialRef) return untracked('project_configuration_invalid', remote);
    candidate = {
      version: 1,
      kind: 'expo_workflow_run',
      sourceToolName: input.toolName,
      projectId,
      workflowRunId,
      credentialRef,
    };
    observedStatus = expoStatus(workflowRun?.status);
  } else {
    const repository = exactString(context.project.repoFullName);
    const credentialRef = exactString(context.project.githubTokenRef) ?? 'GITHUB_TOKEN';
    remote = { provider: 'github', target: repository ?? context.project.id, workflowRunId };
    if (!repository) return untracked('project_configuration_invalid', remote);
    candidate = {
      version: 1,
      kind: 'github_workflow_run',
      sourceToolName: input.toolName,
      repository,
      workflowRunId,
      credentialRef,
    };
    observedStatus = githubStatus(workflowRun?.status, workflowRun?.conclusion);
  }

  const classification = classifyCurrentToolTaskDurability({
    toolName: input.toolName,
    externalHandle: candidate,
  });
  if (classification.taskClass !== 'external_durable_operation') {
    return untracked('provider_contract_invalid', remote);
  }
  return {
    kind: 'external',
    handle: classification.externalHandle,
    observedStatus,
    remote,
  };
}
