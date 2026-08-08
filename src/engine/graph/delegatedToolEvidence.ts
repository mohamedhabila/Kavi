import { normalizeToolName } from '../tools/toolNameNormalization';
import { buildDelegatedArtifactEvidence } from '../goals/delegation';

const DELEGATION_RESULT_TOOL_NAMES = new Set(['sessions_spawn', 'sessions_send', 'sessions_wait']);
const SUCCESSFUL_TERMINAL_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSuccessfulTerminalStatus(value: unknown): boolean {
  return typeof value === 'string' && SUCCESSFUL_TERMINAL_STATUSES.has(value.trim().toLowerCase());
}

function isVerifiedCompletionState(value: unknown): boolean {
  return value === 'verified_success';
}

function readToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? normalizeToolName(entry) : ''))
    .filter(Boolean);
}

function addToolNames(target: Set<string>, toolNames: unknown): void {
  for (const toolName of readToolNames(toolNames)) {
    target.add(toolName);
  }
}

function addArtifactPaths(target: Set<string>, artifacts: unknown): void {
  if (!Array.isArray(artifacts)) {
    return;
  }
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) {
      continue;
    }
    const workspacePath = artifact.workspacePath;
    if (typeof workspacePath === 'string' && workspacePath.trim()) {
      target.add(workspacePath.trim());
    }
  }
}

/**
 * Workspace paths a terminal delegated worker actually produced, as evidence strings.
 *
 * Only a verified-successful terminal result contributes, matching the bar
 * `collectAgentControlGraphDelegatedCompletedToolNames` already applies: a worker that
 * failed, stalled, or self-reported an unverified completion proves nothing about a file.
 */
export function collectDelegatedArtifactEvidence(params: {
  hostToolName: string | undefined;
  result: string | undefined;
  isError?: boolean;
}): string[] {
  if (params.isError) {
    return [];
  }
  if (!DELEGATION_RESULT_TOOL_NAMES.has(normalizeToolName(params.hostToolName || ''))) {
    return [];
  }
  const parsed = parseJsonRecord(params.result);
  if (!parsed) {
    return [];
  }

  const paths = new Set<string>();
  if (
    isSuccessfulTerminalStatus(parsed.status) &&
    isVerifiedCompletionState(parsed.completionState)
  ) {
    addArtifactPaths(paths, parsed.artifacts);
  }
  if (Array.isArray(parsed.sessions)) {
    for (const session of parsed.sessions) {
      if (
        isRecord(session) &&
        isSuccessfulTerminalStatus(session.status) &&
        isVerifiedCompletionState(session.completionState)
      ) {
        addArtifactPaths(paths, session.artifacts);
      }
    }
  }

  return [...paths].map(buildDelegatedArtifactEvidence);
}

export function collectAgentControlGraphDelegatedCompletedToolNames(params: {
  hostToolName: string | undefined;
  result: string | undefined;
  isError?: boolean;
}): string[] {
  if (params.isError) {
    return [];
  }

  const hostToolName = normalizeToolName(params.hostToolName || '');
  if (!DELEGATION_RESULT_TOOL_NAMES.has(hostToolName)) {
    return [];
  }

  const parsed = parseJsonRecord(params.result);
  if (!parsed) {
    return [];
  }

  const completedToolNames = new Set<string>();
  if (
    isSuccessfulTerminalStatus(parsed.status) &&
    isVerifiedCompletionState(parsed.completionState)
  ) {
    addToolNames(completedToolNames, parsed.toolsUsed);
  }

  if (Array.isArray(parsed.sessions)) {
    for (const session of parsed.sessions) {
      if (
        isRecord(session) &&
        isSuccessfulTerminalStatus(session.status) &&
        isVerifiedCompletionState(session.completionState)
      ) {
        addToolNames(completedToolNames, session.toolsUsed);
      }
    }
  }

  return [...completedToolNames];
}
