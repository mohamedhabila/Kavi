import type { CanvasSourceBundle } from '../../types/canvas';
import { looksLikeCanvasHtmlContent } from './builtin-canvas-helpers';
import {
  buildCanvasSourceBundle,
  CANVAS_HTML_FILE_EXTENSION_PATTERN,
  collectCanvasSourcePathsFromDirectory,
  collectCanvasSourcePathsFromEntryHtml,
  getWorkspaceParentPath,
  resolveRelativeWorkspacePath,
} from './builtin-canvas-sourcePathing';
import { persistCanvasSourceFiles, readCanvasSourceFiles } from './builtin-canvas-sourceStorage';
import type { CanvasToolExecutionContext } from './builtin-canvas-sourceTypes';

async function resolveCanvasFileHtmlSource(
  surfaceId: string,
  operation: 'canvas_create' | 'canvas_update',
  filePath: string,
  executionContext: CanvasToolExecutionContext,
): Promise<{
  content?: string;
  filePath?: string;
  sourceBundle?: CanvasSourceBundle;
  error?: string;
}> {
  if (!CANVAS_HTML_FILE_EXTENSION_PATTERN.test(filePath)) {
    return {
      error: `Error: ${operation} filePath must point to an .html or .htm file in the conversation workspace.`,
    };
  }

  const sourceRootPath = getWorkspaceParentPath(filePath);
  const collected = await collectCanvasSourcePathsFromEntryHtml(
    operation,
    filePath,
    executionContext,
  );
  if (collected.error) {
    return collected;
  }

  const sourcePaths = collected.paths || [filePath];

  const filesResult = await readCanvasSourceFiles(operation, sourcePaths, executionContext);
  if (filesResult.error) {
    return { error: filesResult.error };
  }

  const files = filesResult.files || [];
  const entryFile = files.find((file) => file.path === filePath);
  if (!entryFile) {
    return {
      error: `Error: ${operation} could not read HTML file "${filePath}".`,
    };
  }

  if (!looksLikeCanvasHtmlContent(entryFile.content)) {
    return {
      error: `Error: ${operation} filePath "${filePath}" must contain HTML markup.`,
    };
  }

  const baseSourceBundle = buildCanvasSourceBundle({
    sourceType: 'file',
    filePath,
    entryFilePath: filePath,
    importedFiles: files.map((file) => file.path),
  });

  const persisted = await persistCanvasSourceFiles({
    surfaceId,
    operation,
    sourceRootPath,
    entryFilePath: filePath,
    sourceBundle: baseSourceBundle,
    files,
  });
  if (persisted.error) {
    return { error: persisted.error };
  }

  return {
    content: entryFile.content,
    filePath,
    sourceBundle: persisted.sourceBundle,
  };
}

