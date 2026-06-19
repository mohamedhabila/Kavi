import type { CanvasSourceBundle } from '../../types/canvas';
import { sanitizeWorkspaceRelativePath } from './fileArgumentUtils';
import { normalizeCanvasTextContent } from './builtin-canvas-helpers';
import type { CanvasToolExecutionContext } from './builtin-canvas-sourceTypes';

export const CANVAS_HTML_FILE_EXTENSION_PATTERN = /\.html?$/i;
export const CANVAS_CSS_FILE_EXTENSION_PATTERN = /\.css$/i;
export const CANVAS_JAVASCRIPT_FILE_EXTENSION_PATTERN = /\.(?:[cm]?js)$/i;
export const CANVAS_SUPPORTED_SOURCE_FILE_EXTENSION_PATTERN = /\.(?:html?|css|[cm]?js)$/i;
export const CANVAS_MAX_SOURCE_FILE_COUNT = 128;

export function getWorkspaceParentPath(path: string): string {
  const normalized = sanitizeWorkspaceRelativePath(path);
  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : '';
}

function buildWorkspaceBaseUrl(path: string, baseIsDirectory: boolean): URL {
  const normalized = sanitizeWorkspaceRelativePath(path);
  const relativePath = normalized.replace(/^\/+/, '');
  if (baseIsDirectory) {
    return new URL(
      `https://canvas.local/${relativePath ? `${relativePath.replace(/\/+$/, '')}/` : ''}`,
    );
  }
  return new URL(`https://canvas.local/${relativePath}`);
}

export function resolveRelativeWorkspacePath(
  basePath: string,
  reference: string,
  options: { baseIsDirectory?: boolean } = {},
): string | undefined {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  const strippedReference = trimmed.split('#')[0]?.split('?')[0] ?? '';
  if (!strippedReference) {
    return undefined;
  }

  if (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(strippedReference) ||
    /^[a-z][a-z0-9+.-]*:/i.test(strippedReference)
  ) {
    return undefined;
  }

  try {
    const resolved = new URL(
      strippedReference,
      buildWorkspaceBaseUrl(basePath, options.baseIsDirectory === true),
    );
    if (resolved.hostname !== 'canvas.local') {
      return undefined;
    }
    return sanitizeWorkspaceRelativePath(resolved.pathname);
  } catch {
    return undefined;
  }
}

export function buildCanvasSourceBundle(params: {
  sourceType: CanvasSourceBundle['sourceType'];
  filePath?: string;
  directoryPath?: string;
  entryFilePath?: string;
  importedFiles?: string[];
}): CanvasSourceBundle {
  return {
    sourceType: params.sourceType,
    ...(params.filePath ? { filePath: params.filePath } : {}),
    ...(params.directoryPath ? { directoryPath: params.directoryPath } : {}),
    ...(params.entryFilePath ? { entryFilePath: params.entryFilePath } : {}),
    ...(params.importedFiles?.length ? { importedFiles: params.importedFiles } : {}),
  };
}

function extractCanvasHtmlSourceReferences(content: string, baseFilePath: string): string[] {
  const references = new Set<string>();
  const attributePattern = /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

  for (const match of content.matchAll(attributePattern)) {
    const reference = match[1] || match[2] || match[3];
    if (!reference) {
      continue;
    }

    const resolvedPath = resolveRelativeWorkspacePath(baseFilePath, reference);
    if (!resolvedPath || !CANVAS_SUPPORTED_SOURCE_FILE_EXTENSION_PATTERN.test(resolvedPath)) {
      continue;
    }

    references.add(resolvedPath);
  }

  return Array.from(references).sort();
}

export async function collectCanvasSourcePathsFromEntryHtml(
  operation: 'canvas_create' | 'canvas_update',
  filePath: string,
  executionContext: CanvasToolExecutionContext,
): Promise<{ paths?: string[]; error?: string }> {
  if (!executionContext.readConversationFile) {
    return {
      error: `Error: ${operation} HTML source requires an active conversation workspace. Use content instead if you do not have local HTML files.`,
    };
  }

  const discoveredPaths = new Set<string>([filePath]);
  const visitedHtmlFiles = new Set<string>();
  const pendingHtmlFiles = [filePath];

  while (pendingHtmlFiles.length > 0) {
    const currentHtmlPath = pendingHtmlFiles.pop()!;
    if (visitedHtmlFiles.has(currentHtmlPath)) {
      continue;
    }

    visitedHtmlFiles.add(currentHtmlPath);

    let content = '';
    try {
      content =
        normalizeCanvasTextContent(await executionContext.readConversationFile(currentHtmlPath)) ||
        '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: `Error: ${operation} could not read HTML source file "${currentHtmlPath}": ${message}`,
      };
    }

    for (const referencedPath of extractCanvasHtmlSourceReferences(content, currentHtmlPath)) {
      if (discoveredPaths.has(referencedPath)) {
        continue;
      }

      discoveredPaths.add(referencedPath);
      if (discoveredPaths.size > CANVAS_MAX_SOURCE_FILE_COUNT) {
        return {
          error: `Error: ${operation} filePath "${filePath}" references too many supported files. Limit the canvas source to ${CANVAS_MAX_SOURCE_FILE_COUNT} HTML/CSS/JS files.`,
        };
      }

      if (CANVAS_HTML_FILE_EXTENSION_PATTERN.test(referencedPath)) {
        pendingHtmlFiles.push(referencedPath);
      }
    }
  }

  return {
    paths: Array.from(discoveredPaths).sort(),
  };
}

export async function collectCanvasSourcePathsFromDirectory(
  operation: 'canvas_create' | 'canvas_update',
  directoryPath: string,
  executionContext: CanvasToolExecutionContext,
): Promise<{ paths?: string[]; error?: string }> {
  if (!executionContext.listConversationDirectory) {
    return {
      error: `Error: ${operation} directoryPath requires an active conversation workspace. Use content instead if you do not have local HTML files.`,
    };
  }

  const supportedFiles = new Set<string>();
  const visitedDirectories = new Set<string>();
  const pendingDirectories = [directoryPath];

  try {
    while (pendingDirectories.length > 0) {
      const currentDirectory = pendingDirectories.pop()!;
      if (visitedDirectories.has(currentDirectory)) {
        continue;
      }

      visitedDirectories.add(currentDirectory);
      const entries = await executionContext.listConversationDirectory(currentDirectory);
      for (const entry of entries) {
        if (entry.kind === 'directory') {
          pendingDirectories.push(entry.path);
          continue;
        }

        if (CANVAS_SUPPORTED_SOURCE_FILE_EXTENSION_PATTERN.test(entry.path)) {
          supportedFiles.add(entry.path);
          if (supportedFiles.size > CANVAS_MAX_SOURCE_FILE_COUNT) {
            return {
              error: `Error: ${operation} directoryPath "${directoryPath}" contains too many supported files. Limit the canvas source to ${CANVAS_MAX_SOURCE_FILE_COUNT} HTML/CSS/JS files.`,
            };
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Error: ${operation} could not read directory "${directoryPath}": ${message}`,
    };
  }

  return {
    paths: Array.from(supportedFiles).sort(),
  };
}
