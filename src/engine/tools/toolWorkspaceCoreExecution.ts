import { getOptionalToolStringArg, requireToolStringArg } from './fileArgumentUtils';
import { sha256HexUtf8Async } from '../../utils/sha256Async';
import { resolveConversationWorkspaceSource } from '../../services/workspaces/source';
import {
  listWorkspaceSourceDirectory,
  readWorkspaceSourceTextFile,
  writeWorkspaceSourceTextFile,
  workspaceSourceDirectoryExists,
} from '../../services/workspaces/sourceFiles';
import {
  completedToolOutcome,
  completedToolOutcomeWithExactResultEvidence,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { TOOL_OUTPUT_SPILL_BYTE_THRESHOLD } from './toolOutputSpill';

const READ_FILE_CHUNK_RESULT_BYTE_LIMIT = TOOL_OUTPUT_SPILL_BYTE_THRESHOLD - 512;

type ReadFileChunk = {
  status: 'read_chunk';
  path: string;
  sha256: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  totalBytes: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  complete: boolean;
  guidance: string;
};

function countNewlines(value: string, end = value.length): number {
  let count = 0;
  for (let index = 0; index < end; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function avoidSplittingSurrogatePair(value: string, offset: number, end: number): number {
  if (end <= offset || end >= value.length) return end;
  const previous = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? end - 1
    : end;
}

function buildReadFileChunk(params: {
  path: string;
  content: string;
  sha256: string;
  offset: number;
  totalBytes: number;
}): string {
  const { path, content, sha256, offset, totalBytes } = params;
  const encoder = new TextEncoder();
  const totalChars = content.length;
  const totalLines = countNewlines(content) + 1;
  const startLine = countNewlines(content, offset) + 1;

  const serialize = (requestedEnd: number): string => {
    const end = avoidSplittingSurrogatePair(content, offset, requestedEnd);
    const chunkContent = content.slice(offset, end);
    const complete = end >= totalChars;
    const payload: ReadFileChunk = {
      status: 'read_chunk',
      path,
      sha256,
      content: chunkContent,
      offset,
      nextOffset: complete ? null : end,
      totalChars,
      totalBytes,
      startLine,
      endLine: startLine + countNewlines(chunkContent),
      totalLines,
      complete,
      guidance: complete
        ? `End of file reached. Do not call read_file again with path ${JSON.stringify(path)} and offset ${offset}.`
        : `Call read_file again with the same path and offset ${end}. Do not read a spill file.`,
    };
    return JSON.stringify(payload);
  };

  let low = offset;
  let high = totalChars;
  let best = serialize(offset);
  let bestEnd = offset;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidateEnd = avoidSplittingSurrogatePair(content, offset, midpoint);
    const candidate = serialize(candidateEnd);
    if (encoder.encode(candidate).byteLength <= READ_FILE_CHUNK_RESULT_BYTE_LIMIT) {
      best = candidate;
      bestEnd = candidateEnd;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  if (bestEnd === offset && offset < totalChars) {
    const nextEnd =
      resultCodePointWidth(content, offset) === 2 ? Math.min(offset + 2, totalChars) : offset + 1;
    const smallestProgressingChunk = serialize(nextEnd);
    if (encoder.encode(smallestProgressingChunk).byteLength > READ_FILE_CHUNK_RESULT_BYTE_LIMIT) {
      throw new Error('read_file metadata exceeds the inline result budget');
    }
    return smallestProgressingChunk;
  }

  return best;
}

function resultCodePointWidth(value: string, offset: number): number {
  const first = value.charCodeAt(offset);
  const second = value.charCodeAt(offset + 1);
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1;
}

export async function executeReadFile(
  args: { path: string; offset?: number },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'read_file');
  if (pathArg.error) return failedToolOutcome(pathArg.error);
  const requestedOffset = (args as Record<string, unknown>).offset;
  if (
    requestedOffset !== undefined &&
    (typeof requestedOffset !== 'number' ||
      !Number.isSafeInteger(requestedOffset) ||
      requestedOffset < 0)
  ) {
    return failedToolOutcome(
      'Error: read_file offset must be a non-negative integer. Do not retry with the same arguments.',
    );
  }

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  try {
    const result = await readWorkspaceSourceTextFile(source, pathArg.value!);
    const offset = requestedOffset ?? 0;
    if (offset > result.content.length) {
      return failedToolOutcome(
        `Error: read_file offset ${offset} exceeds the file length ${result.content.length}. ` +
          'Do not retry with the same arguments.',
      );
    }
    if (
      offset > 0 &&
      offset < result.content.length &&
      result.content.charCodeAt(offset - 1) >= 0xd800 &&
      result.content.charCodeAt(offset - 1) <= 0xdbff &&
      result.content.charCodeAt(offset) >= 0xdc00 &&
      result.content.charCodeAt(offset) <= 0xdfff
    ) {
      return failedToolOutcome(
        'Error: read_file offset splits a Unicode character. Use the nextOffset returned by the previous chunk.',
      );
    }
    const totalBytes = new TextEncoder().encode(result.content).byteLength;
    if (requestedOffset === undefined && totalBytes <= TOOL_OUTPUT_SPILL_BYTE_THRESHOLD) {
      return completedToolOutcomeWithExactResultEvidence(result.content);
    }
    const chunk = buildReadFileChunk({
      path: result.path,
      content: result.content,
      sha256: await sha256HexUtf8Async(result.content),
      offset,
      totalBytes,
    });
    return completedToolOutcomeWithExactResultEvidence(chunk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }
}

export async function executeWriteFile(
  args: { path: string; content: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'write_file', {
    allRequired: ['path', 'content'],
  });
  if (pathArg.error) return failedToolOutcome(pathArg.error);
  const contentArg = requireToolStringArg(
    args as Record<string, unknown>,
    'content',
    'write_file',
    { allowEmpty: true, allRequired: ['path', 'content'] },
  );
  if (contentArg.error) return failedToolOutcome(contentArg.error);

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  let sha256: string;
  let result: Awaited<ReturnType<typeof writeWorkspaceSourceTextFile>>;
  try {
    sha256 = await sha256HexUtf8Async(contentArg.value!);
    result = await writeWorkspaceSourceTextFile(source, pathArg.value!, contentArg.value!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }

  try {
    const readback = await readWorkspaceSourceTextFile(source, result.path);
    if (readback.path !== result.path || readback.content !== contentArg.value!) {
      return failedToolOutcome(
        JSON.stringify({
          status: 'written_unverified',
          path: result.path,
          size: result.size,
          sha256,
          verificationError: 'workspace_readback_mismatch',
        }),
      );
    }
    return completedToolOutcome(
      JSON.stringify({
        status: 'written',
        path: readback.path,
        size: readback.size,
        sha256,
        summary: `Wrote ${readback.size} chars to ${readback.path} and verified readback`,
      }),
    );
  } catch {
    return failedToolOutcome(
      JSON.stringify({
        status: 'written_unverified',
        path: result.path,
        size: result.size,
        sha256,
        verificationError: 'workspace_readback_failed',
      }),
    );
  }
}

export async function executeListFiles(
  args: { path?: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'list_files');
  if (pathArg.error) return failedToolOutcome(pathArg.error);

  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);
  try {
    const requestedPath = pathArg.value || '';
    if (requestedPath && !(await workspaceSourceDirectoryExists(source, requestedPath))) {
      return failedToolOutcome(`Error: directory not found: ${requestedPath.trim() || '/'}`);
    }
    const result = await listWorkspaceSourceDirectory(source, requestedPath);
    const entries = result.entries
      .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
      .sort();

    return completedToolOutcome(entries.length > 0 ? entries.join('\n') : '(empty directory)');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }
}
