// ---------------------------------------------------------------------------
// Kavi — Parity Tool Executor
// ---------------------------------------------------------------------------
// Executes new parity tools: canvas, sessions, pdf, camera, audio, memory_search.

import { generateId } from '../../utils/id';
import {
  processCanvasMessage,
  getSurface,
} from '../../services/canvas/renderer';
import {
  persistCanvasSourceBundle,
  type PersistedCanvasSourceFile,
} from '../../services/canvas/bundles';
import type { CanvasReadMode } from '../../services/canvas/types';
import type {
  AgentRunPlan,
  AgentRunWorkstream,
  Attachment,
  CanvasComponent,
  CanvasSourceBundle,
  LlmProviderConfig,
  Message,
  SubAgentSnapshot,
  ToolCall,
} from '../../types';
import {
  cancelSubAgent,
  startSubAgent,
  launchSubAgent,
  listActiveSubAgents,
  getSubAgent,
  getSubAgentsByParent,
  getSessionContext,
  observeBackgroundSubAgentResult,
  waitForSubAgentCompletion,
  waitForSubAgentResultPromise,
} from '../../services/agents/subAgent';
import {
  collectSubAgentSnapshotsFromMessages,
  getSubAgentsForAgentRun,
  resolveDisplayedSubAgentSnapshot,
  resolveOwningConversationId,
} from '../../services/agents/workflowState';
import { createSurfacedSubAgentOutputPayload } from '../../services/agents/surfacedSubAgentOutput';
import {
  evaluateWorkflowSpawnGate,
  inferWorkflowWorkstreamId,
  normalizeWorkflowDependencyReference,
  normalizeWorkflowWorkstreams,
  type WorkflowExecutionStatus,
} from '../../services/agents/workflowScheduling';
import {
  recordCommandPoll,
  resetCommandPollCount,
  pruneStaleCommandPolls,
  type CommandPollState,
} from '../../services/agents/commandPollBackoff';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { requireToolStringArg, sanitizeWorkspaceRelativePath } from './fileArgumentUtils';
import {
  looksLikeCanvasHtmlContent,
  looksLikeHtml,
  normalizeCanvasDirectoryPath,
  normalizeCanvasReadArgs,
  normalizeCanvasTextContent,
  pickFirstCanvasFilePath,
  pickFirstCanvasString,
  resolveCanvasSurfaceTarget,
} from './parity-canvas-helpers';
import {
  applyFocusedTextEditOperations,
  applyJsonPatchSubset,
  normalizeFocusedTextEditOperations,
  normalizeJsonPatchSubsetOperations,
} from './focusedEdits';
import {
  assertProviderReadyForRequest,
  hydrateProviderForRequest,
} from '../../services/llm/providerSupport';
import { resolveToolProviderFamily } from './toolManager';
import { stripAttachmentPayloads } from '../../utils/messageAttachments';
export {
  getLastWorkingDirectory,
  executeSshExec,
  executeSshBackgroundJobStatus,
  executeSshBackgroundJobWait,
  executeSshListDirectory,
  executeSshReadFile,
  executeSshWriteFile,
  executeSshRenamePath,
  executeSshDeletePath,
  executeSshMakeDirectory,
} from './parity-ssh';
export {
  executeExpoEasListProjects,
  executeExpoEasCreateProject,
  executeExpoEasBuild,
  executeExpoEasDeployWeb,
  executeExpoEasGraphql,
  executeExpoEasProbe,
  executeExpoEasStatus,
  executeExpoEasSubmit,
  executeExpoEasUpdate,
  executeExpoEasWorkflowRuns,
  executeExpoEasWorkflowStatus,
  executeExpoEasWorkflowWait,
} from './parity-expo';
export { executeWait, executePdfRead } from './parity-utility';
export { executeCameraSnap, executeAudioTranscribe, executeSpeak } from './parity-media';
export { executeMemorySearch } from './parity-memory';
export {
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryBlockRead,
  executeMemoryBlockEdit,
} from './parity-memory';
export { executePollCreate, executeMessageEffect } from './parity-interaction';
export {
  executeAgentsList,
  executeAgentsSwitch,
  executeAgentsConfigure,
} from './parity-agents';
export { executeToolCatalog } from './parity-tool-catalog';
export {
  executeCanvasNavigate,
  executeCanvasEval,
  executeCanvasRead,
  executeCanvasSnapshot,
  executeCanvasList,
} from './parity-canvas-runtime';

// ── Canvas tools ─────────────────────────────────────────────────────────

type CanvasToolExecutionContext = {
  conversationId?: string;
  readConversationFile?: (path: string) => Promise<string>;
  listConversationDirectory?: (
    path: string,
  ) => Promise<Array<{ path: string; kind: 'file' | 'directory' }>>;
};

const CANVAS_HTML_FILE_EXTENSION_PATTERN = /\.html?$/i;
const CANVAS_CSS_FILE_EXTENSION_PATTERN = /\.css$/i;
const CANVAS_JAVASCRIPT_FILE_EXTENSION_PATTERN = /\.(?:[cm]?js)$/i;
const CANVAS_SUPPORTED_SOURCE_FILE_EXTENSION_PATTERN = /\.(?:html?|css|[cm]?js)$/i;
const CANVAS_MAX_SOURCE_FILE_COUNT = 128;
const CANVAS_MAX_SOURCE_TOTAL_CHARS = 750_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findLatestUserMessageWithAttachments(messages?: Message[]): Message | undefined {
  if (!messages?.length) {
    return undefined;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && (message.attachments?.length || 0) > 0) {
      return message;
    }
  }

  return undefined;
}

function buildDelegatedInitialMessages(
  prompt: string,
  sourceMessage: Message | undefined,
): Message[] | undefined {
  const attachments = stripAttachmentPayloads(sourceMessage?.attachments);
  if (!attachments?.length) {
    return undefined;
  }

  return [
    {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachments,
    },
  ];
}

function normalizeRequiredSessionText(
  value: unknown,
  fieldName: 'prompt' | 'message',
): { value?: string; error?: string } {
  if (typeof value !== 'string') {
    return { error: `Worker ${fieldName} must be a non-empty string.` };
  }

  if (!value.trim()) {
    return { error: `Worker ${fieldName} must be a non-empty string.` };
  }

  return { value };
}

function normalizeDependencyWorkstreamRefs(value: unknown): { values: string[]; error?: string } {
  const normalizeEntries = (entries: ReadonlyArray<string>) =>
    entries
      .map((entry) => normalizeWorkflowDependencyReference(entry))
      .filter((entry): entry is string => Boolean(entry));

  if (value == null) {
    return { values: [] };
  }

  if (Array.isArray(value)) {
    return {
      values: normalizeEntries(
        value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { values: [] };
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return {
            values: [],
            error: 'dependsOnWorkstreams must be an array of strings.',
          };
        }

        return {
          values: normalizeEntries(
            parsed
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        };
      } catch {
        return {
          values: [],
          error: 'dependsOnWorkstreams must be an array of strings.',
        };
      }
    }

    return { values: normalizeEntries([trimmed]) };
  }

  return {
    values: [],
    error: 'dependsOnWorkstreams must be an array of strings.',
  };
}

