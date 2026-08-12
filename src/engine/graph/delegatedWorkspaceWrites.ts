// ---------------------------------------------------------------------------
// Kavi — Delegated Workspace Writes
// ---------------------------------------------------------------------------
// Workspace files a delegated worker produced, read back out of its transcript.
//
// A worker's `artifacts` are collected with `collectResolvedAttachments`, which
// reads message attachments — images and files attached to a message. A file
// written by a tool produces no attachment, so a worker whose entire job is to
// write a document reports `artifactCount: 0`.
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
// It then rewrote the file the worker had already produced.
//
// Which tools write, which results mean the file exists, and where the path sits
// in a result are all read from the code-owned effect contracts rather than named
// here. A tool earns its way in by declaring `artifact.write`, so tools added
// later — including ones this file has never heard of — are covered without edits,
// and no result text is pattern matched.
// ---------------------------------------------------------------------------

import type { Attachment } from '../../types/attachment';
import type { Message } from '../../types/message';
import { getCodeOwnedToolEffectContract } from '../toolExecution/toolEffectReceiptContracts';

const WORKSPACE_ARTIFACT_EFFECT_KIND = 'artifact.write';
/** Resource kind the contracts use for a file addressable by workspace-relative path. */
const WORKSPACE_FILE_RESOURCE_KIND = 'workspace_file';

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(source: unknown, path: ReadonlyArray<string>): unknown {
  return path.reduce<unknown>(
    (value, key) => (isJsonRecord(value) ? value[key] : undefined),
    source,
  );
}

function parseResult(content: string | undefined): Record<string, unknown> | undefined {
  if (!content) {
    return undefined;
  }
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The workspace path a result proves exists, or undefined.
 *
 * The contract supplies every judgement: whether the tool writes artifacts at all, which
 * of its result statuses mean the write landed, and where the path lives in the payload.
 * A status the contract does not map — a refusal, a read, a failure — yields nothing,
 * because only an outcome that reports the effect applied proves a file is there.
 */
function readWrittenWorkspacePath(
  toolName: string | undefined,
  resultText: string | undefined,
): string | undefined {
  const contract = getCodeOwnedToolEffectContract(toolName?.trim() || '');
  if (!contract || contract.effectKind !== WORKSPACE_ARTIFACT_EFFECT_KIND) {
    return undefined;
  }

  const resultContract = contract.result;
  const selector = resultContract?.resource;
  if (!resultContract || !selector || selector.source !== 'result') {
    return undefined;
  }

  /**
   * `artifact.write` covers more than files: canvas_create declares it too, and its
   * resource is a `canvas_surface` identified by surfaceId. Only a resource the contract
   * calls a workspace file names a path an evidence.artifact criterion can match.
   */
  if (selector.kind !== WORKSPACE_FILE_RESOURCE_KIND) {
    return undefined;
  }

  const result = parseResult(resultText);
  if (!result) {
    return undefined;
  }

  const status = readPath(result, resultContract.statusPath);
  const outcome = typeof status === 'string' ? resultContract.outcomes[status] : undefined;
  if (!outcome || outcome.effectState !== 'applied') {
    return undefined;
  }

  const path = readPath(result, selector.path);
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

/**
 * Workspace paths the transcript shows were produced, in first-seen order.
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
      const path = readWrittenWorkspacePath(toolCall.name, toolCall.result ?? undefined);
      if (path) {
        paths.add(path);
      }
      // A tool message carries the result beside the call that produced it.
      if (message.role === 'tool') {
        const fromMessage = readWrittenWorkspacePath(toolCall.name, message.content);
        if (fromMessage) {
          paths.add(fromMessage);
        }
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
