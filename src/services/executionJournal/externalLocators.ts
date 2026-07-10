export const EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION = 1 as const;

export type ExecutionExternalHandleLocator =
  | {
      version: typeof EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION;
      kind: 'expo_workflow_run';
      projectId: string;
      workflowRunId: string;
      credentialRef: string;
    }
  | {
      version: typeof EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION;
      kind: 'github_workflow_run';
      repository: string;
      workflowRunId: string;
      credentialRef: string;
    };

const AMBIGUOUS_HANDLE_IDS = new Set(['current', 'latest', 'newest', 'pending', 'running']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeExactString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value !== value.trim()) {
    return null;
  }
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
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
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(normalized) ||
    AMBIGUOUS_HANDLE_IDS.has(normalized.toLowerCase())
  ) {
    return null;
  }
  return normalized;
}

function normalizeExpoProjectId(value: unknown): string | null {
  const normalized = normalizeExactString(value, 200);
  const isStoredId = Boolean(normalized && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized));
  const isFullName = Boolean(
    normalized && /^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized),
  );
  if (!normalized || (!isStoredId && !isFullName) || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

function normalizeGitHubRepository(value: unknown): string | null {
  const normalized = normalizeExactString(value, 200);
  if (!normalized || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
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

/** Qualify one exact workflow run. Relative selectors such as "latest" fail closed. */
export function qualifyExecutionExternalHandleLocator(
  candidate: unknown,
): ExecutionExternalHandleLocator | null {
  if (!isRecord(candidate) || candidate.version !== EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION) {
    return null;
  }

  if (candidate.kind === 'expo_workflow_run') {
    const projectId = normalizeExpoProjectId(candidate.projectId);
    const workflowRunId = normalizeWorkflowRunId(candidate.workflowRunId);
    const credentialRef = normalizeExactString(candidate.credentialRef, 200);
    return projectId && workflowRunId && credentialRef
      ? {
          version: EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION,
          kind: 'expo_workflow_run',
          projectId,
          workflowRunId,
          credentialRef,
        }
      : null;
  }

  if (candidate.kind === 'github_workflow_run') {
    const repository = normalizeGitHubRepository(candidate.repository);
    const workflowRunId = normalizeWorkflowRunId(candidate.workflowRunId);
    const credentialRef = normalizeExactString(candidate.credentialRef, 200);
    if (!workflowRunId || !/^[1-9][0-9]*$/u.test(workflowRunId) || !credentialRef) {
      return null;
    }
    return repository
      ? {
          version: EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION,
          kind: 'github_workflow_run',
          repository,
          workflowRunId,
          credentialRef,
        }
      : null;
  }

  return null;
}