function normalizeWorkerModel(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveWorkerProviderFamily(
  provider: Pick<LlmProviderConfig, 'id' | 'name' | 'baseUrl' | 'model' | 'kind'>,
) {
  return resolveToolProviderFamily(
    provider.name || provider.id,
    provider.baseUrl,
    provider.model,
    provider.kind,
  );
}

function resolveWorkerModelFamily(model?: string | null) {
  const normalized = normalizeWorkerModel(model);
  if (!normalized) {
    return null;
  }

  const family = resolveToolProviderFamily('', undefined, normalized);
  return family === 'default' ? null : family;
}

function isWorkerModelCompatible(
  provider: Pick<
    LlmProviderConfig,
    'id' | 'name' | 'baseUrl' | 'model' | 'availableModels' | 'hiddenModels' | 'kind'
  >,
  model?: string | null,
): boolean {
  const normalizedModel = normalizeWorkerModel(model);
  if (!normalizedModel) {
    return false;
  }

  const availableModels = provider.availableModels || [];
  const hiddenModels = provider.hiddenModels || [];
  if (availableModels.includes(normalizedModel) || hiddenModels.includes(normalizedModel)) {
    return true;
  }

  const providerFamily = resolveWorkerProviderFamily(provider);
  const modelFamily = resolveWorkerModelFamily(normalizedModel);
  if (!modelFamily) {
    return true;
  }

  return modelFamily === providerFamily;
}

function resolveSpawnWorkerModel(
  provider: Pick<
    LlmProviderConfig,
    'id' | 'name' | 'baseUrl' | 'model' | 'availableModels' | 'hiddenModels'
  >,
  requestedModel?: string | null,
  inheritedModel?: string | null,
): string {
  const normalizedRequestedModel = normalizeWorkerModel(requestedModel);
  if (normalizedRequestedModel) {
    return isWorkerModelCompatible(provider, normalizedRequestedModel)
      ? normalizedRequestedModel
      : normalizeWorkerModel(provider.model) || provider.model;
  }

  const normalizedInheritedModel = normalizeWorkerModel(inheritedModel);
  if (normalizedInheritedModel && isWorkerModelCompatible(provider, normalizedInheritedModel)) {
    return normalizedInheritedModel;
  }

  return normalizeWorkerModel(provider.model) || provider.model;
}

function resolveFollowUpWorkerModel(
  provider: Pick<
    LlmProviderConfig,
    'id' | 'name' | 'baseUrl' | 'model' | 'availableModels' | 'hiddenModels'
  >,
  storedModel?: string | null,
  inheritedModel?: string | null,
): string {
  const normalizedStoredModel = normalizeWorkerModel(storedModel);
  if (normalizedStoredModel && isWorkerModelCompatible(provider, normalizedStoredModel)) {
    return normalizedStoredModel;
  }

  const normalizedInheritedModel = normalizeWorkerModel(inheritedModel);
  if (normalizedInheritedModel && isWorkerModelCompatible(provider, normalizedInheritedModel)) {
    return normalizedInheritedModel;
  }

  return normalizeWorkerModel(provider.model) || provider.model;
}

function mergeWorkerProviderIntoCatalog(
  allProviders: LlmProviderConfig[] | undefined,
  provider: LlmProviderConfig,
): LlmProviderConfig[] | undefined {
  if (!allProviders?.length) {
    return undefined;
  }

  let replaced = false;
  const mergedProviders = allProviders.map((entry) => {
    if (entry.id !== provider.id) {
      return entry;
    }

    replaced = true;
    return { ...entry, ...provider };
  });

  return replaced ? mergedProviders : [...mergedProviders, provider];
}

function getWorkspaceParentPath(path: string): string {
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

function resolveRelativeWorkspacePath(
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

function buildCanvasSourceBundle(params: {
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

async function collectCanvasSourcePathsFromEntryHtml(
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

async function collectCanvasSourcePathsFromDirectory(
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

async function readCanvasSourceFiles(
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

async function persistCanvasSourceFiles(params: {
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

function normalizeCanvasType(rawType?: string): string {
  const normalized = (rawType || '').trim().toLowerCase();
  switch (normalized) {
    case 'paragraph':
    case 'label':
    case 'copy':
      return 'text';
    case 'title':
    case 'header':
      return 'heading';
    case 'btn':
    case 'cta':
      return 'button';
    case 'textbox':
    case 'textinput':
      return 'input';
    case 'img':
    case 'photo':
      return 'image';
    case 'stack':
    case 'column':
    case 'section':
      return 'container';
    case 'columns':
    case 'hstack':
      return 'row';
    case 'checklist':
      return 'list';
    case 'rule':
    case 'hr':
      return 'divider';
    default:
      return normalized || 'container';
  }
}

function normalizeCanvasComponent(
  value: unknown,
  fallbackType: string = 'text',
): CanvasComponent | null {
  if (typeof value === 'string') {
    const text = normalizeCanvasTextContent(value);
    if (!text) return null;
    return {
      id: `canvas-text-${generateId()}`,
      type: 'text',
      props: { text },
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const explicitProps = isRecord(value.props) ? { ...value.props } : {};
  const props = { ...explicitProps } as Record<string, unknown>;
  const promotedKeys = [
    'text',
    'label',
    'src',
    'alt',
    'value',
    'placeholder',
    'rows',
    'inputType',
    'options',
    'checked',
    'name',
    'group',
    'headers',
    'action',
  ];
  for (const key of promotedKeys) {
    if (props[key] === undefined && value[key] !== undefined) {
      props[key] = value[key];
    }
  }

  const inferredType =
    typeof value.type === 'string'
      ? value.type
      : typeof value.kind === 'string'
        ? value.kind
        : typeof value.component === 'string'
          ? value.component
          : props.text != null
            ? 'text'
            : Array.isArray(value.children) || Array.isArray(value.items)
              ? 'container'
              : fallbackType;

  const childrenSource = Array.isArray(value.children)
    ? value.children
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.components)
        ? value.components
        : undefined;

  const children = childrenSource
    ?.map((child) => normalizeCanvasComponent(child))
    .filter((child): child is CanvasComponent => Boolean(child));

  return {
    id:
      typeof value.id === 'string' && value.id.trim()
        ? value.id.trim()
        : `canvas-${normalizeCanvasType(inferredType)}-${generateId()}`,
    type: normalizeCanvasType(inferredType),
    props,
    ...(children?.length ? { children } : {}),
  };
}

function normalizeCanvasComponentsInput(input: unknown): CanvasComponent[] | undefined {
  if (input == null) {
    return undefined;
  }

  if (typeof input === 'string') {
    const trimmed = normalizeCanvasTextContent(input);
    if (!trimmed) return undefined;
    if (looksLikeHtml(trimmed)) return undefined;

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizeCanvasComponentsInput(JSON.parse(trimmed));
      } catch {
        return [{ id: `canvas-text-${generateId()}`, type: 'text', props: { text: trimmed } }];
      }
    }

    return [{ id: `canvas-text-${generateId()}`, type: 'text', props: { text: trimmed } }];
  }

  if (Array.isArray(input)) {
    const normalized = input
      .map((entry) => normalizeCanvasComponent(entry))
      .filter((entry): entry is CanvasComponent => Boolean(entry));
    return normalized.length ? normalized : undefined;
  }

  if (isRecord(input)) {
    if (Array.isArray(input.components)) {
      return normalizeCanvasComponentsInput(input.components);
    }
    const single = normalizeCanvasComponent(input, 'container');
    return single ? [single] : undefined;
  }

  return undefined;
}

function deriveCanvasTitle(
  args: Record<string, unknown>,
  content?: string,
  components?: CanvasComponent[],
): string {
  const explicitTitle = pickFirstCanvasString(args, [
    'title',
    'name',
    'label',
    'surfaceTitle',
    'canvasTitle',
  ]);
  if (explicitTitle) {
    return explicitTitle;
  }

  const titleMatch = content?.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]?.trim()) {
    return titleMatch[1].trim();
  }

  const headingText = components?.find((component) => component.type === 'heading')?.props?.text;
  if (typeof headingText === 'string' && headingText.trim()) {
    return headingText.trim();
  }

  return content ? 'Canvas Preview' : 'Canvas Surface';
}

async function resolveCanvasHtmlSource(
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

function normalizeCanvasCreateArgs(args: Record<string, unknown>) {
  const content = pickFirstCanvasString(args, [
    'content',
    'html',
    'rawHtml',
    'raw_html',
    'markup',
    'body',
    'source',
    'template',
  ]);
  const filePath = pickFirstCanvasFilePath(args, [
    'filePath',
    'htmlFile',
    'sourceFile',
    'templateFile',
  ]);
  const directoryPath = normalizeCanvasDirectoryPath(
    pickFirstCanvasFilePath(args, ['directoryPath', 'dirPath', 'folderPath', 'directory']),
  );
  const entryFile = pickFirstCanvasFilePath(args, ['entryFile', 'indexFile', 'mainFile']);
  const components = normalizeCanvasComponentsInput(
    args.components ?? args.componentTree ?? args.tree ?? args.component ?? args.children,
  );
  return {
    title: deriveCanvasTitle(args, content, components),
    content,
    filePath,
    directoryPath,
    entryFile,
    catalogId: pickFirstCanvasString(args, ['catalogId', 'catalog', 'catalogName']),
    components,
    dataModel: isRecord(args.dataModel)
      ? args.dataModel
      : isRecord(args.data)
        ? args.data
        : isRecord(args.model)
          ? args.model
          : undefined,
  };
}

function normalizeCanvasUpdateArgs(args: Record<string, unknown>) {
  const contentEdits = normalizeFocusedTextEditOperations(
    args.contentEdits ?? args.htmlEdits ?? args.sourceEdits,
    'canvas_update',
    'contentEdits',
  );
  const componentOperations = normalizeJsonPatchSubsetOperations(
    args.componentOperations ?? args.componentsPatch ?? args.componentPatch,
    'canvas_update',
    'componentOperations',
  );
  const dataOperations = normalizeJsonPatchSubsetOperations(
    args.dataOperations ?? args.operations ?? args.patch,
    'canvas_update',
    'dataOperations',
  );

  return {
    ...resolveCanvasSurfaceTarget(args, 'canvas_update'),
    ...(contentEdits.error ? { error: contentEdits.error } : {}),
    ...(componentOperations.error ? { error: componentOperations.error } : {}),
    ...(dataOperations.error ? { error: dataOperations.error } : {}),
    content: pickFirstCanvasString(args, [
      'content',
      'html',
      'rawHtml',
      'raw_html',
      'markup',
      'body',
      'source',
      'template',
    ]),
    filePath: pickFirstCanvasFilePath(args, ['filePath', 'htmlFile', 'sourceFile', 'templateFile']),
    directoryPath: normalizeCanvasDirectoryPath(
      pickFirstCanvasFilePath(args, ['directoryPath', 'dirPath', 'folderPath', 'directory']),
    ),
    entryFile: pickFirstCanvasFilePath(args, ['entryFile', 'indexFile', 'mainFile']),
    contentEdits: contentEdits.operations,
    components: normalizeCanvasComponentsInput(
      args.components ?? args.componentTree ?? args.tree ?? args.component ?? args.children,
    ),
    componentOperations: componentOperations.operations,
    dataOperations: dataOperations.operations,
  };
}

export async function executeCanvasCreate(
  args: {
    title: string;
    content?: string;
    filePath?: string;
    directoryPath?: string;
    entryFile?: string;
    catalogId?: string;
    components?: CanvasComponent[];
    dataModel?: Record<string, any>;
  },
  executionContext: CanvasToolExecutionContext = {},
): Promise<string> {
  const normalized = normalizeCanvasCreateArgs(args as Record<string, unknown>);
  const surfaceId = `surface-${generateId()}`;
  const htmlSource = await resolveCanvasHtmlSource(
    surfaceId,
    'canvas_create',
    normalized.content,
    normalized.filePath,
    normalized.directoryPath,
    normalized.entryFile,
    executionContext,
  );
  if (htmlSource.error) return htmlSource.error;

  const title = deriveCanvasTitle(
    args as Record<string, unknown>,
    htmlSource.content,
    normalized.components,
  );
  processCanvasMessage({
    type: 'createSurface',
    surfaceId,
    catalogId: normalized.catalogId || 'default',
    title,
    rawHtml: htmlSource.content,
    sourceBundle: htmlSource.sourceBundle,
    components: normalized.components || [],
    dataModel: normalized.dataModel,
  });
  return JSON.stringify({
    status: 'created',
    surfaceId,
    title,
    renderMode: htmlSource.content ? 'html' : 'components',
    ...(htmlSource.sourceBundle ? { sourceBundle: htmlSource.sourceBundle } : {}),
    guidance: `Canvas created. Next call canvas_eval with {"surfaceId":"${surfaceId}","script":"document.title || 'loaded'"} to open or refresh the preview.`,
  });
}

export async function executeCanvasUpdate(
  args: {
    surfaceId: string;
    content?: string;
    filePath?: string;
    directoryPath?: string;
    entryFile?: string;
    contentEdits?: Array<Record<string, unknown>>;
    components?: CanvasComponent[];
    componentOperations?: Array<Record<string, unknown>>;
    dataOperations?: Array<{ op: string; path: string; value?: any }>;
  },
  executionContext: CanvasToolExecutionContext = {},
): Promise<string> {
  const normalized = normalizeCanvasUpdateArgs(args as Record<string, unknown>);
  if (normalized.error) return normalized.error;

  const htmlSource = await resolveCanvasHtmlSource(
    normalized.surfaceId!,
    'canvas_update',
    normalized.content,
    normalized.filePath,
    normalized.directoryPath,
    normalized.entryFile,
    executionContext,
  );
  if (htmlSource.error) return htmlSource.error;

  const surface = getSurface(normalized.surfaceId!);
  if (!surface) return `Error: surface not found: ${normalized.surfaceId}`;

  if (htmlSource.content && normalized.contentEdits?.length) {
    return 'Error: canvas_update accepts either content, filePath, directoryPath, or contentEdits for HTML updates, not both. Prefer contentEdits for focused changes or directoryPath/filePath after local HTML edits.';
  }

  if (normalized.components?.length && normalized.componentOperations?.length) {
    return 'Error: canvas_update accepts either components or componentOperations for component updates, not both. Prefer componentOperations for focused changes.';
  }

  if (
    !htmlSource.content &&
    !normalized.contentEdits?.length &&
    !normalized.components?.length &&
    !normalized.componentOperations?.length &&
    !normalized.dataOperations?.length
  ) {
    return 'Error: canvas_update requires content, filePath, directoryPath, contentEdits, components, componentOperations, or dataOperations.';
  }

  try {
    const appliedUpdates: string[] = [];

    let nextContent = htmlSource.content;
    let nextSourceBundle = htmlSource.sourceBundle;
    if (normalized.contentEdits?.length) {
      if (surface.renderMode !== 'html' || typeof surface.rawHtml !== 'string') {
        return 'Error: contentEdits can only be used with HTML-mode canvases that have stored rawHtml. Use componentOperations/dataOperations for structured canvases or content for a deliberate mode switch.';
      }

      const contentEditResult = applyFocusedTextEditOperations(
        surface.rawHtml,
        normalized.contentEdits,
        'canvas_update contentEdits',
      );
      if (contentEditResult.error) return contentEditResult.error;
      nextContent = contentEditResult.content!;
      nextSourceBundle = buildCanvasSourceBundle({ sourceType: 'content' });
      appliedUpdates.push(`contentEdits:${normalized.contentEdits.length}`);
    } else if (htmlSource.directoryPath) {
      appliedUpdates.push(`directoryPath:${htmlSource.directoryPath}`);
    } else if (htmlSource.filePath) {
      appliedUpdates.push(`filePath:${htmlSource.filePath}`);
    } else if (htmlSource.content) {
      appliedUpdates.push('content');
    }

    if (nextContent) {
      processCanvasMessage({
        type: 'updateContent',
        surfaceId: normalized.surfaceId!,
        rawHtml: nextContent,
        sourceBundle: nextSourceBundle,
      });
    }

    let nextComponents = normalized.components;
    if (normalized.componentOperations?.length) {
      const componentPatchResult = applyJsonPatchSubset(
        surface.components || [],
        normalized.componentOperations,
        'canvas_update componentOperations',
      );
      if (componentPatchResult.error) return componentPatchResult.error;
      if (!Array.isArray(componentPatchResult.value)) {
        return 'Error: componentOperations must resolve to an array of canvas components.';
      }
      nextComponents = componentPatchResult.value as CanvasComponent[];
      appliedUpdates.push(`componentOperations:${normalized.componentOperations.length}`);
    } else if (normalized.components?.length) {
      appliedUpdates.push('components');
    }

    if (nextComponents?.length) {
      processCanvasMessage({
        type: 'updateComponents',
        surfaceId: normalized.surfaceId!,
        components: nextComponents,
      });
    }

    if (normalized.dataOperations?.length) {
      processCanvasMessage({
        type: 'updateDataModel',
        surfaceId: normalized.surfaceId!,
        operations: normalized.dataOperations.map((op) => ({
          op: op.op,
          path: op.path,
          value: op.value,
        })),
      });
      appliedUpdates.push(`dataOperations:${normalized.dataOperations.length}`);
    }

    return JSON.stringify({
      status: 'updated',
      surfaceId: normalized.surfaceId!,
      appliedUpdates,
      ...(nextSourceBundle ? { sourceBundle: nextSourceBundle } : {}),
      ...(normalized.note ? { note: normalized.note } : {}),
      guidance: `If the user should see the latest canvas, call canvas_eval with {"surfaceId":"${normalized.surfaceId!}","script":"document.title || 'loaded'"}.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', surfaceId: normalized.surfaceId!, error: message });
  }
}

export async function executeCanvasDelete(args: { surfaceId: string }): Promise<string> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_delete');
  if (resolved.error) return JSON.stringify({ status: 'error', error: resolved.error });
  processCanvasMessage({ type: 'deleteSurface', surfaceId: resolved.surfaceId! });
  return JSON.stringify({
    status: 'deleted',
    surfaceId: resolved.surfaceId!,
    ...(resolved.note ? { note: resolved.note } : {}),
  });
}

// ── Session tools ────────────────────────────────────────────────────────

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sessionStatusPollState: CommandPollState = {};
const sessionStatusFingerprints = new Map<string, string>();

function serializeSessionArtifacts(
  artifacts?: Attachment[],
):
  | Array<Pick<Attachment, 'id' | 'type' | 'name' | 'mimeType' | 'size' | 'workspacePath'>>
  | undefined {
  if (!artifacts?.length) {
    return undefined;
  }

  return artifacts.map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    mimeType: artifact.mimeType,
    size: artifact.size,
    workspacePath: artifact.workspacePath,
  }));
}

function buildSessionStatusFingerprint(agent: {
  status: string;
  updatedAt?: number;
  lastProgressAt?: number;
  modelResponsePendingSince?: number;
  launchState?: string;
  output?: string;
  currentActivity?: string;
  activeToolName?: string;
  lastToolResultPreview?: string;
  artifacts?: Attachment[];
}): string {
  return JSON.stringify({
    status: agent.status,
    updatedAt: agent.updatedAt,
    lastProgressAt: agent.lastProgressAt,
    modelResponsePendingSince: agent.modelResponsePendingSince,
    launchState: agent.launchState || '',
    outputPreview: agent.output?.slice(0, 1000) || '',
    currentActivity: agent.currentActivity || '',
    activeToolName: agent.activeToolName || '',
    lastToolResultPreview: agent.lastToolResultPreview || '',
    artifactCount: agent.artifacts?.length || 0,
  });
}

function formatSessionDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

type SessionLiveness = 'active' | 'quiet' | 'stalled';

const SESSION_QUIET_IDLE_MS = 10_000;
const SESSION_STALLED_IDLE_MS = 45_000;
const MODEL_RESPONSE_PENDING_QUIET_MS = 30_000;
const MODEL_RESPONSE_PENDING_STALLED_MS = 120_000;

function getSessionLiveness(params: {
  idleMs: number;
  modelResponseWaitMs?: number;
}): SessionLiveness {
  if (typeof params.modelResponseWaitMs === 'number') {
    if (params.modelResponseWaitMs >= MODEL_RESPONSE_PENDING_STALLED_MS) {
      return 'stalled';
    }
    if (params.modelResponseWaitMs >= MODEL_RESPONSE_PENDING_QUIET_MS) {
      return 'quiet';
    }
    return 'active';
  }

  if (params.idleMs >= SESSION_STALLED_IDLE_MS) {
    return 'stalled';
  }
  if (params.idleMs >= SESSION_QUIET_IDLE_MS) {
    return 'quiet';
  }
  return 'active';
}

function getModelResponseWaitMs(params: {
  now: number;
  modelResponsePendingSince?: number;
}): number | undefined {
  if (typeof params.modelResponsePendingSince !== 'number') {
    return undefined;
  }

  return Math.max(0, params.now - params.modelResponsePendingSince);
}

function isAwaitingModelResponse(modelResponseWaitMs?: number): boolean {
  return typeof modelResponseWaitMs === 'number';
}

function getSessionLivenessLabel(params: {
  idleMs: number;
  modelResponseWaitMs?: number;
}): SessionLiveness {
  return getSessionLiveness(params);
}

function buildSessionPollingGuidance(params: {
  status: string;
  recommendedWaitMs?: number;
  hasNewActivity?: boolean;
  launchState?: string;
  currentActivity?: string;
  idleMs?: number;
  liveness?: SessionLiveness;
  awaitingModelResponse?: boolean;
  modelResponseWaitMs?: number;
}): string | undefined {
  if (params.status !== 'running' || !params.recommendedWaitMs) {
    return undefined;
  }

  const currentActivitySuffix = params.currentActivity
    ? ` Current activity: ${params.currentActivity}.`
    : '';
  const blockingWaitSuffix =
    ' If you must block, call sessions_wait for that session instead of alternating sessions_status and wait.';

  if (params.launchState === 'queued') {
    return `The worker is still bootstrapping.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling sessions_status again.${blockingWaitSuffix} If it stays queued with no progress, call sessions_cancel and respawn it.`;
  }

  if (params.awaitingModelResponse && typeof params.modelResponseWaitMs === 'number') {
    return `The worker is still waiting for the model's response after ${formatSessionDuration(params.modelResponseWaitMs)}.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again, or use sessions_wait if you need to block.${blockingWaitSuffix} Do not cancel for this delay alone unless it remains unchanged much longer or the task is clearly off track.`;
  }

  if (params.liveness === 'stalled' && typeof params.idleMs === 'number') {
    return `The worker has been idle for ${formatSessionDuration(params.idleMs)}.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix} If it is still unchanged after that poll, call sessions_cancel and respawn it with corrected instructions.`;
  }

  if (params.hasNewActivity) {
    return `New worker activity was observed.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix} If the worker is drifting or redundant, call sessions_cancel and respawn it.`;
  }

  return `No new worker activity was observed.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before the next sessions_status poll.${blockingWaitSuffix} While workers are still running, sessions_yield is checkpoint-only. If the worker is off track, call sessions_cancel and respawn it.`;
}

type StartedSubAgent = Awaited<ReturnType<typeof startSubAgent>>;
type StartedSubAgentResult = Awaited<StartedSubAgent['resultPromise']>;
type SessionSnapshot = NonNullable<ReturnType<typeof getSubAgent>>;

type ConversationAgentRunLike = {
  id?: string;
  activeAgentRunId?: string | null;
  agentRuns?: Array<{
    id: string;
    status?: string;
    plan?: AgentRunPlan;
  }>;
  messages?: Message[];
};

const TERMINAL_SESSION_OUTPUT_GUIDANCE =
  'Use sessions_output when you need to fetch or recall the full final worker output from a terminal session without waiting again. If that deliverable should become the visible user answer directly, use sessions_surface_output. If you already received this deliverable from sessions_wait, do not call sessions_output again unless you need to recall it later. Use sessions_history only when you need the transcript and reasoning trace. After you have the terminal deliverable you need, continue from it or finalize instead of polling sessions_status or sessions_list for the same completed session.';
const TERMINAL_SESSION_WAIT_RESULT_GUIDANCE =
  'This result already includes the same full output that sessions_output would return. Continue from it or finalize now. Call sessions_output later only if you need to recall this terminal deliverable again without waiting. If that deliverable should become the visible user answer directly, use sessions_surface_output. Use sessions_history only when you need transcript and reasoning trace. After you have the deliverable you need, continue from it or finalize instead of re-polling the same completed session.';
const COMPLETED_SESSIONS_WAIT_GUIDANCE =
  'Completed session entries in this sessions_wait result already include the same full outputs that sessions_output would return. Continue from those outputs or finalize now. Call sessions_output later only if you need to recall a terminal deliverable again without waiting. If a deliverable should become the visible user answer directly, use sessions_surface_output. Use sessions_history only when you need transcript and reasoning trace. After you have the deliverable you need, continue from it or finalize instead of re-polling the same completed session.';
const DEFAULT_WAIT_FOR_COMPLETION_TIMEOUT_MS = 15_000;
const DEFAULT_SESSIONS_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS = 600;
const RUNNING_SESSION_OUTPUT_PREVIEW_CHARS = 320;

function normalizeWaitTimeoutMs(value?: number): number | undefined {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return undefined;
  }

  return Math.max(1000, Math.floor(Number(value)));
}

function resolveBlockingWaitTimeoutMs(
  value?: number,
  defaultWaitTimeoutMs: number = DEFAULT_WAIT_FOR_COMPLETION_TIMEOUT_MS,
): { waitTimeoutMs: number; usedDefault: boolean } {
  const normalized = normalizeWaitTimeoutMs(value);
  if (normalized != null) {
    return {
      waitTimeoutMs: normalized,
      usedDefault: false,
    };
  }

  return {
    waitTimeoutMs: defaultWaitTimeoutMs,
    usedDefault: true,
  };
}

async function waitForStartedSubAgentResult(
  started: StartedSubAgent,
  waitTimeoutMs?: number,
): Promise<StartedSubAgentResult | null> {
  return waitForSubAgentResultPromise(started.resultPromise, waitTimeoutMs);
}

function collectRequestedSessionIds(
  args: { sessionId?: unknown; sessionIds?: unknown },
  conversationId: string,
): { sessionIds: string[]; waitsForConversationSessions: boolean; error?: string } {
  const explicitIds = new Set<string>();

  if (typeof args.sessionId === 'string' && args.sessionId.trim()) {
    explicitIds.add(args.sessionId.trim());
  }

  if (Array.isArray(args.sessionIds)) {
    for (const value of args.sessionIds) {
      if (typeof value === 'string' && value.trim()) {
        explicitIds.add(value.trim());
      }
    }

    if (args.sessionIds.length > 0 && explicitIds.size === 0) {
      return {
        sessionIds: [],
        waitsForConversationSessions: false,
        error: 'sessionIds must include at least one non-empty session id.',
      };
    }
  }

  if (explicitIds.size > 0) {
    return { sessionIds: [...explicitIds], waitsForConversationSessions: false };
  }

  return {
    sessionIds: getSubAgentsByParent(conversationId)
      .filter((agent) => agent.status === 'running')
      .map((agent) => agent.sessionId),
    waitsForConversationSessions: true,
  };
}

function serializeBlockingSessionOutput(output: string | undefined): Record<string, unknown> {
  const normalizedOutput = typeof output === 'string' ? output : '';
  if (!normalizedOutput) {
    return { hasOutput: false };
  }

  return {
    hasOutput: true,
    output: normalizedOutput,
    outputChars: normalizedOutput.length,
    ...(normalizedOutput.length > INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS
      ? {
          outputPreview: normalizedOutput.slice(0, INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS),
        }
      : {}),
  };
}

function serializeTerminalSessionResult(
  result: StartedSubAgentResult,
  options?: { includeGuidance?: boolean },
): Record<string, unknown> {
  const outputPayload = serializeBlockingSessionOutput(result.output);
  const includeGuidance = options?.includeGuidance !== false;

  return {
    sessionId: result.sessionId,
    status: result.status,
    ...outputPayload,
    ...(includeGuidance && outputPayload.hasOutput === true
      ? { guidance: TERMINAL_SESSION_WAIT_RESULT_GUIDANCE }
      : {}),
    toolsUsed: result.toolsUsed,
    iterations: result.iterations,
    error: result.error,
    depth: result.depth,
    artifactCount: result.artifacts?.length || 0,
    artifacts: serializeSessionArtifacts(result.artifacts),
  };
}

function serializeRunningSessionWaitEntry(agent: SessionSnapshot): Record<string, unknown> {
  const now = Date.now();
  const lastProgressAt = agent.lastProgressAt || agent.updatedAt || agent.startedAt;
  const idleMs = Math.max(0, now - lastProgressAt);
  const modelResponseWaitMs = getModelResponseWaitMs({
    now,
    modelResponsePendingSince: agent.modelResponsePendingSince,
  });

  return {
    sessionId: agent.sessionId,
    status: agent.status,
    ...(agent.workstreamId ? { workstreamId: agent.workstreamId } : {}),
    depth: agent.depth,
    elapsedMs: now - agent.startedAt,
    launchState: agent.launchState,
    idleMs,
    lastProgressAt,
    awaitingModelResponse: isAwaitingModelResponse(modelResponseWaitMs),
    modelResponsePendingSince: agent.modelResponsePendingSince,
    modelResponseWaitMs,
    liveness: getSessionLivenessLabel({ idleMs, modelResponseWaitMs }),
    currentActivity: agent.currentActivity,
    activeToolName: agent.activeToolName,
    outputPreview: agent.output?.slice(0, RUNNING_SESSION_OUTPUT_PREVIEW_CHARS),
    lastToolResultPreview: agent.lastToolResultPreview,
    artifactCount: agent.artifacts?.length || 0,
    artifacts: serializeSessionArtifacts(agent.artifacts),
    toolsUsed: agent.toolsUsed,
    iterations: agent.iterations,
  };
}

function resolveActiveConversationAgentRun(
  conversation: ConversationAgentRunLike | undefined,
  preferredRunId: string | undefined,
): { id: string; status?: string; plan?: AgentRunPlan } | undefined {
  const candidateIds = [preferredRunId?.trim(), conversation?.activeAgentRunId?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidateId of candidateIds) {
    const exactMatch = conversation?.agentRuns?.find((run) => run.id === candidateId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return conversation?.agentRuns?.find((run) => run.status === 'running');
}

function collectAgentRunWorkerSnapshots(
  conversation: ConversationAgentRunLike | undefined,
  runId: string | undefined,
  liveWorkers: SubAgentSnapshot[],
): SubAgentSnapshot[] {
  if (!conversation) {
    return liveWorkers;
  }

  if (!runId) {
    const conversationId = conversation.id?.trim();
    return conversationId
      ? liveWorkers.filter(
          (worker) => resolveOwningConversationId(worker.sessionId, liveWorkers) === conversationId,
        )
      : liveWorkers;
  }

  const transcriptSnapshots = collectSubAgentSnapshotsFromMessages(conversation.messages ?? []);
  const mergedSnapshots = new Map<string, SubAgentSnapshot>();

  for (const snapshot of transcriptSnapshots) {
    mergedSnapshots.set(snapshot.sessionId, snapshot);
  }

  for (const snapshot of liveWorkers) {
    const existingSnapshot = mergedSnapshots.get(snapshot.sessionId);
    mergedSnapshots.set(
      snapshot.sessionId,
      existingSnapshot ? resolveDisplayedSubAgentSnapshot(existingSnapshot, snapshot) : snapshot,
    );
  }

  const conversationForRun = {
    ...conversation,
    activeAgentRunId: conversation.activeAgentRunId || undefined,
  };

  return getSubAgentsForAgentRun(
    conversationForRun as any,
    runId,
    Array.from(mergedSnapshots.values()),
  );
}

function buildAvailableWorkstreamSummaries(
  workstreams: AgentRunWorkstream[],
): Array<Record<string, unknown>> {
  return workstreams.slice(0, 8).map((workstream) => ({
    id: workstream.id,
    title: workstream.title,
    ...(workstream.dependencies?.length ? { dependencies: workstream.dependencies } : {}),
  }));
}

function describeDependencyBlockingStatus(status: WorkflowExecutionStatus): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'not-started';
  }
}

export async function executeSessionSpawn(
  args: {
    prompt: string;
    workstreamId?: string;
    dependsOnWorkstreams?: string[] | string;
    model?: string;
    systemPrompt?: string;
    name?: string;
    tools?: string[];
    inheritMemory?: boolean;
    sandboxPolicy?: 'full' | 'safe-only' | 'inherit';
    announce?: boolean;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
  conversationId: string,
  provider: any,
  allProviders?: any[],
  inheritedModel?: string,
): Promise<string> {
  try {
    const normalizedPrompt = normalizeRequiredSessionText(args.prompt, 'prompt');
    if (!normalizedPrompt.value) {
      return JSON.stringify({ status: 'error', error: normalizedPrompt.error });
    }

    const prompt = normalizedPrompt.value;
    const workerModel = resolveSpawnWorkerModel(provider, args.model, inheritedModel);

    // Sanitize name: strip control chars, limit length
    const sanitizedName = args.name
      ? args.name
          .slice(0, 256)
          .replace(/[\x00-\x1f\x7f]/g, '_')
          .trim() || undefined
      : undefined;

    const currentSession = getSubAgent(conversationId);
    const currentSessionContext = getSessionContext(conversationId);
    const liveWorkers = listActiveSubAgents();
    const ownerConversationId =
      resolveOwningConversationId(
        currentSession?.parentConversationId ??
          currentSessionContext?.config.parentConversationId ??
          conversationId,
        liveWorkers,
      ) ?? conversationId;
    const activeConversation = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === ownerConversationId);
    const settings = useSettingsStore.getState();
    const agentRunId =
      activeConversation?.activeAgentRunId ||
      currentSession?.agentRunId ||
      currentSessionContext?.config.agentRunId;
    const activeRun = resolveActiveConversationAgentRun(activeConversation, agentRunId);
    const normalizedPlanWorkstreams = normalizeWorkflowWorkstreams(activeRun?.plan?.workstreams);
    const normalizedDependencyRefs = normalizeDependencyWorkstreamRefs(args.dependsOnWorkstreams);
    if (normalizedDependencyRefs.error) {
      return JSON.stringify({ status: 'error', error: normalizedDependencyRefs.error });
    }

    const explicitDependencyRefs = normalizedDependencyRefs.values;
    const inferredWorkstreamId = inferWorkflowWorkstreamId(normalizedPlanWorkstreams, {
      workstreamId: args.workstreamId,
      name: sanitizedName,
      prompt,
    });
    const requiresExplicitWorkstreamBinding =
      normalizedPlanWorkstreams.length > 1 &&
      !inferredWorkstreamId &&
      explicitDependencyRefs.length === 0;

    if (requiresExplicitWorkstreamBinding) {
      return JSON.stringify({
        status: 'blocked',
        reason: 'missing_workstream_binding',
        guidance:
          'This workflow run already has a structured multi-workstream plan. Spawn each worker with workstreamId so the runtime can enforce dependency order. Only omit workstreamId for truly ad hoc workers, and then provide dependsOnWorkstreams whenever that worker must wait on prior work.',
        availableWorkstreams: buildAvailableWorkstreamSummaries(normalizedPlanWorkstreams),
      });
    }

    const trackedWorkers = collectAgentRunWorkerSnapshots(
      activeConversation,
      activeRun?.id ?? agentRunId,
      liveWorkers,
    );
    const spawnGate = evaluateWorkflowSpawnGate({
      plan: activeRun?.plan
        ? { ...activeRun.plan, workstreams: normalizedPlanWorkstreams }
        : undefined,
      workers: trackedWorkers,
      workstreamId: inferredWorkstreamId,
      dependsOnWorkstreams: explicitDependencyRefs,
    });

    if (spawnGate.duplicateRunningSessionIds.length > 0) {
      return JSON.stringify({
        status: 'blocked',
        reason: 'workstream_already_running',
        workstreamId: spawnGate.workstreamId,
        runningSessionIds: spawnGate.duplicateRunningSessionIds,
        guidance:
          'This workstream already has a running worker. Wait for it with sessions_wait or inspect it with sessions_status instead of spawning a duplicate worker for the same step.',
      });
    }

    if (spawnGate.duplicateCompletedSessionIds.length > 0) {
      return JSON.stringify({
        status: 'blocked',
        reason: 'workstream_already_completed',
        workstreamId: spawnGate.workstreamId,
        completedSessionIds: spawnGate.duplicateCompletedSessionIds,
        guidance:
          'This workstream already has a completed worker. Read its deliverable with sessions_output, or refine the completed step with sessions_send instead of spawning the same plan-linked worker again.',
      });
    }

    if (spawnGate.status === 'blocked') {
      return JSON.stringify({
        status: 'blocked',
        reason: 'blocked_dependencies',
        ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
        unmetDependencyIds: spawnGate.unmetDependencyIds,
        blockingDependencies: spawnGate.blockingDependencies.map((dependency) => ({
          workstreamId: dependency.workstreamId,
          ...(dependency.title ? { title: dependency.title } : {}),
          status: describeDependencyBlockingStatus(dependency.status),
          ...(dependency.sessionIds.length > 0 ? { sessionIds: dependency.sessionIds } : {}),
        })),
        guidance:
          'This worker depends on prerequisite workstreams that are not complete yet. Wait for the blocking work with sessions_wait or inspect it with sessions_status, then read the prerequisite output before spawning the dependent worker.',
      });
    }

    const parentSessionId =
      currentSession?.sessionId || (currentSessionContext ? conversationId : undefined);
    const initialMessages = buildDelegatedInitialMessages(
      prompt,
      findLatestUserMessageWithAttachments(currentSessionContext?.messages) ??
        findLatestUserMessageWithAttachments(activeConversation?.messages),
    );

    const config = {
      parentConversationId: ownerConversationId,
      ...(parentSessionId ? { parentSessionId } : {}),
      prompt,
      ...(initialMessages ? { initialMessages } : {}),
      workspaceConversationId: ownerConversationId,
      model: workerModel,
      ...((activeRun?.id ?? agentRunId) ? { agentRunId: activeRun?.id ?? agentRunId } : {}),
      ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
      systemPrompt: args.systemPrompt,
      name: sanitizedName,
      tools: args.tools,
      inheritMemory: args.inheritMemory !== false,
      linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
      mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
      sandboxPolicy: args.sandboxPolicy,
      announce: args.announce,
    };

    if (args.waitForCompletion) {
      const started = await startSubAgent(config, provider, allProviders);
      const waitWindow = resolveBlockingWaitTimeoutMs(args.waitTimeoutMs);
      const waitTimeoutMs = waitWindow.waitTimeoutMs;
      const raceResult = await waitForStartedSubAgentResult(started, waitTimeoutMs);

      if (raceResult === null) {
        observeBackgroundSubAgentResult(started, { announce: config.announce !== false });
        return JSON.stringify({
          status: 'running',
          sessionId: started.sessionId,
          depth: started.depth,
          name: sanitizedName,
          ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
          model: config.model || provider.model,
          waitTimedOut: true,
          waitTimeoutMs,
          ...(waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
          guidance:
            'The wait window ended, but the worker is still running in the background. If you need its output before continuing, call sessions_wait for this sessionId. Otherwise inspect sessions_status when you need live progress or cancel and respawn it if it drifts.',
        });
      }

      return JSON.stringify({
        ...serializeTerminalSessionResult(raceResult),
        ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
      });
    }

    const launched = await launchSubAgent(config, provider, allProviders);
    return JSON.stringify({
      status: launched.status,
      sessionId: launched.sessionId,
      depth: launched.depth,
      name: sanitizedName,
      ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
      model: config.model || provider.model,
      guidance:
        'The worker is now running in the background and will continue until completion. Use sessions_wait when you need the final worker output before proceeding; completed wait results already include the same output that sessions_output would return. Use sessions_output later only if you need to recall a terminal deliverable without waiting again. Use sessions_status when you need live currentActivity, activeToolName, recent verified findings, idleMs, or liveness while the worker is still running. If the worker drifts, call sessions_cancel and respawn it with corrected instructions. Do not assume sessions_yield auto-resumes the turn.',
    });
  } catch (err: unknown) {
    let message: string;
    if (err instanceof Error && err.message.includes('MAX_SPAWN_DEPTH')) {
      message =
        'Max sub-agent nesting depth exceeded. Consider breaking the task into parallel agents instead.';
    } else if (err instanceof TypeError) {
      message = `Configuration error: ${err.message}. Check that a provider is properly configured.`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }
    return JSON.stringify({ status: 'error', error: message });
  }
}

export async function executeSessionList(): Promise<string> {
  const agents = listActiveSubAgents();
  if (agents.length === 0) {
    return JSON.stringify({
      sessions: [],
      count: 0,
      guidance:
        'No active sessions are available. Reuse any known session ids instead of calling sessions_list again unless the active session set may have changed.',
    });
  }

  return JSON.stringify({
    sessions: agents.map((a) => ({
      sessionId: a.sessionId,
      ...(a.workstreamId ? { workstreamId: a.workstreamId } : {}),
      name: a.name,
      parentConversationId: a.parentConversationId,
      status: a.status,
      depth: a.depth,
      startedAt: a.startedAt,
      launchState: a.launchState,
      output: a.output?.slice(0, 500),
      currentActivity: a.currentActivity,
      activeToolName: a.activeToolName,
      lastToolResultPreview: a.lastToolResultPreview,
      artifactCount: a.artifacts?.length || 0,
      hasDeadline: typeof a.deadlineAt === 'number',
      deadlineAt: a.deadlineAt,
      canCancel: a.status === 'running',
    })),
    count: agents.length,
    guidance:
      'Reuse the returned session ids. Switch to sessions_wait, sessions_status, or sessions_output for a known session instead of calling sessions_list again unless the active session set may have changed.',
  });
}

export async function executeSessionSend(
  args: {
    sessionId: string;
    message: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
  provider: LlmProviderConfig,
  inheritedModel?: string,
): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      status: 'running',
      sessionId: args.sessionId,
      currentActivity: agent.currentActivity,
      activeToolName: agent.activeToolName,
      message:
        'Session is still processing. Use sessions_status to inspect currentActivity, or call sessions_cancel and respawn the worker with corrected instructions before sending follow-up work.',
    });
  }

  const normalizedMessage = normalizeRequiredSessionText(args.message, 'message');
  if (!normalizedMessage.value) {
    return JSON.stringify({ status: 'error', error: normalizedMessage.error });
  }

  const message = normalizedMessage.value;

  // Session has completed/errored/timed out — re-spawn with context.
  // Retrieve stored session context to preserve system prompt, tools, and
  // sandbox policy from the original spawn.
  const previousContext = getSessionContext(args.sessionId);
  const ownerConversationId = (() => {
    const resolvedFromSession = resolveOwningConversationId(args.sessionId, listActiveSubAgents());
    if (resolvedFromSession && resolvedFromSession !== args.sessionId) {
      return resolvedFromSession;
    }

    return (
      resolveOwningConversationId(
        previousContext?.config.parentConversationId ?? agent.parentConversationId,
        listActiveSubAgents(),
      ) ??
      previousContext?.config.parentConversationId ??
      agent.parentConversationId
    );
  })();
  const activeConversation = ownerConversationId
    ? useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === ownerConversationId)
    : undefined;
  const settings = useSettingsStore.getState();
  const previousOutput = previousContext?.conversationSummary || agent.output?.slice(0, 4000) || '';
  const followUpMessages: Message[] | undefined = previousContext?.messages?.length
    ? [
        ...previousContext.messages.map((message) => ({
          ...message,
          ...(message.toolCalls
            ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
            : {}),
        })),
        {
          id: generateId(),
          role: 'user',
          content: message,
          timestamp: Date.now(),
        },
      ]
    : undefined;
  const followUpPrompt = followUpMessages
    ? message
    : previousContext
      ? `## Previous session summary\n\nYour previous work produced the following summary:\n${previousOutput}\n\n## Follow-up instruction\n\n${message}`
      : `Previous conversation output:\n${previousOutput}\n\nFollow-up message: ${message}`;

  try {
    const storedProvider = previousContext?.provider;
    const followUpProvider = storedProvider
      ? await hydrateProviderForRequest(storedProvider)
      : provider;
    assertProviderReadyForRequest(
      followUpProvider,
      storedProvider
        ? `Worker provider "${storedProvider.name || storedProvider.id}"`
        : `Worker provider "${provider.name || provider.id}"`,
    );
    const followUpAllProviders = mergeWorkerProviderIntoCatalog(
      previousContext?.allProviders,
      followUpProvider,
    );
    const followUpModel = resolveFollowUpWorkerModel(
      followUpProvider,
      previousContext?.config.model,
      inheritedModel,
    );
    const followUpConfig = {
      parentConversationId: ownerConversationId,
      parentSessionId: args.sessionId,
      prompt: followUpPrompt,
      ...(followUpMessages ? { initialMessages: followUpMessages } : {}),
      workspaceConversationId: ownerConversationId,
      model: followUpModel,
      systemPrompt: previousContext?.config.systemPrompt,
      agentRunId:
        previousContext?.config.agentRunId ??
        agent.agentRunId ??
        activeConversation?.activeAgentRunId,
      workstreamId: previousContext?.config.workstreamId ?? agent.workstreamId,
      name: previousContext?.config.name || agent.name,
      tools: previousContext?.config.tools,
      sandboxPolicy: previousContext?.config.sandboxPolicy || agent.sandboxPolicy,
      inheritMemory: previousContext?.config.inheritMemory ?? true,
      linkUnderstandingEnabled:
        previousContext?.config.linkUnderstandingEnabled ?? settings.linkUnderstandingEnabled,
      mediaUnderstandingEnabled:
        previousContext?.config.mediaUnderstandingEnabled ?? settings.mediaUnderstandingEnabled,
    };

    if (args.waitForCompletion) {
      const started = await startSubAgent(followUpConfig, followUpProvider, followUpAllProviders);
      const waitWindow = resolveBlockingWaitTimeoutMs(args.waitTimeoutMs);
      const waitTimeoutMs = waitWindow.waitTimeoutMs;
      const raceResult = await waitForStartedSubAgentResult(started, waitTimeoutMs);

      if (raceResult === null) {
        observeBackgroundSubAgentResult(started);
        return JSON.stringify({
          status: 'running',
          sessionId: started.sessionId,
          previousSessionId: args.sessionId,
          depth: started.depth,
          name: followUpConfig.name,
          ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
          model: followUpModel,
          waitTimedOut: true,
          waitTimeoutMs,
          ...(waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
          guidance:
            'The wait window ended, but the worker is still running in the background. If you need its output before continuing, call sessions_wait for this sessionId. Otherwise inspect sessions_status when you need live progress or cancel and respawn it if it drifts.',
        });
      }

      return JSON.stringify({
        ...serializeTerminalSessionResult(raceResult),
        previousSessionId: args.sessionId,
        ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
      });
    }

    const launched = await launchSubAgent(followUpConfig, followUpProvider, followUpAllProviders);
    return JSON.stringify({
      status: launched.status,
      sessionId: launched.sessionId,
      previousSessionId: args.sessionId,
      depth: launched.depth,
      name: followUpConfig.name,
      ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
      model: followUpModel,
      guidance:
        'The follow-up worker is now running in the background and will continue until completion. Use sessions_wait when you need the final worker output before proceeding; completed wait results already include the same output that sessions_output would return. Use sessions_output later only if you need to recall a terminal deliverable without waiting again. Use sessions_status when you need live currentActivity, activeToolName, recent verified findings, idleMs, or liveness while the worker is still running. If the worker drifts, call sessions_cancel and respawn it with corrected instructions.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

// ── Session history tool ─────────────────────────────────────────────────

type SessionHistoryMessage = {
  role: Message['role'] | 'system';
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolCalls?: Array<Pick<ToolCall, 'id' | 'name' | 'status'>>;
  attachments?: Attachment[];
};

function buildSessionHistoryMessage(message: Message): SessionHistoryMessage {
  return {
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments?.length
      ? { attachments: stripAttachmentPayloads(message.attachments) }
      : {}),
    ...(message.toolCalls?.length
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            status: toolCall.status,
          })),
        }
      : {}),
  };
}

function serializeSessionHistory(
  history: {
    sessionId: string;
    status: string;
    startedAt: number;
    currentActivity?: string;
    historySource: 'persisted-transcript' | 'activity-log';
    conversationSummary?: string;
    activityLog: Array<{ timestamp: number; kind: string; text: string }>;
    messages: SessionHistoryMessage[];
  },
  maxSize: number,
): string {
  const bounded = {
    ...history,
    activityLog: [...history.activityLog],
    messages: [...history.messages],
  };

  let serialized = JSON.stringify(bounded);
  while (serialized.length > maxSize && bounded.messages.length > 1) {
    bounded.messages.shift();
    serialized = JSON.stringify(bounded);
  }

  while (serialized.length > maxSize && bounded.activityLog.length > 0) {
    bounded.activityLog.shift();
    serialized = JSON.stringify(bounded);
  }

  if (serialized.length > maxSize && bounded.conversationSummary) {
    bounded.conversationSummary = `${bounded.conversationSummary.slice(0, 317).trimEnd()}...`;
    serialized = JSON.stringify(bounded);
  }

  if (serialized.length > maxSize && bounded.messages.length > 0) {
    const lastMessage = bounded.messages[bounded.messages.length - 1];
    bounded.messages = [
      {
        ...lastMessage,
        content: `${lastMessage.content.slice(0, 1021).trimEnd()}...`,
      },
    ];
    serialized = JSON.stringify(bounded);
  }

  return serialized;
}

export async function executeSessionHistory(args: {
  sessionId: string;
  maxMessages?: number;
}): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  const MAX_SIZE = 80 * 1024; // 80KB cap per Kavi pattern
  const maxPerMessage = 4000;
  const maxMessages = Math.max(1, Math.floor(args.maxMessages || 8));
  const output = (agent.output || '').slice(0, maxPerMessage);
  const sessionContext = getSessionContext(args.sessionId);
  const activityEntries = agent.activityLog?.slice(-maxMessages) || [];
  const transcriptMessages =
    sessionContext?.messages
      ?.slice(-maxMessages)
      .map((message) => buildSessionHistoryMessage(message)) || [];
  const fallbackMessages: SessionHistoryMessage[] = [
    ...activityEntries.map<SessionHistoryMessage>((entry) => ({
      role: entry.kind === 'message' ? 'assistant' : 'system',
      content: entry.text,
      timestamp: entry.timestamp,
    })),
    ...(output ? [{ role: 'assistant' as const, content: output }] : []),
  ];

  const history = {
    sessionId: args.sessionId,
    status: agent.status,
    startedAt: agent.startedAt,
    currentActivity: agent.currentActivity,
    historySource:
      transcriptMessages.length > 0 ? ('persisted-transcript' as const) : ('activity-log' as const),
    conversationSummary: sessionContext?.conversationSummary || output || undefined,
    activityLog: activityEntries,
    messages: transcriptMessages.length > 0 ? transcriptMessages : fallbackMessages,
  };

  return serializeSessionHistory(history, MAX_SIZE);
}

export async function executeSessionOutput(args: { sessionId: string }): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      sessionId: args.sessionId,
      status: agent.status,
      hasOutput: false,
      guidance:
        'Final output is not available yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or use sessions_status for live inspection while it is running.',
    });
  }

  const output = agent.output || '';
  return JSON.stringify({
    sessionId: args.sessionId,
    status: agent.status,
    hasOutput: output.length > 0,
    output,
    guidance: TERMINAL_SESSION_OUTPUT_GUIDANCE,
  });
}

export async function executeSessionSurfaceOutput(
  args: {
    sessionId: string;
    prefix?: string;
    suffix?: string;
    startMarker?: string;
    endMarker?: string;
    includeStartMarker?: boolean;
    includeEndMarker?: boolean;
    maxChars?: number;
    fallbackToFullOutput?: boolean;
    trim?: boolean;
  },
): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      sessionId: args.sessionId,
      status: agent.status,
      hasOutput: false,
      guidance:
        'Worker output cannot be surfaced yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or use sessions_status for live inspection while it is running.',
    });
  }

  const surfacedResult = createSurfacedSubAgentOutputPayload({
    sessionId: args.sessionId,
    sourceOutput: agent.output || '',
    options: {
      prefix: args.prefix,
      suffix: args.suffix,
      startMarker: args.startMarker,
      endMarker: args.endMarker,
      includeStartMarker: args.includeStartMarker,
      includeEndMarker: args.includeEndMarker,
      maxChars: args.maxChars,
      fallbackToFullOutput: args.fallbackToFullOutput,
      trim: args.trim,
    },
  });

  if (surfacedResult.error || !surfacedResult.payload) {
    return JSON.stringify({
      status: 'error',
      sessionId: args.sessionId,
      error: surfacedResult.error || 'Unable to surface worker output.',
    });
  }

  return JSON.stringify(surfacedResult.payload);
}

