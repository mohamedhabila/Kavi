import {
  persistCanvasSourceBundle,
  type PersistedCanvasSourceFile,
} from '../../services/canvas/bundles';
import type { CanvasSourceBundle } from '../../types/canvas';
import { normalizeCanvasTextContent } from './builtin-canvas-helpers';
import {
  CANVAS_CSS_FILE_EXTENSION_PATTERN,
  CANVAS_HTML_FILE_EXTENSION_PATTERN,
  CANVAS_JAVASCRIPT_FILE_EXTENSION_PATTERN,
} from './builtin-canvas-sourcePathing';
import type { CanvasToolExecutionContext } from './builtin-canvas-sourceTypes';

const CANVAS_MAX_SOURCE_TOTAL_CHARS = 750_000;

function getCanvasSourceFileKind(path: string): 'html' | 'css' | 'js' | undefined {
  if (CANVAS_HTML_FILE_EXTENSION_PATTERN.test(path)) {
    return 'html';
  }

  if (CANVAS_CSS_FILE_EXTENSION_PATTERN.test(path)) {
    return 'css';
  }

  if (CANVAS_JAVASCRIPT_FILE_EXTENSION_PATTERN.test(path)) {
    return 'js';
  }

  return undefined;
}

export async function readCanvasSourceFiles(
  operation: 'canvas_create' | 'canvas_update',
  filePaths: string[],
  executionContext: CanvasToolExecutionContext,
): Promise<{ files?: PersistedCanvasSourceFile[]; error?: string }> {
  if (!executionContext.readConversationFile) {
    return {
      error: `Error: ${operation} HTML source requires an active conversation workspace. Use content instead if you do not have local HTML files.`,
    };
  }

  const uniqueFilePaths = Array.from(new Set(filePaths)).sort();
  const files: PersistedCanvasSourceFile[] = [];
  let totalChars = 0;

  for (const path of uniqueFilePaths) {
    const kind = getCanvasSourceFileKind(path);
    if (!kind) {
      continue;
    }

    try {
      const raw = await executionContext.readConversationFile(path);
      const content = kind === 'html' ? normalizeCanvasTextContent(raw) : raw;
      if (!content && kind === 'html') {
        return {
          error: `Error: ${operation} HTML file "${path}" is empty.`,
        };
      }

      totalChars += content?.length || 0;
      if (totalChars > CANVAS_MAX_SOURCE_TOTAL_CHARS) {
        return {
          error: `Error: ${operation} expanded canvas source exceeded ${CANVAS_MAX_SOURCE_TOTAL_CHARS.toLocaleString()} characters.`,
        };
      }

      files.push({ path, content: content || '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: `Error: ${operation} could not read HTML source file "${path}": ${message}`,
      };
    }
  }

  return { files };
}

export async function persistCanvasSourceFiles(params: {
  surfaceId: string;
  operation: 'canvas_create' | 'canvas_update';
  sourceRootPath: string;
  entryFilePath: string;
  sourceBundle: CanvasSourceBundle;
  files: PersistedCanvasSourceFile[];
}): Promise<{ sourceBundle?: CanvasSourceBundle; error?: string }> {
  try {
    const sourceBundle = await persistCanvasSourceBundle({
      surfaceId: params.surfaceId,
      sourceRootPath: params.sourceRootPath,
      entryFilePath: params.entryFilePath,
      files: params.files,
      sourceBundle: params.sourceBundle,
    });

    return { sourceBundle };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Error: ${params.operation} could not persist local canvas bundle: ${message}`,
    };
  }
}
