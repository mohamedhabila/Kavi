// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions + Executors
// ---------------------------------------------------------------------------
// File edit, glob search, cron management tools.

import * as Crypto from 'expo-crypto';
import {
  getOptionalToolBooleanArg,
  getOptionalToolStringArg,
  requireToolStringArg,
  sanitizeWorkspaceRelativePath,
} from './fileArgumentUtils';
import {
  normalizeGlobSearchResult,
  normalizeTextSearchResult,
  type TextSearchMatch,
} from './resultNormalization/webSearchResult';
import { applyFocusedTextEditOperations, normalizeFocusedTextEditOperations } from './focusedEdits';
import { resolveConversationWorkspaceSource } from '../../services/workspaces/source';
import {
  readWorkspaceSourceTextFile,
  writeWorkspaceSourceTextFile,
  workspaceSourceDirectoryExists,
} from '../../services/workspaces/sourceFiles';
import { listWorkspaceSourceTree } from '../../services/workspaces/sourceSearch';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export {
  CRON_TOOL,
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  IMAGE_EDIT_TOOL,
  IMAGE_GEN_TOOL,
  TEXT_SEARCH_TOOL,
} from './extended-definitions';

export async function executeFileEdit(
  args: {
    path: string;
    edits: Array<Record<string, unknown>>;
  },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const rawArgs = args as Record<string, unknown>;
  const pathArg = requireToolStringArg(rawArgs, 'path', 'file_edit', {
    allRequired: ['path', 'edits'],
  });
  if (pathArg.error) return failedToolOutcome(pathArg.error);

  const editsArg = normalizeFocusedTextEditOperations(rawArgs.edits, 'file_edit', 'edits');
  if (editsArg.error) return failedToolOutcome(editsArg.error);

  if (!editsArg.operations?.length) {
    return failedToolOutcome(
      'Error: "edits" for file_edit must contain at least one focused update.',
    );
  }

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value!);
  if (!safePath) return failedToolOutcome('Error: "path" is required for file_edit');
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let content: string;
  try {
    const result = await readWorkspaceSourceTextFile(source, safePath);
    content = result.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }

  const applyResult = applyFocusedTextEditOperations(content, editsArg.operations, 'file_edit');
  if (applyResult.error) return failedToolOutcome(applyResult.error);

  const newContent = applyResult.content!;
  let sha256: string;
  let result: Awaited<ReturnType<typeof writeWorkspaceSourceTextFile>>;
  try {
    sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, newContent);
    result = await writeWorkspaceSourceTextFile(source, safePath, newContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }

  try {
    const readback = await readWorkspaceSourceTextFile(source, result.path);
    if (readback.path !== result.path || readback.content !== newContent) {
      return failedToolOutcome(
        JSON.stringify({
          status: 'edited_unverified',
          path: result.path,
          size: result.size,
          sha256,
          editCount: editsArg.operations.length,
          verificationError: 'workspace_readback_mismatch',
        }),
      );
    }
    return completedToolOutcome(
      JSON.stringify({
        status: 'edited',
        path: readback.path,
        size: readback.size,
        sha256,
        editCount: editsArg.operations.length,
        summary: `Edited and verified ${readback.path} with ${editsArg.operations.length} focused update(s)`,
      }),
    );
  } catch {
    return failedToolOutcome(
      JSON.stringify({
        status: 'edited_unverified',
        path: result.path,
        size: result.size,
        sha256,
        editCount: editsArg.operations.length,
        verificationError: 'workspace_readback_failed',
      }),
    );
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '§QUESTIONMARK§')
    .replace(/\*\*\//g, '§DOUBLESTARDIR§')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLESTARDIR§/g, '(?:.*/)?')
    .replace(/§DOUBLESTAR§/g, '.*')
    .replace(/§QUESTIONMARK§/g, '.');
  return new RegExp(`^${escaped}$`);
}

export async function executeGlobSearch(
  args: { pattern: string; path?: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const patternArg = requireToolStringArg(
    args as Record<string, unknown>,
    'pattern',
    'glob_search',
  );
  if (patternArg.error) return failedToolOutcome(patternArg.error);
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'glob_search');
  if (pathArg.error) return failedToolOutcome(pathArg.error);

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let allFiles: string[];
  try {
    if (!(await workspaceSourceDirectoryExists(source, safePath))) {
      return failedToolOutcome(`Error: directory not found: ${safePath || '/'}`);
    }
    allFiles = await listWorkspaceSourceTree(source, safePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }
  const regex = globToRegex(patternArg.value!);
  const matches = allFiles.filter((f) => regex.test(f));

  return completedToolOutcome(
    normalizeGlobSearchResult({
      pattern: patternArg.value!,
      path: safePath || '.',
      matches,
    }),
  );
}

export async function executeTextSearch(
  args: { query: string; path?: string; isRegex?: boolean },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<ToolRuntimeOutcome> {
  const queryArg = requireToolStringArg(args as Record<string, unknown>, 'query', 'text_search');
  if (queryArg.error) return failedToolOutcome(queryArg.error);
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'text_search');
  if (pathArg.error) return failedToolOutcome(pathArg.error);
  const isRegexArg = getOptionalToolBooleanArg(
    args as Record<string, unknown>,
    'isRegex',
    'text_search',
  );
  if (isRegexArg.error) return failedToolOutcome(isRegexArg.error);

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let allFiles: string[];
  try {
    if (!(await workspaceSourceDirectoryExists(source, safePath))) {
      return failedToolOutcome(`Error: directory not found: ${safePath || '/'}`);
    }
    allFiles = (await listWorkspaceSourceTree(source, safePath)).filter((f) => !f.endsWith('/'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedToolOutcome(`Error: ${message}`);
  }
  const results: TextSearchMatch[] = [];
  const maxResults = 50;
  let truncated = false;

  let pattern: RegExp;
  try {
    pattern = isRegexArg.value
      ? new RegExp(queryArg.value!, 'gi')
      : new RegExp(queryArg.value!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch {
    return failedToolOutcome('Error: invalid regex pattern');
  }

  for (const filePath of allFiles) {
    if (results.length >= maxResults) {
      truncated = true;
      break;
    }
    try {
      const content = (
        await readWorkspaceSourceTextFile(source, safePath ? `${safePath}/${filePath}` : filePath)
      ).content;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) {
          truncated = true;
          break;
        }
        if (pattern.test(lines[i])) {
          results.push({ path: filePath, line: i + 1, text: lines[i] });
        }
        pattern.lastIndex = 0;
      }
    } catch {
      // Skip unreadable files
    }
  }
  return completedToolOutcome(
    normalizeTextSearchResult({
      query: queryArg.value!,
      path: safePath || '.',
      isRegex: isRegexArg.value === true,
      matches: results,
      truncated,
    }),
  );
}