async function resolveCanvasDirectoryHtmlSource(
  surfaceId: string,
  operation: 'canvas_create' | 'canvas_update',
  directoryPath: string,
  entryFile: string | undefined,
  executionContext: CanvasToolExecutionContext,
): Promise<{
  content?: string;
  directoryPath?: string;
  entryFilePath?: string;
  sourceBundle?: CanvasSourceBundle;
  error?: string;
}> {
  const collected = await collectCanvasSourcePathsFromDirectory(
    operation,
    directoryPath,
    executionContext,
  );
  if (collected.error) {
    return { error: collected.error };
  }

  const sourcePaths = collected.paths || [];
  const htmlFiles = sourcePaths.filter((path) => CANVAS_HTML_FILE_EXTENSION_PATTERN.test(path));
  if (htmlFiles.length === 0) {
    return {
      error: `Error: ${operation} directoryPath "${directoryPath}" must contain at least one .html or .htm file.`,
    };
  }

  let entryFilePath: string | undefined;
  if (entryFile) {
    entryFilePath = resolveRelativeWorkspacePath(directoryPath, entryFile, {
      baseIsDirectory: true,
    });
    if (!entryFilePath || !CANVAS_HTML_FILE_EXTENSION_PATTERN.test(entryFilePath)) {
      return {
        error: `Error: ${operation} entryFile must resolve to an .html or .htm file inside directoryPath "${directoryPath}".`,
      };
    }
    if (!htmlFiles.includes(entryFilePath)) {
      return {
        error: `Error: ${operation} could not find entry HTML file "${entryFilePath}" inside directoryPath "${directoryPath}".`,
      };
    }
  } else {
    const rootIndexFile = htmlFiles.find(
      (path) => path === `${directoryPath}/index.html` || path === `${directoryPath}/index.htm`,
    );
    const rootHtmlFiles = htmlFiles.filter(
      (path) => getWorkspaceParentPath(path) === directoryPath,
    );

    if (rootIndexFile) {
      entryFilePath = rootIndexFile;
    } else if (rootHtmlFiles.length === 1) {
      entryFilePath = rootHtmlFiles[0];
    } else if (htmlFiles.length === 1) {
      entryFilePath = htmlFiles[0];
    } else {
      return {
        error: `Error: ${operation} directoryPath "${directoryPath}" contains multiple HTML files. Provide entryFile to choose one. Found: ${htmlFiles.join(', ')}.`,
      };
    }
  }

  const filesResult = await readCanvasSourceFiles(operation, sourcePaths, executionContext);
  if (filesResult.error) {
    return { error: filesResult.error };
  }

  const files = filesResult.files || [];
  const entryFileContent = files.find((file) => file.path === entryFilePath)?.content;
  if (!entryFileContent) {
    return {
      error: `Error: ${operation} could not read entry HTML file "${entryFilePath}" inside directoryPath "${directoryPath}".`,
    };
  }

  if (!looksLikeCanvasHtmlContent(entryFileContent)) {
    return {
      error: `Error: ${operation} entry HTML file "${entryFilePath}" must contain HTML markup.`,
    };
  }

  const baseSourceBundle = buildCanvasSourceBundle({
    sourceType: 'directory',
    directoryPath,
    entryFilePath,
    importedFiles: files.map((file) => file.path),
  });

  const persisted = await persistCanvasSourceFiles({
    surfaceId,
    operation,
    sourceRootPath: directoryPath,
    entryFilePath,
    sourceBundle: baseSourceBundle,
    files,
  });
  if (persisted.error) {
    return { error: persisted.error };
  }

  return {
    content: entryFileContent,
    directoryPath,
    entryFilePath,
    sourceBundle: persisted.sourceBundle,
  };
}

export async function resolveCanvasHtmlSource(
  surfaceId: string,
  operation: 'canvas_create' | 'canvas_update',
  content: string | undefined,
  filePath: string | undefined,
  directoryPath: string | undefined,
  entryFile: string | undefined,
  executionContext: CanvasToolExecutionContext,
): Promise<{
  content?: string;
  filePath?: string;
  directoryPath?: string;
  entryFilePath?: string;
  sourceBundle?: CanvasSourceBundle;
  error?: string;
}> {
  const sourceCount = [content, filePath, directoryPath].filter(Boolean).length;
  if (sourceCount > 1) {
    return {
      error: `Error: ${operation} accepts either content, filePath, or directoryPath for HTML input, not multiple source inputs. Prefer directoryPath for multi-file canvases or filePath for a single HTML entry file.`,
    };
  }

  if (entryFile && !directoryPath) {
    return {
      error: `Error: ${operation} entryFile can only be used together with directoryPath.`,
    };
  }

  if (content) {
    return {
      content,
      sourceBundle: buildCanvasSourceBundle({ sourceType: 'content' }),
    };
  }

  if (directoryPath) {
    return resolveCanvasDirectoryHtmlSource(
      surfaceId,
      operation,
      directoryPath,
      entryFile,
      executionContext,
    );
  }

  if (!filePath) {
    return {};
  }

  return resolveCanvasFileHtmlSource(surfaceId, operation, filePath, executionContext);
}
