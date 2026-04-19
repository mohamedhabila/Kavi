// ---------------------------------------------------------------------------
// Kavi — Parity Tool Executor
// ---------------------------------------------------------------------------
// Executes new parity tools: canvas, sessions, pdf, camera, audio, memory_search.

import { generateId } from '../../utils/id';
import {
  processCanvasMessage,
  getSurface,
  getAllSurfaces,
  getFocusedCanvasSurfaceId,
  requestCanvasEval,
  requestCanvasRead,
  requestCanvasSnapshot,
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
  EmbeddingConfig,
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
import { hybridSearch } from '../../services/memory/embeddings';
import {
  recordCommandPoll,
  resetCommandPollCount,
  pruneStaleCommandPolls,
  type CommandPollState,
} from '../../services/agents/commandPollBackoff';
import {
  startRecording,
  stopRecording,
  transcribeAudio,
  speakText,
  type TTSProvider,
} from '../../services/voice/voice';
import { searchMemory } from '../../services/memory/store';
import { BUILT_IN_PERSONAS, type AgentPersona } from '../../services/agents/personas';
import { getAvailablePersonas, getPersona, isBuiltInPersona } from '../../services/agents/registry';
import { usePersonaConfigStore } from '../../services/agents/store';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { mcpManager } from '../../services/mcp/manager';
import {
  PYTHON_EXTENSION_EXAMPLES,
  PYTHON_EXTENSION_POLICY,
  PYTHON_EXTENSION_WHEN_NEEDED,
} from '../../services/python/guidance';
import {
  getSkillToolDefinitions,
  isSkillCompatible,
  useSkillsStore,
} from '../../services/skills/manager';
import type { SkillEntry } from '../../services/skills/types';
import { TOOL_DEFINITIONS } from './definitions';
import * as ImagePicker from 'expo-image-picker';
import { requireToolStringArg, sanitizeWorkspaceRelativePath } from './fileArgumentUtils';
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

function normalizeCanvasTextContent(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const fencedMatch = trimmed.match(/^```(?:html|htm|xml|svg)?\s*\n([\s\S]*?)\n```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function looksLikeHtml(value: string): boolean {
  return /<!doctype html|<html\b|<body\b|<div\b|<section\b|<main\b|<style\b|<script\b/i.test(value);
}

function looksLikeCanvasHtmlContent(value: string): boolean {
  return /<!doctype html|<html\b|<head\b|<body\b|<[a-z][\w:-]*\b[^>]*>/i.test(value);
}

function pickFirstCanvasString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const normalized = normalizeCanvasTextContent(args[key]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function pickFirstCanvasFilePath(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = sanitizeWorkspaceRelativePath(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeCanvasDirectoryPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/\/+$/, '');
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

function summarizeAvailableSurfaces(): string | undefined {
  const surfaces = getAllSurfaces();
  if (!surfaces.length) {
    return undefined;
  }

  return surfaces
    .slice(0, 5)
    .map((surface) => `${surface.id}${surface.title ? ` (${surface.title})` : ''}`)
    .join(', ');
}

function resolveCanvasSurfaceTarget(
  args: Record<string, unknown>,
  operation: string,
): { surfaceId?: string; note?: string; error?: string } {
  const candidate = pickFirstCanvasString(args, [
    'surfaceId',
    'canvasId',
    'id',
    'surface',
    'canvas',
  ]);
  const allSurfaces = getAllSurfaces();

  const tryResolve = (identifier?: string) => {
    if (!identifier) return undefined;
    const direct = getSurface(identifier);
    if (direct) return direct;
    const normalized = identifier.trim().toLowerCase();
    return allSurfaces.find(
      (surface) =>
        surface.id.toLowerCase() === normalized ||
        (surface.title || '').trim().toLowerCase() === normalized,
    );
  };

  const matchedSurface = tryResolve(candidate);
  if (matchedSurface) {
    return {
      surfaceId: matchedSurface.id,
      ...(candidate && candidate !== matchedSurface.id
        ? {
            note: `Resolved ${operation} target "${candidate}" to surfaceId "${matchedSurface.id}".`,
          }
        : {}),
    };
  }

  const focusedSurfaceId = getFocusedCanvasSurfaceId();
  if (focusedSurfaceId && getSurface(focusedSurfaceId)) {
    return {
      surfaceId: focusedSurfaceId,
      note: candidate
        ? `Using focused surface "${focusedSurfaceId}" for ${operation} because "${candidate}" was not found.`
        : `Using focused surface "${focusedSurfaceId}" for ${operation}.`,
    };
  }

  if (allSurfaces.length === 1) {
    return {
      surfaceId: allSurfaces[0].id,
      note: candidate
        ? `Using the only active surface "${allSurfaces[0].id}" for ${operation} because "${candidate}" was not found.`
        : `Using the only active surface "${allSurfaces[0].id}" for ${operation}.`,
    };
  }

  const available = summarizeAvailableSurfaces();
  if (candidate) {
    return {
      error: available
        ? `Error: unable to find canvas surface "${candidate}" for ${operation}. Available surfaces: ${available}. Call canvas_list if unsure.`
        : `Error: unable to find canvas surface "${candidate}" for ${operation}. No active surfaces exist. Create one with canvas_create first.`,
    };
  }

  return {
    error: available
      ? `Error: surfaceId is required for ${operation} when multiple canvas surfaces exist. Available surfaces: ${available}. Call canvas_list if unsure.`
      : `Error: surfaceId is required for ${operation}. No active surfaces exist. Create one with canvas_create first.`,
  };
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

function normalizeCanvasReadArgs(args: Record<string, unknown>) {
  const rawMode = pickFirstCanvasString(args, ['mode', 'readMode', 'output', 'contentMode']);
  const mode: CanvasReadMode = rawMode === 'dom' || rawMode === 'source' ? rawMode : 'auto';
  const rawMaxChars = args.maxChars ?? args.maxLength ?? args.limit;
  const maxChars =
    typeof rawMaxChars === 'number' && Number.isFinite(rawMaxChars)
      ? Math.max(1_000, Math.floor(rawMaxChars))
      : undefined;

  return {
    ...resolveCanvasSurfaceTarget(args, 'canvas_read'),
    mode,
    maxChars,
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

// ── Canvas navigate tool ─────────────────────────────────────────────────

export async function executeCanvasNavigate(args: {
  surfaceId: string;
  url: string;
}): Promise<string> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_navigate');
  if (resolved.error) return JSON.stringify({ status: 'error', error: resolved.error });

  let parsedUrl: URL;
  try {
    const urlArg = requireToolStringArg(args as Record<string, unknown>, 'url', 'canvas_navigate');
    if (urlArg.error) return urlArg.error;
    parsedUrl = new URL(urlArg.value!);
  } catch {
    return 'Error: canvas_navigate requires a valid remote http or https URL. Use canvas_create or canvas_update for session canvas content instead of local file paths.';
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return 'Error: canvas_navigate only supports remote http or https URLs. Use canvas_create or canvas_update for session canvas content instead of local files or generated HTML.';
  }

  processCanvasMessage({
    type: 'navigate',
    surfaceId: resolved.surfaceId!,
    url: parsedUrl.toString(),
  });
  return JSON.stringify({
    status: 'navigated',
    surfaceId: resolved.surfaceId!,
    url: parsedUrl.toString(),
    ...(resolved.note ? { note: resolved.note } : {}),
  });
}

// ── Canvas eval tool ─────────────────────────────────────────────────────

export async function executeCanvasEval(args: {
  surfaceId: string;
  script: string;
}): Promise<string> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_eval');
  if (resolved.error) return JSON.stringify({ status: 'error', error: resolved.error });

  const script = pickFirstCanvasString(args as Record<string, unknown>, [
    'script',
    'code',
    'expression',
    'javascript',
    'js',
  ]);
  if (!script) {
    return JSON.stringify({ status: 'error', error: 'canvas_eval requires a script string.' });
  }

  try {
    const result = await requestCanvasEval(resolved.surfaceId!, script);
    if (!resolved.note) {
      return result;
    }

    try {
      const parsed = JSON.parse(result);
      return JSON.stringify({ ...parsed, note: resolved.note });
    } catch {
      return result;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

export async function executeCanvasRead(args: {
  surfaceId?: string;
  mode?: CanvasReadMode;
  maxChars?: number;
}): Promise<string> {
  const normalized = normalizeCanvasReadArgs(args as Record<string, unknown>);
  if (normalized.error) {
    return JSON.stringify({ status: 'error', error: normalized.error });
  }

  try {
    const result = await requestCanvasRead(normalized.surfaceId!, {
      mode: normalized.mode,
      maxChars: normalized.maxChars,
    });

    if (!normalized.note) {
      return result;
    }

    try {
      const parsed = JSON.parse(result);
      return JSON.stringify({ ...parsed, note: normalized.note });
    } catch {
      return result;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

// ── Canvas snapshot tool ─────────────────────────────────────────────────

export async function executeCanvasSnapshot(args: {
  surfaceId: string;
  format?: string;
  quality?: number;
}): Promise<string> {
  const resolved = resolveCanvasSurfaceTarget(args as Record<string, unknown>, 'canvas_snapshot');
  if (resolved.error) return JSON.stringify({ status: 'error', error: resolved.error });
  const format = (args.format === 'jpeg' ? 'jpeg' : 'png') as 'png' | 'jpeg';
  const quality =
    typeof args.quality === 'number' && Number.isFinite(args.quality)
      ? Math.min(1, Math.max(0, args.quality))
      : undefined;
  const result = await requestCanvasSnapshot(resolved.surfaceId!, format, quality);
  if (!resolved.note) {
    return result;
  }

  try {
    const parsed = JSON.parse(result);
    return JSON.stringify({ ...parsed, note: resolved.note });
  } catch {
    return result;
  }
}

export async function executeCanvasList(args: { includeDestroyed?: boolean }): Promise<string> {
  const focusedSurfaceId = getFocusedCanvasSurfaceId();
  const surfaces = getAllSurfaces()
    .filter((surface) => args.includeDestroyed || surface.state !== 'destroyed')
    .map((surface) => ({
      surfaceId: surface.id,
      title: surface.title || surface.id,
      state: surface.state,
      renderMode: surface.renderMode || 'components',
      url: surface.url,
      sourceBundle: surface.sourceBundle,
      componentCount: surface.components.length,
      dataKeys: Object.keys(surface.dataModel || {}),
      isFocused: surface.id === focusedSurfaceId,
    }));

  return JSON.stringify({
    status: 'listed',
    count: surfaces.length,
    focusedSurfaceId,
    surfaces,
    guidance: surfaces.length
      ? 'Update an existing surface with canvas_update when possible before creating a new one. Use canvas_read to inspect stored content or live DOM before editing, prefer directoryPath for multi-file HTML/CSS/JS apps, prefer filePath for a single local HTML entry file, use contentEdits for focused raw HTML patches, use componentOperations/dataOperations for structured canvases, reuse the returned surfaceId from canvas_create or the focusedSurfaceId from canvas_list, and avoid unrelated workspace file tools unless the user explicitly asks for persisted exports.'
      : 'No existing surfaces found. Create a new session canvas with canvas_create and pass components directly instead of writing files first.',
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
  'Use sessions_output when you need the full final worker output only, sessions_surface_output when that terminal deliverable should become the visible user answer directly, or sessions_history when you need the transcript and reasoning trace. After you have the terminal deliverable you need, continue from it or finalize instead of polling sessions_status or sessions_list for the same completed session.';
const BLOCKING_SESSION_RESULT_GUIDANCE =
  'Use sessions_output when you need the full final worker output. If that deliverable should become the visible user answer directly, call sessions_surface_output instead of rewriting it. Blocking wait results may return previews for larger outputs, and sessions_history is for transcript and reasoning trace. After you have the deliverable you need, continue from it or finalize instead of re-polling the same completed session.';
const DEFAULT_WAIT_FOR_COMPLETION_TIMEOUT_MS = 15_000;
const DEFAULT_SESSIONS_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const INLINE_BLOCKING_SESSION_OUTPUT_CHARS = 1_200;
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

  if (normalizedOutput.length <= INLINE_BLOCKING_SESSION_OUTPUT_CHARS) {
    return {
      hasOutput: true,
      output: normalizedOutput,
      outputChars: normalizedOutput.length,
      outputTruncated: false,
    };
  }

  return {
    hasOutput: true,
    outputPreview: normalizedOutput.slice(0, INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS),
    outputChars: normalizedOutput.length,
    outputTruncated: true,
  };
}

function serializeTerminalSessionResult(result: StartedSubAgentResult): Record<string, unknown> {
  const outputPayload = serializeBlockingSessionOutput(result.output);

  return {
    sessionId: result.sessionId,
    status: result.status,
    ...outputPayload,
    ...(outputPayload.outputTruncated === true
      ? { guidance: BLOCKING_SESSION_RESULT_GUIDANCE }
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
        'The worker is now running in the background and will continue until completion. Use sessions_wait when you need the final worker output before proceeding. Use sessions_status when you need live currentActivity, activeToolName, recent verified findings, idleMs, or liveness while the worker is still running. If the worker drifts, call sessions_cancel and respawn it with corrected instructions. Do not assume sessions_yield auto-resumes the turn.',
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
        'The follow-up worker is now running in the background and will continue until completion. Use sessions_wait when you need the final worker output before proceeding. Use sessions_status when you need live currentActivity, activeToolName, recent verified findings, idleMs, or liveness while the worker is still running. If the worker drifts, call sessions_cancel and respawn it with corrected instructions.',
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
      sessions.push(serializeTerminalSessionResult(waitResult));
      completedCount += 1;
      continue;
    }

    const latestAgent = getSubAgent(sessionId);
    if (latestAgent && latestAgent.status !== 'running') {
      const terminalResult = await waitForSubAgentCompletion(sessionId, 1);
      if (terminalResult) {
        resetCommandPollCount(sessionStatusPollState, sessionId);
        sessionStatusFingerprints.delete(sessionId);
        sessions.push(serializeTerminalSessionResult(terminalResult));
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
      ? `All requested sub-agent sessions reached terminal states. Use their outputs to continue the workflow. ${BLOCKING_SESSION_RESULT_GUIDANCE}`
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

export async function executeWait(args: { ms?: number; reason?: string }): Promise<string> {
  const requestedMs = Number.isFinite(args.ms) ? Number(args.ms) : 1000;
  const ms = Math.max(100, Math.min(requestedMs, 60000));
  await sleepAsync(ms);
  return JSON.stringify({
    status: 'waited',
    waitedMs: ms,
    reason: args.reason,
  });
}

// ── PDF tool ─────────────────────────────────────────────────────────────

export async function executePdfRead(args: { path: string; pages?: string }): Promise<string> {
  // URL-based PDF
  if (args.path.startsWith('http://') || args.path.startsWith('https://')) {
    try {
      const url = new URL(args.path);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return JSON.stringify({ error: 'Only http/https URLs are supported' });
      }

      // First attempt: fetch with Accept: text/html to get an HTML rendition
      const htmlRes = await fetch(args.path, {
        headers: { Accept: 'text/html, application/xhtml+xml, */*' },
      });

      if (htmlRes.ok) {
        const contentType = htmlRes.headers.get('content-type') || '';

        // If server returned HTML (many PDFs have HTML previews), extract text
        if (contentType.includes('text/html') || contentType.includes('xhtml')) {
          const html = await htmlRes.text();
          // Strip HTML tags for basic text extraction
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length > 100) {
            return JSON.stringify({
              status: 'extracted',
              url: args.path,
              content: text.slice(0, 50000),
              charCount: Math.min(text.length, 50000),
              method: 'html_rendition',
            });
          }
        }

        // If it's actual PDF binary, we can't parse on mobile
        if (contentType.includes('application/pdf')) {
          const size = Number(htmlRes.headers.get('content-length') || 0);
          return JSON.stringify({
            status: 'fetched_but_not_parsed',
            url: args.path,
            contentType: 'application/pdf',
            sizeBytes: size || undefined,
            suggestion:
              'Mobile PDF text extraction is limited. Alternatives: ' +
              '(1) Use web_fetch on the same URL for a readable version. ' +
              '(2) Upload the PDF as an attachment for vision-capable models. ' +
              '(3) Look for an HTML version of this document.',
          });
        }

        // Non-HTML, non-PDF text response — return as-is
        const text = await htmlRes.text();
        return JSON.stringify({
          status: 'extracted',
          url: args.path,
          content: text.slice(0, 50000),
          charCount: Math.min(text.length, 50000),
          method: 'direct_text',
        });
      }
      return JSON.stringify({ error: `HTTP ${htmlRes.status} fetching PDF URL` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: message });
    }
  }

  // Local file path
  return JSON.stringify({
    status: 'unsupported',
    path: args.path,
    suggestion:
      'Local PDF text extraction requires a native PDF library. ' +
      'Attach the PDF to your message for vision-capable models, or provide a URL instead.',
  });
}

// ── Camera snap tool ─────────────────────────────────────────────────────

export async function executeCameraSnap(args: {
  camera?: string;
  quality?: number;
}): Promise<string> {
  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: args.quality ?? 0.7,
      base64: true,
      cameraType:
        args.camera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });

    if (result.canceled || !result.assets?.[0]) {
      return JSON.stringify({ status: 'cancelled' });
    }

    const asset = result.assets[0];
    return JSON.stringify({
      status: 'captured',
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      base64Length: asset.base64?.length || 0,
      mimeType: asset.mimeType || 'image/jpeg',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

// ── Audio transcription tool ─────────────────────────────────────────────

export async function executeAudioTranscribe(args: {
  durationMs?: number;
  language?: string;
}): Promise<string> {
  const duration = args.durationMs || 5000;

  try {
    await startRecording();
    await new Promise((resolve) => setTimeout(resolve, duration));
    const audioUri = await stopRecording();

    if (!audioUri) {
      return JSON.stringify({ status: 'error', error: 'No audio recorded' });
    }

    const result = await transcribeAudio(audioUri, { language: args.language });
    return JSON.stringify({
      status: 'transcribed',
      text: result.text,
      language: result.language,
      duration: result.duration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

// ── Memory search tool ───────────────────────────────────────────────────

export async function executeMemorySearch(
  args: { query: string; maxResults?: number; scope?: 'all' | 'conversation' | 'global' },
  embeddingConfig?: EmbeddingConfig,
  options?: { conversationId?: string },
): Promise<string> {
  const maxResults = args.maxResults || 10;
  const requestedScope = args.scope || 'all';

  const formatWithCitations = (
    results: Array<{ source: string; snippet: string; score: number; scope?: string }>,
    method: string,
  ) => {
    const cited = results.slice(0, maxResults).map((r, i) => ({
      ...r,
      scope: r.scope,
      citation: `[${i + 1}] ${r.source}`,
      relevance: Math.round(r.score * 100) + '%',
    }));
    return JSON.stringify({
      results: cited,
      method,
      totalFound: results.length,
      scope: requestedScope,
    });
  };

  if (!embeddingConfig) {
    const results = await searchMemory(args.query, {
      scope: requestedScope,
      conversationId: options?.conversationId,
    });
    return formatWithCitations(results, 'text');
  }

  try {
    const results = await hybridSearch(
      args.query,
      {
        embedding: embeddingConfig,
        maxResults,
      },
      {
        scope: requestedScope,
        conversationId: options?.conversationId,
      },
    );
    return JSON.stringify({
      results: results.map((r: any, i: number) => ({
        ...r,
        citation: `[${i + 1}] ${r.source || 'memory'}`,
        relevance: r.score != null ? Math.round(r.score * 100) + '%' : undefined,
      })),
      method: 'hybrid',
      totalFound: results.length,
      scope: requestedScope,
    });
  } catch {
    const results = await searchMemory(args.query, {
      scope: requestedScope,
      conversationId: options?.conversationId,
    });
    return formatWithCitations(results, 'text_fallback');
  }
}

function slugifyCatalogValue(value: string | undefined): string {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function getSkillCatalogLocation(entry: SkillEntry): string {
  const managedDir =
    entry.source.managedDir ||
    `${slugifyCatalogValue(entry.metadata.name)}-${slugifyCatalogValue(entry.source.id || entry.id)}`;
  return `skills/${managedDir}/SKILL.md`;
}

function filterCatalogEntriesByVisibility<T extends { name: string }>(
  entries: T[],
  availableToolNames?: ReadonlySet<string>,
): T[] {
  if (!availableToolNames) {
    return entries;
  }

  return entries.filter((entry) => availableToolNames.has(entry.name));
}

type ToolCatalogCategoryConfig = {
  tools: string[];
  purpose: string;
  guidance?: string;
};

type ToolCatalogSearchToolEntry = {
  name: string;
  description: string;
  category: string;
  source: 'built-in' | 'mcp' | 'skill';
  purpose?: string;
  guidance?: string;
  serverName?: string;
  skillName?: string;
};

type ToolCatalogSearchSkillEntry = {
  id: string;
  name: string;
  description: string;
  invocationPolicy: string;
  location: string;
};

const TOOL_CATALOG_QUERY_DEFAULT_MAX_RESULTS = 6;
const TOOL_CATALOG_QUERY_MAX_RESULTS_CAP = 10;
const TOOL_CATALOG_SHORT_TOKEN_ALLOWLIST = new Set([
  'adb',
  'api',
  'eas',
  'git',
  'ios',
  'mcp',
  'ota',
  'pdf',
  'pr',
  'sms',
  'ssh',
  'tts',
  'url',
]);
const TOOL_CATALOG_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'available',
  'be',
  'by',
  'can',
  'capability',
  'capabilities',
  'do',
  'find',
  'for',
  'from',
  'get',
  'help',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'need',
  'of',
  'on',
  'or',
  'perform',
  'right',
  'show',
  'task',
  'that',
  'the',
  'this',
  'to',
  'tool',
  'tools',
  'use',
  'using',
  'want',
  'with',
  'what',
  'which',
  'you',
  'your',
]);

const TOOL_CATALOG_CATEGORIES: Record<string, ToolCatalogCategoryConfig> = {
  files: {
    tools: ['read_file', 'write_file', 'list_files', 'file_edit', 'glob_search', 'text_search'],
    purpose: 'Search, read, create, and edit files in the conversation workspace.',
    guidance:
      'For codebase investigation, prefer glob_search or text_search first, then read_file. When changing an existing file, prefer file_edit with ordered edits after inspecting the target; reserve write_file for new files or intentional full rewrites.',
  },
  browser: {
    tools: [
      'browser_launch',
      'browser_navigate',
      'browser_snapshot',
      'browser_screenshot',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_console',
      'browser_errors',
      'browser_network',
      'browser_cookies',
      'browser_storage',
      'browser_status',
      'browser_evaluate',
      'browser_upload',
      'browser_download',
      'browser_pdf',
      'browser_fill_form',
      'browser_dialog',
    ],
    purpose: 'Launch and control websites interactively.',
    guidance:
      'For website automation, start with browser_launch or browser_navigate, inspect with browser_snapshot or browser_screenshot, then click, type, or evaluate as needed.',
  },
  workspace: {
    tools: [
      'workspace_list_files',
      'workspace_read_file',
      'workspace_write_file',
      'workspace_mkdir',
      'workspace_rename',
      'workspace_delete',
    ],
    purpose: 'Read and modify files in configured external workspace targets.',
    guidance:
      'Inspect the target first with workspace_list_files or workspace_read_file, then make focused changes with workspace_write_file or workspace_rename.',
  },
  web: {
    tools: ['fetch_url', 'web_search', 'web_fetch'],
    purpose: 'Search the web and fetch online documentation or pages.',
    guidance:
      'Use web_search for discovery, then web_fetch or fetch_url to read the exact page you need.',
  },
  canvas: {
    tools: [
      'canvas_list',
      'canvas_read',
      'canvas_create',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
    ],
    purpose: 'Create, inspect, read, update, evaluate, and capture session canvas previews.',
    guidance:
      'Call canvas_list first to inspect existing session surfaces, use canvas_read to inspect stored content or live DOM, prefer canvas_update over canvas_create when editing, use directoryPath for multi-file HTML/CSS/JS apps, use filePath for a single local HTML entry file, use contentEdits for focused HTML/source patches and componentOperations or dataOperations for structured updates, use canvas_eval for JavaScript execution or DOM changes, and reserve workspace file tools for explicit persistence or export requests.',
  },
  ssh: {
    tools: [
      'ssh_exec',
      'ssh_background_job_status',
      'ssh_background_job_wait',
      'ssh_list_directory',
      'ssh_read_file',
      'ssh_write_file',
      'ssh_rename_path',
      'ssh_delete_path',
      'ssh_make_directory',
    ],
    purpose: 'Execute commands and work with files on configured SSH targets.',
    guidance:
      'Prefer ssh_list_directory or ssh_read_file before ssh_write_file or ssh_delete_path when you are still inspecting a remote server. If you start a background SSH command, continue with ssh_background_job_status or ssh_background_job_wait using the returned jobId until it reaches a terminal state.',
  },
  expo: {
    tools: [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_build',
      'expo_eas_update',
      'expo_eas_submit',
      'expo_eas_deploy_web',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ],
    purpose: 'Inspect or operate Expo and EAS projects, builds, updates, and workflows.',
    guidance:
      'Use expo_eas_list_projects to discover project ids, expo_eas_status or expo_eas_probe for readiness checks, and workflow_* tools to monitor runs.',
  },
  sessions: {
    tools: [
      'sessions_spawn',
      'sessions_list',
      'sessions_send',
      'sessions_history',
      'sessions_output',
      'sessions_surface_output',
      'sessions_status',
      'sessions_wait',
      'sessions_cancel',
      'sessions_yield',
      'wait',
    ],
    purpose: 'Manage sub-agents, background sessions, and waiting states.',
    guidance:
      'Sub-agents and sessions_send follow-up workers run in the background by default and keep working until completion unless you set timeoutMs. Use sessions_wait when you need one or more worker outputs before proceeding, use sessions_output when you need the full final worker deliverable only, use sessions_surface_output when that deliverable should become the visible user answer directly, use sessions_history when you need transcript or reasoning trace, use sessions_status for live inspection or diagnosing drift, and reserve waitForCompletion for intentionally blocking the current spawn or send tool call.',
  },
  agents: {
    tools: ['agents_list', 'agents_switch', 'agents_configure'],
    purpose: 'Inspect, switch, or configure agent/persona behavior.',
  },
  calendar: {
    tools: ['calendar_list', 'calendar_events', 'calendar_create_event'],
    purpose: 'Inspect device calendars and create events.',
    guidance:
      'Call calendar_list before calendar_create_event when you need a specific calendarId.',
  },
  contacts: {
    tools: [
      'contacts_pick',
      'contacts_manage_access',
      'contacts_view',
      'contacts_edit',
      'contacts_create',
      'contacts_share',
      'contacts_search_full',
      'contacts_get_full',
    ],
    purpose:
      'Pick, inspect, edit, create, and share device contacts with privacy-first native flows.',
  },
  native: {
    tools: [
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'location_current',
      'clipboard_read',
      'clipboard_write',
      'share_text',
      'share_url',
      'share_file',
      'share_contact',
      'open_url',
      'notification_send',
      'notification_schedule',
      'device_status',
      'device_info',
      'device_permissions',
      'device_health',
      'photos_latest',
      'camera_clip',
      'screen_record',
      'haptic_feedback',
    ],
    purpose: 'Device, clipboard, notifications, location, sharing, and other mobile utility tools.',
  },
  media: {
    tools: ['camera_snap', 'audio_transcribe', 'speak', 'image_generate', 'image_edit'],
    purpose: 'Capture, generate, or edit media and speech.',
    guidance:
      'Use image_generate to create a new image from scratch. Use image_edit when the task must modify an existing workspace image while preserving specific content.',
  },
  memory: {
    tools: [
      'read_memory',
      'update_memory',
      'read_workflow_evidence',
      'record_workflow_evidence',
      'memory_search',
    ],
    purpose: 'Read, write, and search persisted memory plus structured workflow evidence.',
    guidance:
      'Use workflow evidence for run-scoped facts, verification notes, risks, decisions, and artifacts that should stay attached to the current agent run. Use conversation memory for broader task-local state shared across this conversation, and global memory only for durable facts that should persist across future conversations.',
  },
  automation: {
    tools: ['create_task', 'cron', 'notify', 'notification_send', 'notification_schedule'],
    purpose: 'Create scheduled tasks, cron jobs, and user alerts.',
  },
  code: {
    tools: ['javascript', 'python'],
    purpose:
      'Run sandboxed JavaScript or Python for calculations, data transformation, script execution, and capability-extension workflows.',
    guidance: `Use javascript for lightweight synchronous calculations or text transformations. Use python for Pyodide-compatible scripts, data/science libraries, or when the task explicitly requires Python. ${PYTHON_EXTENSION_WHEN_NEEDED} ${PYTHON_EXTENSION_EXAMPLES} ${PYTHON_EXTENSION_POLICY}`,
  },
  pdf: {
    tools: ['pdf_read'],
    purpose: 'Read and extract content from PDF documents.',
  },
  interaction: {
    tools: ['poll_create', 'message_effect'],
    purpose: 'Interactive response helpers such as polls and message effects.',
  },
};

function normalizeToolCatalogSearchText(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeToolCatalogSearchText(value: string | undefined): string[] {
  const normalized = normalizeToolCatalogSearchText(value);
  if (!normalized) {
    return [];
  }

  return Array.from(
    new Set(
      normalized
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .filter((token) => token.length >= 3 || TOOL_CATALOG_SHORT_TOKEN_ALLOWLIST.has(token))
        .filter((token) => !TOOL_CATALOG_STOP_WORDS.has(token)),
    ),
  );
}

function buildToolCatalogQueryPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return Array.from(new Set(phrases));
}

function hasToolCatalogPrefixMatch(tokens: Set<string>, queryToken: string): boolean {
  for (const token of tokens) {
    if (token.startsWith(queryToken) || queryToken.startsWith(token)) {
      return true;
    }
  }
  return false;
}

function scoreToolCatalogSearchCandidate(params: {
  query: string;
  queryTokens: string[];
  queryPhrases: string[];
  name: string;
  description?: string;
  categoryLabel?: string;
  purpose?: string;
  guidance?: string;
  extraTexts?: string[];
}): { score: number; matchedFields: string[] } {
  const normalizedQuery = normalizeToolCatalogSearchText(params.query);
  const nameText = normalizeToolCatalogSearchText(params.name);
  const descriptionText = normalizeToolCatalogSearchText(params.description);
  const categoryText = normalizeToolCatalogSearchText(params.categoryLabel);
  const purposeText = normalizeToolCatalogSearchText(params.purpose);
  const guidanceText = normalizeToolCatalogSearchText(params.guidance);
  const extraText = normalizeToolCatalogSearchText((params.extraTexts || []).join(' '));

  const nameTokens = new Set(tokenizeToolCatalogSearchText(params.name));
  const descriptionTokens = new Set(tokenizeToolCatalogSearchText(params.description));
  const categoryTokens = new Set(tokenizeToolCatalogSearchText(params.categoryLabel));
  const purposeTokens = new Set(tokenizeToolCatalogSearchText(params.purpose));
  const guidanceTokens = new Set(tokenizeToolCatalogSearchText(params.guidance));
  const extraTokens = new Set(tokenizeToolCatalogSearchText((params.extraTexts || []).join(' ')));

  let score = 0;
  const matchedFields = new Set<string>();

  if (normalizedQuery && nameText.includes(normalizedQuery)) {
    score += 80;
    matchedFields.add('name');
  } else if (
    normalizedQuery &&
    [descriptionText, purposeText, guidanceText, categoryText, extraText].some((text) =>
      text.includes(normalizedQuery),
    )
  ) {
    score += 36;
    matchedFields.add('description');
  }

  for (const token of params.queryTokens) {
    if (nameTokens.has(token)) {
      score += 24;
      matchedFields.add('name');
      continue;
    }
    if (hasToolCatalogPrefixMatch(nameTokens, token)) {
      score += 12;
      matchedFields.add('name');
    }

    if (categoryTokens.has(token)) {
      score += 16;
      matchedFields.add('category');
      continue;
    }
    if (purposeTokens.has(token)) {
      score += 10;
      matchedFields.add('purpose');
      continue;
    }
    if (guidanceTokens.has(token)) {
      score += 8;
      matchedFields.add('guidance');
      continue;
    }
    if (descriptionTokens.has(token) || extraTokens.has(token)) {
      score += 8;
      matchedFields.add('description');
      continue;
    }
    if (
      hasToolCatalogPrefixMatch(descriptionTokens, token) ||
      hasToolCatalogPrefixMatch(purposeTokens, token) ||
      hasToolCatalogPrefixMatch(extraTokens, token)
    ) {
      score += 4;
      matchedFields.add('description');
    }
  }

  for (const phrase of params.queryPhrases) {
    if (nameText.includes(phrase)) {
      score += 18;
      matchedFields.add('name');
      continue;
    }

    if (
      [descriptionText, purposeText, guidanceText, categoryText, extraText].some((text) =>
        text.includes(phrase),
      )
    ) {
      score += 10;
      matchedFields.add('description');
    }
  }

  return { score, matchedFields: Array.from(matchedFields) };
}

function describeToolCatalogSearchMatch(matchedFields: string[]): string | undefined {
  if (matchedFields.length === 0) {
    return undefined;
  }

  const labels: Record<string, string> = {
    name: 'tool name',
    category: 'category',
    purpose: 'category purpose',
    guidance: 'usage guidance',
    description: 'description',
  };

  return `Matched ${matchedFields.map((field) => labels[field] || field).join(', ')} terms.`;
}

function clampToolCatalogMaxResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TOOL_CATALOG_QUERY_DEFAULT_MAX_RESULTS;
  }

  return Math.max(1, Math.min(TOOL_CATALOG_QUERY_MAX_RESULTS_CAP, Math.round(value)));
}

function getDynamicMcpCatalog(options?: { availableToolNames?: ReadonlySet<string> }) {
  const statuses = mcpManager.getAllStatuses();
  const definitionNames =
    typeof (mcpManager as { getAllToolDefinitions?: () => Array<{ name: string }> })
      .getAllToolDefinitions === 'function'
      ? new Set(mcpManager.getAllToolDefinitions().map((tool) => tool.name))
      : null;
  const isToolVisible = (toolName: string): boolean => {
    if (definitionNames && !definitionNames.has(toolName)) {
      return false;
    }
    if (options?.availableToolNames && !options.availableToolNames.has(toolName)) {
      return false;
    }
    return true;
  };
  const servers = statuses
    .filter((status) => status.state === 'connected')
    .map((status) => {
      const tools = status.tools
        .map((tool) => ({
          name: `mcp__${status.id}__${tool.name}`,
          displayName: tool.name,
          description: tool.description ?? tool.name,
        }))
        .filter((tool) => isToolVisible(tool.name));

      return {
        id: status.id,
        name: status.name,
        toolCount: tools.length,
        tools,
      };
    });
  const pendingServers = statuses
    .filter((status) => status.state !== 'connected')
    .map((status) => ({
      id: status.id,
      name: status.name,
      state: status.state,
      authRequired: status.authRequired === true,
    }));
  const tools = servers.flatMap((server) =>
    server.tools.map((tool) => ({
      ...tool,
      serverId: server.id,
      serverName: server.name,
    })),
  );

  return { servers, pendingServers, tools };
}

function getDynamicSkillCatalog(options?: { availableToolNames?: ReadonlySet<string> }) {
  const tools = filterCatalogEntriesByVisibility(
    getSkillToolDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
    })),
    options?.availableToolNames,
  );
  const skills = useSkillsStore
    .getState()
    .getEnabled()
    .filter((entry) => entry.metadata && isSkillCompatible(entry.metadata).compatible)
    .map((entry) => ({
      id: entry.id,
      name: entry.metadata.name,
      description: entry.metadata.description || 'No description provided.',
      invocationPolicy: entry.metadata.invocationPolicy || 'auto',
      location: getSkillCatalogLocation(entry),
    }));

  return { skills, tools };
}

// ── Tool catalog tool ────────────────────────────────────────────────────

export async function executeToolCatalog(
  args: {
    category?: string;
    query?: string;
    maxResults?: number;
  },
  options?: {
    availableToolNames?: ReadonlySet<string>;
  },
): Promise<string> {
  const availableToolNames = options?.availableToolNames;
  const buildActivation = (
    recommendedToolNames: string[],
    activationOptions?: {
      category?: string;
      supportingToolNames?: string[];
      rationale?: string;
    },
  ) => ({
    callableNextTurn: recommendedToolNames.length > 0,
    recommendedToolNames,
    ...(activationOptions?.supportingToolNames && activationOptions.supportingToolNames.length > 0
      ? { supportingToolNames: activationOptions.supportingToolNames }
      : {}),
    ...(activationOptions?.category ? { category: activationOptions.category } : {}),
    ...(activationOptions?.rationale ? { rationale: activationOptions.rationale } : {}),
  });
  const sampleTools = (toolNames: string[], max = 4) => toolNames.slice(0, max);
  const filterToolNames = (toolNames: string[]) =>
    availableToolNames
      ? toolNames.filter((toolName) => availableToolNames.has(toolName))
      : toolNames;
  const staticVisibleTools = availableToolNames
    ? TOOL_DEFINITIONS.filter((tool) => availableToolNames.has(tool.name))
    : TOOL_DEFINITIONS;
  const mcpCatalog = getDynamicMcpCatalog({ availableToolNames });
  const skillCatalog = getDynamicSkillCatalog({ availableToolNames });
  const requestedCategory =
    typeof args.category === 'string' ? args.category.trim().toLowerCase() : undefined;
  const requestedQuery = typeof args.query === 'string' ? args.query.trim() : '';
  const maxResults = clampToolCatalogMaxResults(args.maxResults);
  const availableCategories = [...Object.keys(TOOL_CATALOG_CATEGORIES), 'mcp', 'skills'];
  const staticToolMap = new Map(staticVisibleTools.map((tool) => [tool.name, tool]));

  if (
    requestedCategory &&
    !TOOL_CATALOG_CATEGORIES[requestedCategory] &&
    requestedCategory !== 'mcp' &&
    requestedCategory !== 'skills'
  ) {
    return JSON.stringify({
      error: `Unknown tool_catalog category: ${args.category}`,
      availableCategories,
      guidance:
        'Use one of the available category names exactly as listed. If you do not know the domain yet, call tool_catalog with query="what you need to do" instead of guessing a category.',
    });
  }

  if (requestedQuery) {
    const queryTokens = tokenizeToolCatalogSearchText(requestedQuery);
    const queryPhrases = buildToolCatalogQueryPhrases(queryTokens);
    const categoryNames = !requestedCategory
      ? Object.keys(TOOL_CATALOG_CATEGORIES)
      : requestedCategory !== 'mcp' && requestedCategory !== 'skills'
        ? [requestedCategory]
        : [];
    const toolCandidates: ToolCatalogSearchToolEntry[] = [];
    const skillEntries: ToolCatalogSearchSkillEntry[] = [];

    for (const categoryName of categoryNames) {
      const config = TOOL_CATALOG_CATEGORIES[categoryName];
      for (const toolName of filterToolNames(config.tools)) {
        if (toolName === 'tool_catalog') {
          continue;
        }

        const tool = staticToolMap.get(toolName);
        if (!tool) {
          continue;
        }

        toolCandidates.push({
          name: tool.name,
          description: tool.description || tool.name,
          category: categoryName,
          source: 'built-in',
          purpose: config.purpose,
          guidance: config.guidance,
        });
      }
    }

    if (!requestedCategory || requestedCategory === 'mcp') {
      for (const tool of mcpCatalog.tools) {
        toolCandidates.push({
          name: tool.name,
          description: tool.description,
          category: 'mcp',
          source: 'mcp',
          purpose: 'Connected external MCP server tools.',
          guidance:
            'Connected MCP tools are callable directly with the exact tool name shown here, including the mcp__serverId__toolName prefix.',
          serverName: tool.serverName,
        });
      }
    }

    if (!requestedCategory || requestedCategory === 'skills') {
      for (const tool of skillCatalog.tools) {
        toolCandidates.push({
          name: tool.name,
          description: tool.description,
          category: 'skills',
          source: 'skill',
          purpose: 'Installed instruction skills plus any callable skill tools.',
          guidance:
            'Read the SKILL.md location before following a skill, and then use one of the listed skill__... tools on the next turn.',
          skillName: tool.name.replace(/^skill__/, '').split('__')[0] || undefined,
        });
      }

      skillEntries.push(...skillCatalog.skills);
    }

    const scoredToolMatches = toolCandidates
      .map((candidate) => {
        const scored = scoreToolCatalogSearchCandidate({
          query: requestedQuery,
          queryTokens,
          queryPhrases,
          name: candidate.name,
          description: candidate.description,
          categoryLabel: candidate.category,
          purpose: candidate.purpose,
          guidance: candidate.guidance,
          extraTexts: [candidate.serverName || '', candidate.skillName || ''],
        });

        return {
          ...candidate,
          score: scored.score,
          matchedFields: scored.matchedFields,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        const scoreDiff = right.score - left.score;
        return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
      })
      .slice(0, maxResults);

    const scoredSkillMatches = skillEntries
      .map((skill) => {
        const scored = scoreToolCatalogSearchCandidate({
          query: requestedQuery,
          queryTokens,
          queryPhrases,
          name: skill.name,
          description: skill.description,
          categoryLabel: 'skills',
          purpose: 'Installed instruction skills plus any callable skill tools.',
          guidance: 'Read the SKILL.md location before following a skill.',
          extraTexts: [skill.location, skill.invocationPolicy],
        });

        return {
          ...skill,
          score: scored.score,
          matchedFields: scored.matchedFields,
        };
      })
      .filter((skill) => skill.score > 0)
      .sort((left, right) => {
        const scoreDiff = right.score - left.score;
        return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
      })
      .slice(0, Math.min(3, maxResults));

    const categorySuggestions = !requestedCategory
      ? availableCategories
          .map((category) => {
            const config =
              category === 'mcp'
                ? {
                    purpose: 'Connected external MCP server tools.',
                    guidance: mcpCatalog.servers
                      .map(
                        (server) =>
                          `${server.name} ${server.tools.map((tool) => tool.displayName).join(' ')}`,
                      )
                      .join(' '),
                  }
                : category === 'skills'
                  ? {
                      purpose: 'Installed instruction skills plus any callable skill tools.',
                      guidance: skillCatalog.skills
                        .map((skill) => `${skill.name} ${skill.description}`)
                        .join(' '),
                    }
                  : {
                      purpose: TOOL_CATALOG_CATEGORIES[category].purpose,
                      guidance: TOOL_CATALOG_CATEGORIES[category].guidance,
                    };
            const scored = scoreToolCatalogSearchCandidate({
              query: requestedQuery,
              queryTokens,
              queryPhrases,
              name: category,
              categoryLabel: category,
              purpose: config.purpose,
              guidance: config.guidance,
            });

            return {
              category,
              score: scored.score,
              purpose: config.purpose,
              inspectWith: `tool_catalog category="${category}"`,
            };
          })
          .filter((entry) => entry.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.category.localeCompare(right.category),
          )
          .slice(0, 3)
          .map(({ category, purpose, inspectWith }) => ({ category, purpose, inspectWith }))
      : [];

    const matchedToolNames = scoredToolMatches.map((tool) => tool.name);
    const recommendedToolNames = matchedToolNames.slice(0, Math.min(3, matchedToolNames.length));
    const supportingToolNames = matchedToolNames.slice(
      recommendedToolNames.length,
      Math.min(recommendedToolNames.length + 4, matchedToolNames.length),
    );
    const guidance =
      matchedToolNames.length > 0
        ? requestedCategory === 'mcp'
          ? 'Use one of the matched MCP tools next with the exact mcp__serverId__toolName shown here. Do not repeat the same search unless the plan changed or the result was incomplete.'
          : requestedCategory === 'skills'
            ? 'Use one of the matched skill__... tools next. If a listed skill looks relevant, read its SKILL.md location before following it. Do not repeat the same search unless the plan changed or the result was incomplete.'
            : 'Use one of the matched tools next. If the needed capability is still unclear, refine the query or browse a narrower category instead of guessing.'
        : scoredSkillMatches.length > 0
          ? 'No callable tool matched strongly enough, but the listed skills look relevant. Read the SKILL.md location for the best match, then use any associated skill__... tool if needed.'
          : categorySuggestions.length > 0
            ? `No strong callable tool match found. Refine the query or inspect one of these likely categories next: ${categorySuggestions.map((entry) => `${entry.category} (${entry.inspectWith})`).join(', ')}.`
            : 'No strong callable tool match found. Refine the query or browse the full catalog overview to inspect categories manually.';

    return JSON.stringify({
      mode: 'search',
      query: requestedQuery,
      ...(requestedCategory ? { category: requestedCategory } : {}),
      matches: scoredToolMatches.map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        source: tool.source,
        ...(tool.serverName ? { serverName: tool.serverName } : {}),
        ...(tool.skillName ? { skillName: tool.skillName } : {}),
        ...(describeToolCatalogSearchMatch(tool.matchedFields)
          ? { matchReason: describeToolCatalogSearchMatch(tool.matchedFields) }
          : {}),
      })),
      matchingSkills: scoredSkillMatches.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        invocationPolicy: skill.invocationPolicy,
        location: skill.location,
        ...(describeToolCatalogSearchMatch(skill.matchedFields)
          ? { matchReason: describeToolCatalogSearchMatch(skill.matchedFields) }
          : {}),
      })),
      categorySuggestions,
      availableCategories,
      activation: buildActivation(recommendedToolNames, {
        ...(requestedCategory ? { category: requestedCategory } : {}),
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory === 'mcp') {
    const toolNames = mcpCatalog.tools.map((tool) => tool.name);
    const recommendedToolNames = toolNames.slice(0, Math.min(4, toolNames.length));
    const supportingToolNames = toolNames.slice(recommendedToolNames.length);
    const guidance =
      toolNames.length > 0
        ? 'Connected MCP tools are callable directly with the exact tool name shown here, including the mcp__serverId__toolName prefix. Use one of these tools next instead of repeating tool_catalog for the same category.'
        : 'No callable MCP tools are available under the current tool policy. If you expected an MCP tool here, adjust the current tool allowlist or sandbox policy.';
    return JSON.stringify({
      mode: 'category',
      category: 'mcp',
      servers: mcpCatalog.servers,
      pendingServers: mcpCatalog.pendingServers,
      tools: mcpCatalog.tools,
      activation: buildActivation(recommendedToolNames, {
        category: 'mcp',
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory === 'skills') {
    const toolNames = skillCatalog.tools.map((tool) => tool.name);
    const recommendedToolNames = toolNames.slice(0, Math.min(4, toolNames.length));
    const supportingToolNames = toolNames.slice(recommendedToolNames.length);
    const guidance =
      toolNames.length > 0
        ? 'Installed skills expose instruction files plus any callable skill__... tools. Read the SKILL.md location before following a skill, and then use one of the listed skill__... tools on the next turn instead of repeating tool_catalog for the same category.'
        : 'No callable skill tools are available under the current tool policy. If you expected a skill tool here, adjust the current tool allowlist or sandbox policy.';
    return JSON.stringify({
      mode: 'category',
      category: 'skills',
      skills: skillCatalog.skills,
      tools: skillCatalog.tools,
      activation: buildActivation(recommendedToolNames, {
        category: 'skills',
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  if (requestedCategory) {
    const selectedCategory = TOOL_CATALOG_CATEGORIES[requestedCategory];

    const names = filterToolNames(selectedCategory.tools);
    const tools = staticVisibleTools.filter((t) => names.includes(t.name));
    const recommendedToolNames = tools.slice(0, Math.min(4, tools.length)).map((tool) => tool.name);
    const supportingToolNames = tools.slice(recommendedToolNames.length).map((tool) => tool.name);
    const guidance =
      tools.length > 0
        ? `${selectedCategory.guidance || 'Use one of the discovered tools next.'} Do not repeat tool_catalog for the same category unless the plan changed or the earlier result was incomplete.`
        : 'No callable tools from this category are available under the current tool policy. Pick another category or adjust the current tool allowlist before retrying.';
    return JSON.stringify({
      mode: 'category',
      category: requestedCategory,
      purpose: selectedCategory.purpose,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      activation: buildActivation(recommendedToolNames, {
        category: requestedCategory,
        supportingToolNames,
        rationale: guidance,
      }),
      guidance,
    });
  }

  // Return all categories with tool counts
  const catalog: Array<{
    category: string;
    purpose: string;
    count: number;
    sampleTools: string[];
    skills?: string[];
    inspectWith: string;
  }> = Object.entries(TOOL_CATALOG_CATEGORIES)
    .map(([cat, config]) => ({
      category: cat,
      purpose: config.purpose,
      count: filterToolNames(config.tools).length,
      sampleTools: sampleTools(filterToolNames(config.tools)),
      inspectWith: `tool_catalog category="${cat}"`,
    }))
    .filter((entry) => entry.count > 0);
  if (mcpCatalog.servers.length > 0 || mcpCatalog.pendingServers.length > 0) {
    catalog.push({
      category: 'mcp',
      purpose: 'Connected external MCP server tools.',
      count: mcpCatalog.tools.length,
      sampleTools: sampleTools(mcpCatalog.tools.map((tool) => tool.name)),
      inspectWith: 'tool_catalog category="mcp"',
    });
  }
  if (skillCatalog.skills.length > 0 || skillCatalog.tools.length > 0) {
    catalog.push({
      category: 'skills',
      purpose: 'Installed instruction skills plus any callable skill tools.',
      count: skillCatalog.skills.length,
      sampleTools: sampleTools(skillCatalog.tools.map((tool) => tool.name)),
      inspectWith: 'tool_catalog category="skills"',
      skills: skillCatalog.skills.map((skill) => skill.name),
    });
  }

  return JSON.stringify({
    mode: 'overview',
    categories: catalog,
    availableCategories,
    totalTools: staticVisibleTools.length + mcpCatalog.tools.length + skillCatalog.tools.length,
    totalMcpTools: mcpCatalog.tools.length,
    totalSkills: skillCatalog.skills.length,
    totalSkillTools: skillCatalog.tools.length,
    activation: {
      callableNextTurn: false,
      requiresCategorySelection: true,
    },
    guidance:
      'Overview mode is for discovery only. If you know the task but not the tool name, call tool_catalog with query="what you need to do". If you already know the domain, call tool_catalog with that category to make the matching tools callable on the next turn. Use category="files" for repo search/read/edit, "code" for calculations, Python/JavaScript execution, or capability-extension scripts, "web" for online documentation or research, "browser" for interactive website control, "workspace" for configured external workspaces, "mcp" for connected external servers, and "skills" for installed instruction skills.',
  });
}

export async function executePollCreate(args: {
  question: string;
  options: string[];
  allowMultiple?: boolean;
  durationMs?: number;
}): Promise<string> {
  const normalizedOptions = (args.options || [])
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((label) => ({ id: generateId(), label, votes: 0 }));

  if (!args.question?.trim()) {
    return JSON.stringify({ status: 'error', error: 'Poll question is required' });
  }

  if (normalizedOptions.length < 2) {
    return JSON.stringify({ status: 'error', error: 'At least two poll options are required' });
  }

  return JSON.stringify({
    status: 'created',
    poll: {
      id: generateId(),
      question: args.question.trim(),
      options: normalizedOptions,
      allowMultiple: args.allowMultiple === true,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    },
  });
}

export async function executeMessageEffect(args: { effectId: string }): Promise<string> {
  const effectId = (args.effectId || '').trim().toLowerCase();
  if (!['confetti', 'balloons', 'spotlight'].includes(effectId)) {
    return JSON.stringify({
      status: 'error',
      error: 'Unsupported effect. Use confetti, balloons, or spotlight.',
    });
  }

  return JSON.stringify({ status: 'applied', effectId });
}

// ── Speak (TTS) tool ─────────────────────────────────────────────────────

export async function executeSpeak(args: { text: string; provider?: string }): Promise<string> {
  try {
    const provider = (args.provider || 'system') as TTSProvider;
    await speakText(args.text, provider);
    return JSON.stringify({
      status: 'spoken',
      textLength: args.text.length,
      provider,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}

// ── Agent management tools ───────────────────────────────────────────────

export async function executeAgentsList(): Promise<string> {
  const personas = getAvailablePersonas();
  return JSON.stringify({
    agents: personas.map((persona) => ({
      id: persona.id,
      name: persona.name,
      description: persona.description,
      icon: persona.icon,
      custom: !BUILT_IN_PERSONAS.some((entry) => entry.id === persona.id),
    })),
  });
}

export async function executeAgentsSwitch(
  args: {
    personaId: string;
  },
  conversationId?: string,
): Promise<string> {
  const persona = getPersona(args.personaId);
  if (!persona) {
    return `Error: persona not found: ${args.personaId}. Use agents_list to see available personas.`;
  }
  if (conversationId) {
    useChatStore.getState().updatePersonaInConversation(conversationId, args.personaId);
  }
  return JSON.stringify({
    status: 'switched',
    personaId: args.personaId,
    name: persona.name,
  });
}

export async function executeAgentsConfigure(args: {
  personaId: string;
  name?: string;
  description?: string;
  model?: string;
  providerId?: string;
  systemPrompt?: string;
  temperature?: number;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}): Promise<string> {
  const persona = getPersona(args.personaId);
  const store = usePersonaConfigStore.getState();

  if (!persona) {
    const created: AgentPersona = {
      id: args.personaId,
      name: args.name || args.personaId,
      description: args.description || args.systemPrompt?.slice(0, 100) || 'Custom agent',
      systemPrompt: args.systemPrompt || 'You are a helpful AI assistant.',
      model: args.model,
      providerId: args.providerId,
      temperature: args.temperature,
      thinkingLevel: args.thinkingLevel,
      icon: '🔧',
    };
    store.upsertCustomPersona(created);
    return JSON.stringify({ status: 'created', persona: { id: created.id, name: created.name } });
  }

  if (isBuiltInPersona(args.personaId)) {
    store.setOverride(args.personaId, {
      ...(args.name ? { name: args.name } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.thinkingLevel ? { thinkingLevel: args.thinkingLevel } : {}),
    });
  } else {
    store.upsertCustomPersona({
      ...persona,
      ...(args.name ? { name: args.name } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.thinkingLevel ? { thinkingLevel: args.thinkingLevel } : {}),
    });
  }

  const updated =
    getPersona(args.personaId) ||
    usePersonaConfigStore.getState().customPersonas.find((entry) => entry.id === args.personaId);

  return JSON.stringify({
    status: 'configured',
    persona: { id: args.personaId, name: updated?.name || args.name || args.personaId },
  });
}
