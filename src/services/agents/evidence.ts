import {
  AgentRunEvidenceEntry,
  AgentRunEvidenceKind,
  AgentRunEvidenceRecorder,
  AgentRunEvidenceStatus,
} from '../../types';
import { generateId } from '../../utils/id';

export const MAX_AGENT_RUN_EVIDENCE_ENTRIES = 96;

const MAX_AGENT_RUN_EVIDENCE_TAGS = 8;
const MAX_EVIDENCE_READ_ENTRIES = 24;
const MAX_EVIDENCE_CONTENT_CHARS = 400;

export const AGENT_RUN_EVIDENCE_KIND_VALUES: AgentRunEvidenceKind[] = [
  'fact',
  'source',
  'decision',
  'risk',
  'question',
  'artifact',
  'summary',
];

export const AGENT_RUN_EVIDENCE_STATUS_VALUES: AgentRunEvidenceStatus[] = [
  'candidate',
  'verified',
  'open',
  'resolved',
];

export const AGENT_RUN_EVIDENCE_RECORDER_VALUES: AgentRunEvidenceRecorder[] = [
  'supervisor',
  'worker',
  'pilot',
  'python',
  'tool',
  'system',
];

export interface AgentRunEvidenceDraft {
  id?: string;
  kind: AgentRunEvidenceKind;
  status?: AgentRunEvidenceStatus;
  recorder?: AgentRunEvidenceRecorder;
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

export interface AgentRunEvidenceFilter {
  kinds?: AgentRunEvidenceKind[];
  statuses?: AgentRunEvidenceStatus[];
  recorders?: AgentRunEvidenceRecorder[];
  query?: string;
  limit?: number;
  includeContent?: boolean;
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.trim() || '';
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function normalizeEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && allowedValues.includes(value as T) ? (value as T) : fallback;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)),
  ).slice(0, MAX_AGENT_RUN_EVIDENCE_TAGS);

  return normalized.length > 0 ? normalized : undefined;
}

function defaultStatusForKind(kind: AgentRunEvidenceKind): AgentRunEvidenceStatus {
  return kind === 'question' ? 'open' : 'candidate';
}

function buildDefaultTitle(kind: AgentRunEvidenceKind, content: string): string {
  return truncateText(content, 80) || `${kind[0].toUpperCase()}${kind.slice(1)} entry`;
}

export function normalizeAgentRunEvidenceEntry(
  entry: AgentRunEvidenceDraft | AgentRunEvidenceEntry,
  timestamp = Date.now(),
): AgentRunEvidenceEntry | undefined {
  const kind = normalizeEnumValue(entry?.kind, AGENT_RUN_EVIDENCE_KIND_VALUES, 'fact');
  const content = normalizeOptionalText(entry?.content);
  if (!content) {
    return undefined;
  }

  const title = normalizeOptionalText(entry?.title) || buildDefaultTitle(kind, content);
  const normalizedTimestamp = Number.isFinite(entry?.updatedAt)
    ? Number(entry.updatedAt)
    : timestamp;
  const createdAt = Number.isFinite(entry?.createdAt)
    ? Number(entry.createdAt)
    : normalizedTimestamp;

  return {
    id: normalizeOptionalText(entry?.id) || generateId(),
    kind,
    status: normalizeEnumValue(
      entry?.status,
      AGENT_RUN_EVIDENCE_STATUS_VALUES,
      defaultStatusForKind(kind),
    ),
    recorder: normalizeEnumValue(entry?.recorder, AGENT_RUN_EVIDENCE_RECORDER_VALUES, 'supervisor'),
    title,
    content,
    ...(normalizeOptionalText(entry?.dedupeKey)
      ? { dedupeKey: normalizeOptionalText(entry?.dedupeKey) }
      : {}),
    ...(normalizeOptionalText(entry?.sourceName)
      ? { sourceName: normalizeOptionalText(entry?.sourceName) }
      : {}),
    ...(normalizeOptionalText(entry?.sourceUri)
      ? { sourceUri: normalizeOptionalText(entry?.sourceUri) }
      : {}),
    ...(normalizeOptionalText(entry?.toolName)
      ? { toolName: normalizeOptionalText(entry?.toolName) }
      : {}),
    ...(normalizeOptionalText(entry?.workerSessionId)
      ? { workerSessionId: normalizeOptionalText(entry?.workerSessionId) }
      : {}),
    ...(normalizeOptionalText(entry?.artifactWorkspacePath)
      ? { artifactWorkspacePath: normalizeOptionalText(entry?.artifactWorkspacePath) }
      : {}),
    ...(normalizeOptionalTags(entry?.tags) ? { tags: normalizeOptionalTags(entry?.tags) } : {}),
    createdAt,
    updatedAt: normalizedTimestamp,
  };
}

export function normalizeAgentRunEvidenceEntries(
  entries: ReadonlyArray<AgentRunEvidenceEntry | AgentRunEvidenceDraft> | undefined,
): AgentRunEvidenceEntry[] {
  return (entries ?? [])
    .map((entry) => normalizeAgentRunEvidenceEntry(entry))
    .filter((entry): entry is AgentRunEvidenceEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt - right.updatedAt;
      }
      return left.createdAt - right.createdAt;
    })
    .slice(-MAX_AGENT_RUN_EVIDENCE_ENTRIES);
}

