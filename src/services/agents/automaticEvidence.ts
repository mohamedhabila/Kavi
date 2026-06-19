import type { AgentRunEvidenceDraft } from './lifecycle/evidenceTypes';
import type { Attachment } from '../../types/attachment';
import type { SubAgentLifecycleEvent, SubAgentSnapshot } from '../../types/subAgent';

const MAX_AUTOMATIC_EVIDENCE_CONTENT_CHARS = 640;
const MAX_AUTOMATIC_EVIDENCE_TITLE_CHARS = 120;

type PythonAutomaticEvidenceParams = {
  success: boolean;
  output?: string;
  error?: string;
  files?: Array<{ path: string }>;
  emittedEvidenceCount?: number;
  workerSessionId?: string;
};

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim() || '';
  return normalized ? normalized : undefined;
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function summarizeUniqueTools(toolsUsed: string[] | undefined): string | undefined {
  const uniqueTools = Array.from(
    new Set((toolsUsed ?? []).map((toolName) => toolName.trim()).filter(Boolean)),
  );
  if (uniqueTools.length === 0) {
    return undefined;
  }

  return `Tools used: ${uniqueTools.join(', ')}.`;
}

function buildWorkerSummaryContent(agent: SubAgentSnapshot): string | undefined {
  const sections = [
    truncateText(agent.output, MAX_AUTOMATIC_EVIDENCE_CONTENT_CHARS),
    agent.output
      ? undefined
      : truncateText(agent.lastToolResultPreview, MAX_AUTOMATIC_EVIDENCE_CONTENT_CHARS),
    typeof agent.iterations === 'number' && agent.iterations > 0
      ? `Iterations: ${agent.iterations}.`
      : undefined,
    summarizeUniqueTools(agent.toolsUsed),
  ].filter((value): value is string => Boolean(value));

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function buildArtifactDrafts(
  attachments: Attachment[] | undefined,
  params: {
    recorder: AgentRunEvidenceDraft['recorder'];
    workerSessionId?: string;
    status: AgentRunEvidenceDraft['status'];
    titlePrefix: string;
    dedupeKeyPrefix: string;
    content: string;
  },
): AgentRunEvidenceDraft[] {
  const drafts: AgentRunEvidenceDraft[] = [];

  for (const attachment of attachments ?? []) {
    const workspacePath = normalizeText(attachment.workspacePath);
    const sourceUri = normalizeText(attachment.uri);
    const sourceName = truncateText(attachment.name, MAX_AUTOMATIC_EVIDENCE_TITLE_CHARS);
    const title = sourceName || workspacePath || sourceUri;
    const dedupeIdentity = workspacePath || sourceUri || title;

    if (!title || !dedupeIdentity) {
      continue;
    }

    drafts.push({
      kind: 'artifact',
      status: params.status,
      recorder: params.recorder,
      title: truncateText(`${params.titlePrefix}${title}`, MAX_AUTOMATIC_EVIDENCE_TITLE_CHARS),
      content: params.content,
      dedupeKey: `${params.dedupeKeyPrefix}:${dedupeIdentity}`,
      ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
      ...(workspacePath ? { artifactWorkspacePath: workspacePath } : {}),
      ...(sourceUri ? { sourceUri } : {}),
      ...(sourceName ? { sourceName } : {}),
      tags: ['artifact'],
    });
  }

  return drafts;
}

export function buildAutomaticSubAgentEvidenceEntries(
  agent: SubAgentSnapshot,
  event: SubAgentLifecycleEvent,
): AgentRunEvidenceDraft[] {
  if (event === 'started') {
    return [];
  }

  const workerLabel =
    truncateText(agent.name || agent.sessionId, MAX_AUTOMATIC_EVIDENCE_TITLE_CHARS) ||
    agent.sessionId;
  const summaryContent = buildWorkerSummaryContent(agent);
  const workerSessionId = normalizeText(agent.sessionId);

  if (event === 'completed') {
    const content = summaryContent || `Worker ${workerLabel} completed with verified output.`;
    return [
      {
        kind: 'summary',
        status: 'verified',
        recorder: 'worker',
        title: `Worker completed: ${workerLabel}`,
        content,
        dedupeKey: `worker-summary:${agent.sessionId}:completed`,
        ...(workerSessionId ? { workerSessionId } : {}),
        tags: ['worker', 'completed'],
      },
      ...buildArtifactDrafts(agent.artifacts, {
        recorder: 'worker',
        workerSessionId,
        status: 'verified',
        titlePrefix: `${workerLabel} artifact: `,
        dedupeKeyPrefix: `worker-artifact:${agent.sessionId}`,
        content: `Artifact produced by worker ${workerLabel}.`,
      }),
    ];
  }

  if (event === 'error' || event === 'timeout') {
    const content =
      summaryContent ||
      `Worker ${workerLabel} ${event === 'timeout' ? 'timed out' : 'failed'} before completing the assigned task.`;
    return [
      {
        kind: 'risk',
        status: 'open',
        recorder: 'worker',
        title:
          event === 'timeout'
            ? `Worker timed out: ${workerLabel}`
            : `Worker failed: ${workerLabel}`,
        content,
        dedupeKey: `worker-terminal:${agent.sessionId}`,
        ...(workerSessionId ? { workerSessionId } : {}),
        tags: ['worker', event],
      },
      ...buildArtifactDrafts(agent.artifacts, {
        recorder: 'worker',
        workerSessionId,
        status: 'candidate',
        titlePrefix: `${workerLabel} artifact: `,
        dedupeKeyPrefix: `worker-artifact:${agent.sessionId}`,
        content: `Artifact retained from worker ${workerLabel} after ${event}.`,
      }),
    ];
  }

  if (event === 'cancelled') {
    const content = summaryContent || `Worker ${workerLabel} was cancelled before final delivery.`;
    return [
      {
        kind: 'summary',
        status: 'resolved',
        recorder: 'worker',
        title: `Worker cancelled: ${workerLabel}`,
        content,
        dedupeKey: `worker-terminal:${agent.sessionId}`,
        ...(workerSessionId ? { workerSessionId } : {}),
        tags: ['worker', 'cancelled'],
      },
      ...buildArtifactDrafts(agent.artifacts, {
        recorder: 'worker',
        workerSessionId,
        status: 'candidate',
        titlePrefix: `${workerLabel} artifact: `,
        dedupeKeyPrefix: `worker-artifact:${agent.sessionId}`,
        content: `Artifact retained from cancelled worker ${workerLabel}.`,
      }),
    ];
  }

  return [];
}

export function buildAutomaticPythonEvidenceEntries(
  params: PythonAutomaticEvidenceParams,
): AgentRunEvidenceDraft[] {
  const output = truncateText(params.output, MAX_AUTOMATIC_EVIDENCE_CONTENT_CHARS);
  const error = truncateText(params.error, MAX_AUTOMATIC_EVIDENCE_CONTENT_CHARS);
  const emittedEvidenceCount = Number.isFinite(params.emittedEvidenceCount)
    ? Math.max(0, Math.trunc(params.emittedEvidenceCount || 0))
    : 0;
  const filePaths = Array.from(
    new Set((params.files ?? []).map((file) => normalizeText(file.path)).filter(Boolean)),
  ) as string[];
  const workerSessionId = normalizeText(params.workerSessionId);
  const drafts: AgentRunEvidenceDraft[] = [];

  if (params.success) {
    const contentSections = [
      output || 'Python execution completed successfully.',
      emittedEvidenceCount > 0
        ? `Recorded ${emittedEvidenceCount} structured workflow evidence entr${emittedEvidenceCount === 1 ? 'y' : 'ies'} from Python.`
        : undefined,
      filePaths.length > 0 ? `Workspace files updated: ${filePaths.join(', ')}.` : undefined,
    ].filter((value): value is string => Boolean(value));

    drafts.push({
      kind: 'summary',
      status: 'verified',
      recorder: 'python',
      title: 'Python execution completed',
      content: contentSections.join('\n\n'),
      dedupeKey: 'python:last-execution',
      ...(workerSessionId ? { workerSessionId } : {}),
      tags: ['python'],
    });
  } else {
    const contentSections = [
      error || 'Python execution failed.',
      output && output !== error ? output : undefined,
    ].filter((value): value is string => Boolean(value));

    drafts.push({
      kind: 'risk',
      status: 'open',
      recorder: 'python',
      title: 'Python execution failed',
      content: contentSections.join('\n\n') || 'Python execution failed.',
      dedupeKey: 'python:last-execution',
      ...(workerSessionId ? { workerSessionId } : {}),
      tags: ['python', 'error'],
    });
  }

  for (const path of filePaths) {
    drafts.push({
      kind: 'artifact',
      status: 'verified',
      recorder: 'python',
      title: truncateText(`Python artifact: ${path}`, MAX_AUTOMATIC_EVIDENCE_TITLE_CHARS),
      content: 'Workspace artifact written by Python execution.',
      dedupeKey: `python:artifact:${path}`,
      ...(workerSessionId ? { workerSessionId } : {}),
      artifactWorkspacePath: path,
      tags: ['python', 'artifact'],
    });
  }

  return drafts;
}
