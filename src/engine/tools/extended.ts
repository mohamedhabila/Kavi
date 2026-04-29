// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions + Executors
// ---------------------------------------------------------------------------
// File edit, glob search, cron management tools.

import { Paths, File, Directory } from 'expo-file-system';
import { ToolDefinition } from '../../types';
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
} from './toolResultNormalization';
import {
  applyFocusedTextEditOperations,
  type FocusedTextEditOperation,
  normalizeFocusedTextEditOperations,
} from './focusedEdits';

// ── File Edit Tool (find & replace) ──────────────────────────────────────

export const FILE_EDIT_TOOL: ToolDefinition = {
  name: 'file_edit',
  description:
    'Edit an existing file with focused updates instead of rewriting the entire document. ' +
    'Preferred usage: pass edits as an ordered array of replace, delete, insert_before, or insert_after operations. ' +
    'Each edit must match unique surrounding context, and all edits are applied atomically. ' +
    'Legacy oldText/newText single-replace arguments remain supported for backward compatibility.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace root' },
      oldText: {
        type: 'string',
        description:
          'Legacy exact text to find and replace (must match uniquely). Prefer edits[].oldText for new calls.',
      },
      newText: {
        type: 'string',
        description: 'Legacy replacement text. Prefer edits[].newText for new calls.',
      },
      edits: {
        type: 'array',
        description:
          'Ordered focused edits. Prefer this over oldText/newText for multiple changes or insert/delete operations.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              description:
                'Operation: replace, delete, insert_before, or insert_after. Defaults to replace.',
            },
            oldText: {
              type: 'string',
              description:
                'Exact anchor or target text. It must match uniquely in the latest file content.',
            },
            newText: {
              type: 'string',
              description:
                'Replacement or inserted text. Omit or use an empty string when op is delete.',
            },
          },
          required: ['oldText'],
        },
      },
    },
    required: ['path'],
  },
};

export async function executeFileEdit(
  args: {
    path: string;
    oldText?: string;
    newText?: string;
    edits?: Array<Record<string, unknown>>;
  },
  conversationId: string,
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

  const dir = new Directory(Paths.document, 'workspace', conversationId);
  const safePath = sanitizeWorkspaceRelativePath(pathArg.value!);
  if (!safePath) return 'Error: "path" is required for file_edit';
  const file = new File(dir, safePath);

  if (!file.exists) return `Error: file not found: ${safePath}`;

  const content = await file.text();
  const applyResult = applyFocusedTextEditOperations(
    content,
    normalizedOperations.value!,
    'file_edit',
  );
  if (applyResult.error) return applyResult.error;

  const newContent = applyResult.content!;
  file.write(newContent);
  return `Successfully edited ${safePath} with ${normalizedOperations.value!.length} focused update(s)`;
}

// ── Glob Search Tool ─────────────────────────────────────────────────────

export const GLOB_SEARCH_TOOL: ToolDefinition = {
  name: 'glob_search',
  description:
    'Search for files matching a pattern in the workspace. Supports * and ** wildcards. ' +
    'Returns a list of matching file paths.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "*.ts", "src/**/*.js")' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
    },
    required: ['pattern'],
  },
};

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

function listRecursive(dir: Directory, prefix: string): string[] {
  if (!dir.exists) return [];
  const results: string[] = [];
  for (const entry of dir.list()) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if ('text' in entry) {
      // It's a file
      results.push(fullPath);
    } else {
      // It's a directory
      results.push(`${fullPath}/`);
      results.push(...listRecursive(entry as Directory, fullPath));
    }
  }
  return results;
}

export async function executeGlobSearch(
  args: { pattern: string; path?: string },
  conversationId: string,
): Promise<string> {
  const patternArg = requireToolStringArg(
    args as Record<string, unknown>,
    'pattern',
    'glob_search',
  );
  if (patternArg.error) return patternArg.error;
  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'glob_search');
  if (pathArg.error) return pathArg.error;

  const dir = new Directory(Paths.document, 'workspace', conversationId);
  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const searchDir = safePath ? new Directory(dir, safePath) : dir;

  if (!searchDir.exists) return `Error: directory not found: ${safePath || '/'}`;

  const allFiles = listRecursive(searchDir, '');
  const regex = globToRegex(patternArg.value!);
  const matches = allFiles.filter((f) => regex.test(f));

  return normalizeGlobSearchResult({
    pattern: patternArg.value!,
    path: safePath || '.',
    matches,
  });
}

// ── Text Search Tool (grep) ──────────────────────────────────────────────