// ── Session status tool ──────────────────────────────────────────────────

export async function executeSessionStatus(args: { sessionId: string }): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  pruneStaleCommandPolls(sessionStatusPollState);

  const now = Date.now();
  const lastProgressAt = agent.lastProgressAt || agent.updatedAt || agent.startedAt;
  const idleMs = Math.max(0, now - lastProgressAt);
  const modelResponseWaitMs = getModelResponseWaitMs({
    now,
    modelResponsePendingSince: agent.modelResponsePendingSince,
  });
  const awaitingModelResponse = isAwaitingModelResponse(modelResponseWaitMs);
  const liveness =
    agent.status === 'running'
      ? getSessionLivenessLabel({ idleMs, modelResponseWaitMs })
      : undefined;

  const fingerprint = buildSessionStatusFingerprint(agent);
  const previousFingerprint = sessionStatusFingerprints.get(args.sessionId);
  const hasNewActivity =
    previousFingerprint == null
      ? Boolean(agent.output || agent.currentActivity || agent.lastToolResultPreview)
      : previousFingerprint !== fingerprint;

  let recommendedWaitMs: number | undefined;
  if (agent.status === 'running') {
    recommendedWaitMs = recordCommandPoll(sessionStatusPollState, args.sessionId, hasNewActivity);
    if (liveness === 'stalled') {
      recommendedWaitMs = Math.max(recommendedWaitMs, 5000);
    }
    sessionStatusFingerprints.set(args.sessionId, fingerprint);
  } else {
    resetCommandPollCount(sessionStatusPollState, args.sessionId);
    sessionStatusFingerprints.delete(args.sessionId);
  }

  const deadlineAt = typeof agent.deadlineAt === 'number' ? agent.deadlineAt : undefined;
  const remainingDeadlineMs = deadlineAt != null ? Math.max(0, deadlineAt - now) : undefined;

  return JSON.stringify({
    sessionId: args.sessionId,
    status: agent.status,
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    deadlineAt,
    depth: agent.depth,
    sandboxPolicy: agent.sandboxPolicy,
    elapsedMs: now - agent.startedAt,
    idleMs,
    launchState: agent.launchState,
    lastProgressAt,
    awaitingModelResponse,
    modelResponsePendingSince: agent.modelResponsePendingSince,
    modelResponseWaitMs,
    liveness,
    hasDeadline: deadlineAt != null,
    remainingDeadlineMs,
    hasOutput: !!agent.output,
    outputPreview: agent.output?.slice(0, RUNNING_SESSION_OUTPUT_PREVIEW_CHARS),
    hasNewActivity,
    currentActivity: agent.currentActivity,
    activeToolName: agent.activeToolName,
    activeToolElapsedMs: agent.activeToolStartedAt
      ? Math.max(0, now - agent.activeToolStartedAt)
      : undefined,
    lastToolResultPreview: agent.lastToolResultPreview,
    recentActivity: agent.activityLog?.slice(-5) || [],
    canCancel: agent.status === 'running',
    artifactCount: agent.artifacts?.length || 0,
    artifacts: serializeSessionArtifacts(agent.artifacts),
    recommendedWaitMs,
    guidance:
      agent.status === 'running'
        ? buildSessionPollingGuidance({
            status: agent.status,
            recommendedWaitMs,
            hasNewActivity,
            launchState: agent.launchState,
            currentActivity: agent.currentActivity,
            idleMs,
            liveness,
            awaitingModelResponse,
            modelResponseWaitMs,
          })
        : TERMINAL_SESSION_OUTPUT_GUIDANCE,
    toolsUsed: agent.toolsUsed,
    iterations: agent.iterations,
  });
}