export function upsertAgentRunEvidenceEntries(
  existingEntries: ReadonlyArray<AgentRunEvidenceEntry | AgentRunEvidenceDraft> | undefined,
  nextEntries: ReadonlyArray<AgentRunEvidenceEntry | AgentRunEvidenceDraft>,
  timestamp = Date.now(),
): AgentRunEvidenceEntry[] {
  const normalizedExisting = normalizeAgentRunEvidenceEntries(existingEntries);
  const draftEntries = nextEntries
    .map((entry) => ({
      raw: entry,
      normalized: normalizeAgentRunEvidenceEntry(entry, timestamp),
    }))
    .filter(
      (
        entry,
      ): entry is {
        raw: AgentRunEvidenceDraft | AgentRunEvidenceEntry;
        normalized: AgentRunEvidenceEntry;
      } => Boolean(entry.normalized),
    );

  if (draftEntries.length === 0) {
    return normalizedExisting;
  }

  const merged = [...normalizedExisting];
  for (const draftEntry of draftEntries) {
    const { raw, normalized: nextEntry } = draftEntry;
    const matchIndex = merged.findIndex(
      (existingEntry) =>
        (nextEntry.dedupeKey && existingEntry.dedupeKey === nextEntry.dedupeKey) ||
        existingEntry.id === nextEntry.id,
    );

    if (matchIndex < 0) {
      merged.push(nextEntry);
      continue;
    }

    const existingEntry = merged[matchIndex];
    merged[matchIndex] = {
      ...existingEntry,
      ...nextEntry,
      title: normalizeOptionalText(raw.title) ?? existingEntry.title,
      status: raw.status ? nextEntry.status : existingEntry.status,
      recorder: raw.recorder ? nextEntry.recorder : existingEntry.recorder,
      id: existingEntry.id,
      createdAt: existingEntry.createdAt,
      updatedAt: nextEntry.updatedAt,
    };
  }

  return normalizeAgentRunEvidenceEntries(merged);
}

export function filterAgentRunEvidenceEntries(
  entries: ReadonlyArray<AgentRunEvidenceEntry> | undefined,
  filter?: AgentRunEvidenceFilter,
): AgentRunEvidenceEntry[] {
  const kinds = filter?.kinds?.length ? new Set(filter.kinds) : null;
  const statuses = filter?.statuses?.length ? new Set(filter.statuses) : null;
  const recorders = filter?.recorders?.length ? new Set(filter.recorders) : null;
  const query = filter?.query?.trim().toLowerCase();

  const filtered = normalizeAgentRunEvidenceEntries(entries).filter((entry) => {
    if (kinds && !kinds.has(entry.kind)) {
      return false;
    }
    if (statuses && !statuses.has(entry.status)) {
      return false;
    }
    if (recorders && !recorders.has(entry.recorder)) {
      return false;
    }
    if (!query) {
      return true;
    }

    const haystack = [
      entry.title,
      entry.content,
      entry.sourceName,
      entry.sourceUri,
      entry.toolName,
      entry.workerSessionId,
      ...(entry.tags ?? []),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    return haystack.includes(query);
  });

  const limit =
    Number.isFinite(filter?.limit) && Number(filter?.limit) > 0
      ? Math.min(MAX_EVIDENCE_READ_ENTRIES, Math.max(1, Math.trunc(Number(filter?.limit))))
      : undefined;

  return limit ? filtered.slice(-limit) : filtered;
}

function formatEvidenceLine(entry: AgentRunEvidenceEntry, includeContent: boolean): string {
  const prefix = `[${entry.status} ${entry.kind}] ${entry.title}`;
  const parts = [prefix];

  if (includeContent) {
    const content = truncateText(entry.content, MAX_EVIDENCE_CONTENT_CHARS);
    if (content) {
      parts.push(content);
    }
  }

  const metadata: string[] = [];
  if (entry.recorder) {
    metadata.push(`recorder=${entry.recorder}`);
  }
  if (entry.sourceName) {
    metadata.push(`source=${entry.sourceName}`);
  }
  if (entry.toolName) {
    metadata.push(`tool=${entry.toolName}`);
  }
  if (entry.workerSessionId) {
    metadata.push(`worker=${entry.workerSessionId}`);
  }
  if (entry.artifactWorkspacePath) {
    metadata.push(`artifact=${entry.artifactWorkspacePath}`);
  }
  if (entry.tags?.length) {
    metadata.push(`tags=${entry.tags.join(',')}`);
  }
  if (metadata.length > 0) {
    parts.push(`(${metadata.join('; ')})`);
  }

  return `- ${parts.join(' | ')}`;
}

export function buildAgentRunEvidencePromptSection(
  entries: ReadonlyArray<AgentRunEvidenceEntry> | undefined,
  options?: { limit?: number; includeContent?: boolean; heading?: string },
): string | undefined {
  const normalizedEntries = normalizeAgentRunEvidenceEntries(entries);
  if (normalizedEntries.length === 0) {
    return undefined;
  }

  const limit =
    Number.isFinite(options?.limit) && Number(options?.limit) > 0
      ? Math.min(MAX_EVIDENCE_READ_ENTRIES, Math.max(1, Math.trunc(Number(options?.limit))))
      : 12;
  const includeContent = options?.includeContent !== false;
  const heading = options?.heading?.trim() || 'Structured evidence ledger:';
  const lines = normalizedEntries
    .slice(-limit)
    .map((entry) => formatEvidenceLine(entry, includeContent));
  return [heading, ...lines].join('\n');
}