export const TEXT_SEARCH_TOOL: ToolDefinition = {
  name: 'text_search',
  description:
    'Search for text content across files in the workspace. Returns matching lines with file paths and line numbers.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
      isRegex: {
        type: 'boolean',
        description: 'Whether query is a regex pattern (default: false)',
      },
    },
    required: ['query'],
  },
};

export async function executeTextSearch(
  args: { query: string; path?: string; isRegex?: boolean },
  conversationId: string,
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

  const dir = new Directory(Paths.document, 'workspace', conversationId);
  const safePath = sanitizeWorkspaceRelativePath(pathArg.value || '');
  const searchDir = safePath ? new Directory(dir, safePath) : dir;

  if (!searchDir.exists) return `Error: directory not found: ${safePath || '/'}`;

  const allFiles = listRecursive(searchDir, '').filter((f) => !f.endsWith('/'));
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
      const file = new File(searchDir, filePath);
      if (!file.exists) continue;
      const content = await file.text();
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

// ── Cron Management Tool ─────────────────────────────────────────────────

export const CRON_TOOL: ToolDefinition = {
  name: 'cron',
  description:
    'Manage scheduled tasks (cron jobs). Create, list, update, delete, or run tasks. ' +
    'Tasks run on a schedule using cron expressions.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: create, list, update, delete, run, enable, disable',
      },
      id: { type: 'string', description: 'Task ID (for update/delete/run/enable/disable)' },
      name: { type: 'string', description: 'Task name (for create)' },
      schedule: { type: 'string', description: 'Cron expression (for create/update)' },
      prompt: { type: 'string', description: 'Task prompt/instruction (for create/update)' },
      timezone: { type: 'string', description: 'Timezone (default: device timezone)' },
    },
    required: ['action'],
  },
};

// ── Image Generation Tool ────────────────────────────────────────────────

export const IMAGE_GEN_TOOL: ToolDefinition = {
  name: 'image_generate',
  description:
    'Generate an image using the active provider and save it to a local file or temporary remote URL.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Image description/prompt' },
      model: {
        type: 'string',
        description:
          'Optional image model override, e.g. gpt-image-2 or gemini-3.1-flash-image-preview',
      },
      size: {
        type: 'string',
        description: 'Image size, e.g. 1024x1024, 1024x1536, 1536x1024, 1792x1024, 1024x1792',
      },
      quality: {
        type: 'string',
        description: 'Generation quality, e.g. standard, hd, low, medium, high, auto',
      },
      format: { type: 'string', description: 'Output format: png, jpeg, or webp' },
      background: {
        type: 'string',
        description: 'Background: transparent, opaque, or auto (GPT image models)',
      },
      style: { type: 'string', description: 'Style for DALL-E 3: vivid or natural' },
    },
    required: ['prompt'],
  },
  strict: true,
};

export const IMAGE_EDIT_TOOL: ToolDefinition = {
  name: 'image_edit',
  description:
    'Edit one or more existing images from the conversation workspace using a text instruction. ' +
    'Use imagePath for the primary image and imagePaths for additional references. ' +
    'Returns a saved edited image file.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Editing instruction describing exactly what to change and what must stay the same',
      },
      imagePath: {
        type: 'string',
        description: 'Primary input image path relative to the conversation workspace',
      },
      imagePaths: {
        type: 'array',
        description:
          'Additional input image paths relative to the conversation workspace. The first image remains the main canvas when provided with imagePath.',
        items: { type: 'string' },
      },
      maskPath: {
        type: 'string',
        description:
          'Optional mask image path relative to the conversation workspace. Best supported by GPT Image models.',
      },
      model: {
        type: 'string',
        description:
          'Optional image model override, e.g. gpt-image-2 or gemini-3.1-flash-image-preview',
      },
      size: {
        type: 'string',
        description:
          'Requested output size or aspect ratio, e.g. auto, 1024x1024, 1024x1536, 16:9, 1K, or 2K',
      },
      quality: { type: 'string', description: 'Output quality, e.g. low, medium, high, or auto' },
      format: { type: 'string', description: 'Output format: png, jpeg, or webp' },
      background: {
        type: 'string',
        description: 'Background: transparent, opaque, or auto (GPT image models)',
      },
      inputFidelity: {
        type: 'string',
        description: 'Input fidelity: high or low (GPT image models)',
      },
      moderation: {
        type: 'string',
        description: 'Moderation level: auto or low (GPT image models)',
      },
      outputCompression: {
        type: 'number',
        description: 'Compression level 0-100 for jpeg or webp output (GPT image models)',
      },
    },
    required: ['prompt'],
  },
  strict: true,
};
