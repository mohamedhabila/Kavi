// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions + Executors
// ---------------------------------------------------------------------------
// File edit, glob search, cron management tools.

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
import {
  applyFocusedTextEditOperations,
  type FocusedTextEditOperation,
  normalizeFocusedTextEditOperations,
} from './focusedEdits';
import { resolveConversationWorkspaceSource } from '../../services/workspaces/source';
import {
  readWorkspaceSourceTextFile,
  writeWorkspaceSourceTextFile,
  workspaceSourceDirectoryExists,
} from '../../services/workspaces/sourceFiles';
import { listWorkspaceSourceTree } from '../../services/workspaces/sourceSearch';

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
    oldText?: string;
    newText?: string;
    edits?: Array<Record<string, unknown>>;
  },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const rawArgs = args as Record<string, unknown>;
  const pathArg = requireToolStringArg(rawArgs, 'path', 'file_edit', {
    allRequired: ['path', 'edits or oldText/newText'],
  });
  if (pathArg.error) return pathArg.error;

  const editsArg = normalizeFocusedTextEditOperations(rawArgs.edits, 'file_edit', 'edits');
  if (editsArg.error) return editsArg.error;

  const hasLegacyOldText = typeof rawArgs.oldText !== 'undefined';
  const hasLegacyNewText = typeof rawArgs.newText !== 'undefined';
  if (editsArg.operations?.length && (hasLegacyOldText || hasLegacyNewText)) {
    return 'Error: file_edit accepts either edits or oldText/newText, not both. Prefer edits for focused updates.';
  }

  let normalizedOperations: { value?: FocusedTextEditOperation[]; error?: string };
  if (editsArg.operations?.length) {
    normalizedOperations = { value: editsArg.operations };
  } else {
    const oldTextArg = requireToolStringArg(rawArgs, 'oldText', 'file_edit', {
      allRequired: ['path', 'oldText', 'newText'],
    });
    if (oldTextArg.error) return oldTextArg.error;
    const newTextArg = requireToolStringArg(rawArgs, 'newText', 'file_edit', {
      allowEmpty: true,
      allRequired: ['path', 'oldText', 'newText'],
    });
    if (newTextArg.error) return newTextArg.error;
    normalizedOperations = {
      value: [{ op: 'replace' as const, oldText: oldTextArg.value!, newText: newTextArg.value! }],
    };
  }

  if ('error' in normalizedOperations && normalizedOperations.error) {
    return normalizedOperations.error;
  }

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value!);
  if (!safePath) return 'Error: "path" is required for file_edit';
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let content: string;
  try {
    const result = await readWorkspaceSourceTextFile(source, safePath);
    content = result.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }

  const applyResult = applyFocusedTextEditOperations(
    content,
    normalizedOperations.value!,
    'file_edit',
  );
  if (applyResult.error) return applyResult.error;

  const newContent = applyResult.content!;
  try {
    await writeWorkspaceSourceTextFile(source, safePath, newContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
  return `Successfully edited ${safePath} with ${normalizedOperations.value!.length} focused update(s)`;
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
): Promise<string> {
  const patternArg = requireToolStringArg(
    args as Record<string, unknown>,
    'pattern',
    'glob_search',
  );
  if (patternArg.error) return patternArg.error;
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'glob_search');
  if (pathArg.error) return pathArg.error;

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let allFiles: string[];
  try {
    if (!(await workspaceSourceDirectoryExists(source, safePath))) {
      return `Error: directory not found: ${safePath || '/'}`;
    }
    allFiles = await listWorkspaceSourceTree(source, safePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
  const regex = globToRegex(patternArg.value!);
  const matches = allFiles.filter((f) => regex.test(f));

  return normalizeGlobSearchResult({
    pattern: patternArg.value!,
    path: safePath || '.',
    matches,
  });
}

export async function executeTextSearch(
  args: { query: string; path?: string; isRegex?: boolean },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const queryArg = requireToolStringArg(args as Record<string, unknown>, 'query', 'text_search');
  if (queryArg.error) return queryArg.error;
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'text_search');
  if (pathArg.error) return pathArg.error;
  const isRegexArg = getOptionalToolBooleanArg(
    args as Record<string, unknown>,
    'isRegex',
    'text_search',
  );
  if (isRegexArg.error) return isRegexArg.error;

  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const source = resolveConversationWorkspaceSource(conversationId, fallbackConversationId);

  let allFiles: string[];
  try {
    if (!(await workspaceSourceDirectoryExists(source, safePath))) {
      return `Error: directory not found: ${safePath || '/'}`;
    }
    allFiles = (await listWorkspaceSourceTree(source, safePath)).filter((f) => !f.endsWith('/'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
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
    return 'Error: invalid regex pattern';
  }

  for (const filePath of allFiles) {
    if (results.length >= maxResults) {
      truncated = true;
      break;
    }
    try {
      const content = (await readWorkspaceSourceTextFile(
        source,
        safePath ? `${safePath}/${filePath}` : filePath,
      )).content;
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
  return normalizeTextSearchResult({
    query: queryArg.value!,
    path: safePath || '.',
    isRegex: isRegexArg.value === true,
    matches: results,
    truncated,
  });
}
