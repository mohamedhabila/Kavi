export const TASK_DURABILITY_CLASSES = [
  'foreground_interactive',
  'user_initiated_continuable',
  'deferrable_maintenance',
  'event_driven_monitor',
  'external_durable_operation',
] as const;

export type TaskDurabilityClass = (typeof TASK_DURABILITY_CLASSES)[number];

export type ExternalDurableHandle =
  | {
      version: 1;
      kind: 'expo_workflow_run';
      sourceToolName: string;
      projectId: string;
      workflowRunId: string;
    }
  | {
      version: 1;
      kind: 'github_workflow_run';
      sourceToolName: string;
      repository: string;
      workflowRunId: string;
    };

export type CurrentTaskDurabilityClassification =
  | {
      taskClass: 'foreground_interactive';
      localExecution: 'process_bound';
      recovery: 'not_resumable';
    }
  | {
      taskClass: 'external_durable_operation';
      localExecution: 'process_bound';
      recovery: 'reconcile_external_handle';
      externalHandle: ExternalDurableHandle;
    };

const EXPO_WORKFLOW_HANDLE_SOURCES = new Set([
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
]);

const GITHUB_WORKFLOW_HANDLE_SOURCES = new Set([
  'skill__github__workflow_runs',
  'skill__github__checks_status',
]);

const AMBIGUOUS_HANDLE_IDS = new Set(['current', 'latest', 'newest', 'pending', 'running']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeExactString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value !== value.trim()) {
    return null;
  }
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  return value;
}

function normalizeWorkflowRunId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  const normalized = normalizeExactString(value, 128);
  if (
    !normalized ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized) ||
    AMBIGUOUS_HANDLE_IDS.has(normalized.toLowerCase())
  ) {
    return null;
  }
  return normalized;
}

function normalizeGitHubWorkflowRunId(value: unknown): string | null {
  const normalized = normalizeWorkflowRunId(value);
  if (!normalized || !/^[1-9][0-9]*$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeExpoProjectId(value: unknown): string | null {
  const normalized = normalizeExactString(value, 200);
  const isStoredId = Boolean(normalized && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized));
  const isFullName = Boolean(
    normalized && /^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized),
  );
  if (!normalized || (!isStoredId && !isFullName) || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

function normalizeGitHubRepository(value: unknown): string | null {
  const normalized = normalizeExactString(value, 200);
  if (!normalized || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return null;
  }

  const [owner, repository] = normalized.split('/');
  if (
    !owner ||
    !repository ||
    owner === '.' ||
    owner === '..' ||
    repository === '.' ||
    repository === '..'
  ) {
    return null;
  }
  return normalized;
}

/**
 * Turn an explicitly selected workflow run into a durable locator. This does
 * not select "latest" from a list and does not accept process-local session or
 * SSH job ids. Callers must choose one concrete run returned by the code-owned
 * Expo or GitHub integration before qualification.
 */
export function qualifyExternalDurableHandle(candidate: unknown): ExternalDurableHandle | null {
  if (!isRecord(candidate) || candidate.version !== 1) {
    return null;
  }

  const sourceToolName = normalizeExactString(candidate.sourceToolName, 120) ?? '';

  if (candidate.kind === 'expo_workflow_run') {
    if (!EXPO_WORKFLOW_HANDLE_SOURCES.has(sourceToolName)) {
      return null;
    }
    const projectId = normalizeExpoProjectId(candidate.projectId);
    const workflowRunId = normalizeWorkflowRunId(candidate.workflowRunId);
    return projectId && workflowRunId
      ? { version: 1, kind: 'expo_workflow_run', sourceToolName, projectId, workflowRunId }
      : null;
  }

  if (candidate.kind === 'github_workflow_run') {
    if (!GITHUB_WORKFLOW_HANDLE_SOURCES.has(sourceToolName)) {
      return null;
    }
    const repository = normalizeGitHubRepository(candidate.repository);
    const workflowRunId = normalizeGitHubWorkflowRunId(candidate.workflowRunId);
    return repository && workflowRunId
      ? {
          version: 1,
          kind: 'github_workflow_run',
          sourceToolName,
          repository,
          workflowRunId,
        }
      : null;
  }

  return null;
}

/**
 * Truthful baseline before the persisted journal and platform schedulers land.
 * Every local work unit remains process-bound. A concrete cloud workflow can
 * be classified as externally durable because the remote operation survives,
 * but recovery still requires explicit reconciliation rather than local resume.
 */
export function classifyCurrentToolTaskDurability(input: {
  toolName: string;
  externalHandle?: unknown;
}): CurrentTaskDurabilityClassification {
  const toolName = input.toolName.trim();
  const externalHandle = qualifyExternalDurableHandle(input.externalHandle);
  if (externalHandle?.sourceToolName === toolName) {
    return {
      taskClass: 'external_durable_operation',
      localExecution: 'process_bound',
      recovery: 'reconcile_external_handle',
      externalHandle,
    };
  }

  return {
    taskClass: 'foreground_interactive',
    localExecution: 'process_bound',
    recovery: 'not_resumable',
  };
}