export async function executeSessionWait(
  args: {
    sessionId?: string;
    sessionIds?: string[];
    waitTimeoutMs?: number;
  },
  conversationId: string,
): Promise<string> {
  pruneStaleCommandPolls(sessionStatusPollState);

  const selection = collectRequestedSessionIds(args, conversationId);
  if (selection.error) {
    return JSON.stringify({ status: 'error', error: selection.error });
  }

  if (selection.sessionIds.length === 0) {
    return JSON.stringify({
      status: 'completed',
      sessionIds: [],
      sessionCount: 0,
      completedCount: 0,
      pendingCount: 0,
      waitedForConversationSessions: selection.waitsForConversationSessions,
      sessions: [],
      guidance: selection.waitsForConversationSessions
        ? 'No running sub-agent sessions remain for this conversation.'
        : 'No target sub-agent sessions were provided.',
    });
  }

  const missingSessionIds = selection.sessionIds.filter((sessionId) => !getSubAgent(sessionId));
  if (missingSessionIds.length > 0) {
    return JSON.stringify({
      status: 'error',
      error:
        missingSessionIds.length === 1
          ? `session not found: ${missingSessionIds[0]}`
          : `sessions not found: ${missingSessionIds.join(', ')}`,
      missingSessionIds,
    });
  }

  const waitWindow = resolveBlockingWaitTimeoutMs(
    args.waitTimeoutMs,
    DEFAULT_SESSIONS_WAIT_TIMEOUT_MS,
  );
  const waitTimeoutMs = waitWindow.waitTimeoutMs;
  const waitedResults = await Promise.all(
    selection.sessionIds.map((sessionId) => waitForSubAgentCompletion(sessionId, waitTimeoutMs)),
  );

  const sessions: Record<string, unknown>[] = [];
  const pendingSessions: Record<string, unknown>[] = [];
  let completedCount = 0;

  for (let index = 0; index < selection.sessionIds.length; index += 1) {
    const sessionId = selection.sessionIds[index];
    const waitResult = waitedResults[index];

    if (waitResult) {
      resetCommandPollCount(sessionStatusPollState, sessionId);
      sessionStatusFingerprints.delete(sessionId);
      sessions.push(serializeTerminalSessionResult(waitResult, { includeGuidance: false }));
      completedCount += 1;
      continue;
    }

    const latestAgent = getSubAgent(sessionId);
    if (latestAgent && latestAgent.status !== 'running') {
      const terminalResult = await waitForSubAgentCompletion(sessionId, 1);
      if (terminalResult) {
        resetCommandPollCount(sessionStatusPollState, sessionId);
        sessionStatusFingerprints.delete(sessionId);
        sessions.push(serializeTerminalSessionResult(terminalResult, { includeGuidance: false }));
        completedCount += 1;
        continue;
      }
    }

    if (latestAgent) {
      const runningSnapshot = serializeRunningSessionWaitEntry(latestAgent);
      sessions.push(runningSnapshot);
      pendingSessions.push(runningSnapshot);
      continue;
    }

    pendingSessions.push({
      sessionId,
      status: 'error',
      error: 'Session disappeared while waiting.',
    });
  }

  const pendingCount = pendingSessions.length;
  const completedAll = pendingCount === 0;

  return JSON.stringify({
    status: completedAll ? 'completed' : 'running',
    sessionIds: selection.sessionIds,
    sessionCount: selection.sessionIds.length,
    completedCount,
    pendingCount,
    waitedForConversationSessions: selection.waitsForConversationSessions,
    ...(!completedAll ? { waitTimeoutMs } : {}),
    ...(!completedAll ? { waitTimedOut: true } : {}),
    ...(!completedAll && waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
    sessions,
    ...(pendingSessions.length > 0 ? { pendingSessions } : {}),
    guidance: completedAll
      ? `All requested sub-agent sessions reached terminal states. ${COMPLETED_SESSIONS_WAIT_GUIDANCE}`
      : completedCount > 0
        ? 'The wait window ended while some requested sub-agent sessions are still running. Completed session entries already include the same full outputs that sessions_output would return, so continue from those outputs if they are sufficient. Call sessions_wait again to keep blocking, or inspect sessions_status if you need to diagnose drift before cancelling.'
        : 'The wait window ended while some requested sub-agent sessions are still running. Call sessions_wait again to keep blocking, or inspect sessions_status if you need to diagnose drift before cancelling.',
  });
}

export async function executeSessionCancel(args: {
  sessionId: string;
  reason?: string;
}): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) {
    return `Error: session not found: ${args.sessionId}`;
  }

  if (agent.status !== 'running') {
    return JSON.stringify({
      status: agent.status,
      sessionId: args.sessionId,
      message: 'Session is already in a terminal state.',
      outputPreview: agent.output?.slice(0, 1000),
    });
  }

  const cancelled = cancelSubAgent(args.sessionId, args.reason);
  return JSON.stringify({
    status: 'cancel_requested',
    sessionId: args.sessionId,
    currentActivity: cancelled?.currentActivity,
    message:
      'Cancellation requested. Poll sessions_status until the worker reports cancelled, then respawn with corrected instructions if needed.',
    canRespawn: true,
  });
}

export async function executeSessionYield(
  args: {
    message?: string;
  },
  conversationId: string,
): Promise<string> {
  const message =
    typeof args.message === 'string' && args.message.trim()
      ? args.message.trim()
      : 'Supervisor checkpoint recorded.';

  const runningAgents = getSubAgentsByParent(conversationId).filter(
    (agent) => agent.status === 'running',
  );
  if (runningAgents.length === 0) {
    return JSON.stringify({
      status: 'completed',
      message,
      finalizeSupervisor: true,
      pendingSessions: [],
      guidance:
        'No running sub-agent sessions remain for this conversation. Finalize the supervisor response instead of waiting again.',
    });
  }

  return JSON.stringify({
    status: 'checkpointed',
    message,
    autoResumeSupported: false,
    finalizeSupervisor: false,
    guidance:
      'sessions_yield records a checkpoint while sub-agents are still running. Continue monitoring with wait plus sessions_status until workers reach a terminal state, or cancel misdirected workers with sessions_cancel.',
    pendingSessions: runningAgents.map((agent) => ({
      sessionId: agent.sessionId,
      status: agent.status,
      startedAt: agent.startedAt,
      currentActivity: agent.currentActivity,
      activeToolName: agent.activeToolName,
    })),
  });
}


