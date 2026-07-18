export const EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION = 1 as const;

type Sha256Digest = `sha256:${string}`;

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
    }
  | {
      version: typeof EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION;
      kind: 'mobile_controller_handoff';
      handoffId: string;
      controllerId: string;
      controllerContractVersion: number;
      capabilityDigest: Sha256Digest;
      actionDigest: Sha256Digest;
      beforeObservationId: string;
      beforeObservationDigest: Sha256Digest;
      expiresAt: number;
    };

const AMBIGUOUS_HANDLE_IDS = new Set(['current', 'latest', 'newest', 'pending', 'running']);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MOBILE_HANDOFF_ID_PATTERN = /^mch_[a-f0-9]{32}$/u;

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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function normalizeDigest(value: unknown): Sha256Digest | null {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? (value as Sha256Digest) : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
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
  return normalized.toLowerCase();
}

/** Qualify one exact workflow run. Relative selectors such as "latest" fail closed. */
export function qualifyExecutionExternalHandleLocator(
  candidate: unknown,
): ExecutionExternalHandleLocator | null {
  if (!isRecord(candidate) || candidate.version !== EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION) {
    return null;
  }

  if (candidate.kind === 'expo_workflow_run') {
    if (
      !hasExactKeys(candidate, ['credentialRef', 'kind', 'projectId', 'version', 'workflowRunId'])
    ) {
      return null;
    }
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
    if (
      !hasExactKeys(candidate, ['credentialRef', 'kind', 'repository', 'version', 'workflowRunId'])
    ) {
      return null;
    }
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

  if (candidate.kind === 'mobile_controller_handoff') {
    if (
      !hasExactKeys(candidate, [
        'actionDigest',
        'beforeObservationDigest',
        'beforeObservationId',
        'capabilityDigest',
        'controllerContractVersion',
        'controllerId',
        'expiresAt',
        'handoffId',
        'kind',
        'version',
      ])
    ) {
      return null;
    }
    const handoffId =
      typeof candidate.handoffId === 'string' && MOBILE_HANDOFF_ID_PATTERN.test(candidate.handoffId)
        ? candidate.handoffId
        : null;
    const controllerId = normalizeExactString(candidate.controllerId, 200);
    const controllerContractVersion =
      Number.isSafeInteger(candidate.controllerContractVersion) &&
      (candidate.controllerContractVersion as number) >= 1 &&
      (candidate.controllerContractVersion as number) <= 1_000_000
        ? (candidate.controllerContractVersion as number)
        : null;
    const capabilityDigest = normalizeDigest(candidate.capabilityDigest);
    const actionDigest = normalizeDigest(candidate.actionDigest);
    const beforeObservationId = normalizeExactString(candidate.beforeObservationId, 200);
    const beforeObservationDigest = normalizeDigest(candidate.beforeObservationDigest);
    const expiresAt = normalizeTimestamp(candidate.expiresAt);
    return handoffId &&
      controllerId &&
      controllerContractVersion &&
      capabilityDigest &&
      actionDigest &&
      beforeObservationId &&
      beforeObservationDigest &&
      expiresAt !== null
      ? {
          version: EXECUTION_EXTERNAL_HANDLE_LOCATOR_VERSION,
          kind: 'mobile_controller_handoff',
          handoffId,
          controllerId,
          controllerContractVersion,
          capabilityDigest,
          actionDigest,
          beforeObservationId,
          beforeObservationDigest,
          expiresAt,
        }
      : null;
  }

  return null;
}
