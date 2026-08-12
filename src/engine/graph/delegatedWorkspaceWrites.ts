// ---------------------------------------------------------------------------
// Kavi — Delegated Workspace Writes
// ---------------------------------------------------------------------------
// Workspace files a delegated worker wrote, read back out of its own transcript.
//
// A worker's `artifacts` are collected with `collectResolvedAttachments`, which
// reads message attachments — images and files attached to a message. A file
// written with `write_file` produces no attachment, so a worker whose entire job
// is to write a document reports `artifactCount: 0`.
//
// Traced live on an Android emulator. The worker wrote artifacts/tl4/risks.md and
// terminated `verified_success`, and its result still carried `artifacts: null`.
// Delegated-artifact evidence is derived from that field, so the supervisor's
// `evidence.artifact:artifacts/tl4/risks.md` criterion could never be satisfied by
// the delegation. The model read the graph correctly and concluded it had to do
// the work itself:
//
//   "The risks.md and verify goals need the artifact evidence recorded by a
//    parent write_file. Let me write risks.md with the verified worker content
//    to register that evidence."
//
// It then rewrote the file the worker had already produced. Delegation doubled
// the work instead of saving it.
//
// The write receipts are already in the worker's transcript: every successful
// `write_file` result names the path it verified. Reading them back is what makes
// a delegated deliverable count as delivered.
// ---------------------------------------------------------------------------

import type { Attachment } from '../../types/attachment';
import type { Message } from '../../types/message';

/** Tools whose successful result names a workspace path they persisted. */
const WORKSPACE_WRITE_TOOL_NAMES = new Set(['write_file', 'file_edit']);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readWrittenPath(content: string | undefined): string | undefined {
  if (!content || !content.includes('"path"')) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    if (!isJsonRecord(parsed)) {
      return undefined;
    }
    // Only a result that reports a persisted write counts. A read, a refusal, or a
    // failed attempt names a path too, and none of them prove the file exists.
    if (parsed.status !== 'written' && parsed.status !== 'edited') {
      return undefined;
    }
    const path = parsed.path;
    return typeof path === 'string' && path.trim() ? path.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Workspace paths the transcript shows were written, in first-seen order.
 *
 * Shaped like the attachment list the delegated-evidence collector already reads, so a
 * written file and an attached file are credited the same way.
 */
export function collectDelegatedWorkspaceWrites(
  messages: ReadonlyArray<Pick<Message, 'role' | 'content' | 'toolCalls'>>,
): Attachment[] {
  const paths = new Set<string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const name = toolCall.name?.trim();
      if (!name || !WORKSPACE_WRITE_TOOL_NAMES.has(name)) {
        continue;
      }
      const path = readWrittenPath(toolCall.result ?? undefined);
      if (path) {
        paths.add(path);
      }
    }

    if (message.role === 'tool') {
      const path = readWrittenPath(message.content);
      if (path) {
        paths.add(path);
      }
    }
  }

  return [...paths].map((workspacePath) => ({
    id: `workspace-write:${workspacePath}`,
    type: 'file' as const,
    uri: `workspace://${workspacePath}`,
    name: workspacePath.split('/').pop() || workspacePath,
    mimeType: 'text/plain',
    size: 0,
    workspacePath,
  }));
}
