type PythonWorkflowBridgeTextOptions = {
  maxChars: number;
};

const MAX_PYTHON_WORKFLOW_BRIDGE_ENTRIES = 24;
const MAX_PYTHON_WORKFLOW_BRIDGE_TAGS = 8;
const MAX_PYTHON_WORKFLOW_BRIDGE_CONTENT_CHARS = 400;
const MAX_PYTHON_WORKFLOW_BRIDGE_TITLE_CHARS = 120;
const MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS = 240;

const PYTHON_WORKFLOW_BRIDGE_KIND_VALUES = [
  'fact',
  'source',
  'decision',
  'risk',
  'question',
  'artifact',
  'summary',
] as const;

const PYTHON_WORKFLOW_BRIDGE_STATUS_VALUES = ['candidate', 'verified', 'open', 'resolved'] as const;

const PYTHON_WORKFLOW_BRIDGE_RECORDER_VALUES = [
  'supervisor',
  'worker',
  'pilot',
  'python',
  'tool',
  'system',
] as const;

export interface PythonWorkflowBridgeEvidenceEntry {
  id?: string;
  kind?: string;
  status?: string;
  recorder?: string;
  title?: string;
  content: string;
  dedupeKey?: string;
  sourceName?: string;
  sourceUri?: string;
  toolName?: string;
  workerSessionId?: string;
  artifactWorkspacePath?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface PythonWorkflowBridgeState {
  evidence: PythonWorkflowBridgeEvidenceEntry[];
}

export interface PythonWorkflowBridgeResult {
  emittedEvidence: PythonWorkflowBridgeEvidenceEntry[];
}

function normalizeWorkspaceRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }

  const joined = segments.join('/');
  return joined.length <= MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS
    ? joined
    : `${joined.slice(0, Math.max(1, MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS - 3)).trimEnd()}...`;
}

function normalizeEnumValue<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
): T[number] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized as T[number]) ? (normalized as T[number]) : undefined;
}

function normalizeText(
  value: unknown,
  options: PythonWorkflowBridgeTextOptions,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= options.maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, options.maxChars - 3)).trimEnd()}...`;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      value
        .map((entry) =>
          normalizeText(entry, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS }),
        )
        .filter(Boolean),
    ),
  ).slice(0, MAX_PYTHON_WORKFLOW_BRIDGE_TAGS) as string[];

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePythonWorkflowBridgeEntry(
  value: unknown,
): PythonWorkflowBridgeEvidenceEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entry = value as Record<string, unknown>;
  const kind = normalizeEnumValue(entry.kind, PYTHON_WORKFLOW_BRIDGE_KIND_VALUES);
  const content = normalizeText(entry.content, {
    maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_CONTENT_CHARS,
  });
  if (!kind || !content) {
    return undefined;
  }

  return {
    ...(normalizeText(entry.id, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS })
      ? {
          id: normalizeText(entry.id, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS }),
        }
      : {}),
    kind,
    ...(normalizeEnumValue(entry.status, PYTHON_WORKFLOW_BRIDGE_STATUS_VALUES)
      ? { status: normalizeEnumValue(entry.status, PYTHON_WORKFLOW_BRIDGE_STATUS_VALUES) }
      : {}),
    ...(normalizeEnumValue(entry.recorder, PYTHON_WORKFLOW_BRIDGE_RECORDER_VALUES)
      ? { recorder: normalizeEnumValue(entry.recorder, PYTHON_WORKFLOW_BRIDGE_RECORDER_VALUES) }
      : {}),
    ...(normalizeText(entry.title, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_TITLE_CHARS })
      ? { title: normalizeText(entry.title, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_TITLE_CHARS }) }
      : {}),
    content,
    ...(normalizeText(entry.dedupeKey, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS })
      ? {
          dedupeKey: normalizeText(entry.dedupeKey, {
            maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
          }),
        }
      : {}),
    ...(normalizeText(entry.sourceName, {
      maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
    })
      ? {
          sourceName: normalizeText(entry.sourceName, {
            maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
          }),
        }
      : {}),
    ...(normalizeText(entry.sourceUri, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS })
      ? {
          sourceUri: normalizeText(entry.sourceUri, {
            maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
          }),
        }
      : {}),
    ...(normalizeText(entry.toolName, { maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS })
      ? {
          toolName: normalizeText(entry.toolName, {
            maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
          }),
        }
      : {}),
    ...(normalizeText(entry.workerSessionId, {
      maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
    })
      ? {
          workerSessionId: normalizeText(entry.workerSessionId, {
            maxChars: MAX_PYTHON_WORKFLOW_BRIDGE_OPTIONAL_TEXT_CHARS,
          }),
        }
      : {}),
    ...(normalizeWorkspaceRelativePath(entry.artifactWorkspacePath)
      ? { artifactWorkspacePath: normalizeWorkspaceRelativePath(entry.artifactWorkspacePath) }
      : {}),
    ...(normalizeTags(entry.tags) ? { tags: normalizeTags(entry.tags) } : {}),
    ...(normalizeTimestamp(entry.createdAt) !== undefined
      ? { createdAt: normalizeTimestamp(entry.createdAt) }
      : {}),
    ...(normalizeTimestamp(entry.updatedAt) !== undefined
      ? { updatedAt: normalizeTimestamp(entry.updatedAt) }
      : {}),
  };
}

export function normalizePythonWorkflowBridgeEntries(
  entries: unknown,
  maxEntries = MAX_PYTHON_WORKFLOW_BRIDGE_ENTRIES,
): PythonWorkflowBridgeEvidenceEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizePythonWorkflowBridgeEntry(entry))
    .filter((entry): entry is PythonWorkflowBridgeEvidenceEntry => Boolean(entry))
    .slice(-Math.max(1, maxEntries));
}

export function normalizePythonWorkflowBridgeState(
  value: unknown,
): PythonWorkflowBridgeState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const evidence = normalizePythonWorkflowBridgeEntries((value as { evidence?: unknown }).evidence);
  return { evidence };
}

export function normalizePythonWorkflowBridgeResult(
  value: unknown,
): PythonWorkflowBridgeResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const emittedEvidence = normalizePythonWorkflowBridgeEntries(
    (value as { emittedEvidence?: unknown }).emittedEvidence,
  );
  return emittedEvidence.length > 0 ? { emittedEvidence } : undefined;
}

export {
  MAX_PYTHON_WORKFLOW_BRIDGE_CONTENT_CHARS,
  MAX_PYTHON_WORKFLOW_BRIDGE_ENTRIES,
  PYTHON_WORKFLOW_BRIDGE_KIND_VALUES,
  PYTHON_WORKFLOW_BRIDGE_RECORDER_VALUES,
  PYTHON_WORKFLOW_BRIDGE_STATUS_VALUES,
};
