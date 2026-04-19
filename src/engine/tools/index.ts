// ---------------------------------------------------------------------------
// Kavi — Tool Executor
// ---------------------------------------------------------------------------
// Central dispatcher: routes tool calls to the correct executor.

import { Paths, File, Directory } from 'expo-file-system';
import { executeWebSearch } from './web-search';
import { executeWebFetch } from './web-fetch';
import { executeFileEdit, executeGlobSearch, executeTextSearch } from './extended';
import { executeNativeTool } from './native-executor';
import {
  executeCanvasList,
  executeCanvasRead,
  executeCanvasCreate,
  executeCanvasUpdate,
  executeCanvasDelete,
  executeCanvasNavigate,
  executeCanvasEval,
  executeCanvasSnapshot,
  executeSessionSpawn,
  executeSessionList,
  executeSessionSend,
  executeSessionHistory,
  executeSessionOutput,
  executeSessionSurfaceOutput,
  executeSessionStatus,
  executeSessionWait,
  executeSessionCancel,
  executeSessionYield,
  executeWait,
  executePdfRead,
  executeCameraSnap,
  executeAudioTranscribe,
  executeMemorySearch,
  executeSshDeletePath,
  executeSshExec,
  executeSshBackgroundJobStatus,
  executeSshBackgroundJobWait,
  executeSshListDirectory,
  executeSshMakeDirectory,
  executeSshReadFile,
  executeSshRenamePath,
  executeSshWriteFile,
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
  executeToolCatalog,
  executePollCreate,
  executeMessageEffect,
  executeSpeak,
  executeAgentsList,
  executeAgentsSwitch,
  executeAgentsConfigure,
} from './parity-executor';
import { parseMcpToolName, executeMcpTool } from '../../services/mcp/bridge';
import { isAllowedUrl } from '../../services/security/ssrf';
import { mcpManager } from '../../services/mcp/manager';
import { parseSkillToolName, executeSkillTool } from '../../services/skills/manager';
import {
  appendConversationMemory,
  appendGlobalMemory,
  readConversationMemory,
  readGlobalMemory,
  writeConversationMemory,
  writeGlobalMemory,
} from '../../services/memory/store';
import { getSubAgent } from '../../services/agents/subAgent';
import { buildAutomaticPythonEvidenceEntries } from '../../services/agents/automaticEvidence';
import {
  AGENT_RUN_EVIDENCE_KIND_VALUES,
  AGENT_RUN_EVIDENCE_RECORDER_VALUES,
  AGENT_RUN_EVIDENCE_STATUS_VALUES,
  filterAgentRunEvidenceEntries,
  type AgentRunEvidenceDraft,
  type AgentRunEvidenceFilter,
} from '../../services/agents/evidence';
import { useSchedulerStore } from '../../services/scheduler/store';
import { logToolCall } from '../../services/security/audit';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { needsApprovalWithContext, requestToolApproval } from '../../services/remote/approvalStore';
import { formatJavaScriptResult } from '../../utils/javascript';
import { buildFileCache, executeWorkspaceJavaScript } from '../../utils/jsBridge';
import {
  executePython,
  type PythonExecutionResult,
  type PythonWorkflowBridgeState,
  type PythonWorkspaceFile,
} from '../../services/python/pyodideBridge';
import { extractPep723Dependencies } from '../../services/python/scriptMetadata';
import { MAX_PYTHON_WORKFLOW_BRIDGE_ENTRIES } from '../../services/python/workflowBridge';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { editImage, generateImage } from '../../services/media/imageGeneration';
import { isVertexNativeGeminiBaseUrl, looksLikeGeminiProvider } from '../../constants/api';
import {
  hydrateProviderForRequest,
  providerRequiresApiKey,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../../services/llm/providerSupport';
import { executeBrowserTool } from './browserToolExecutor';
import { executeWorkspaceTool } from './workspaceToolExecutor';
import {
  getOptionalToolStringArg,
  requireToolStringArg,
  sanitizeWorkspaceRelativePath,
} from './fileArgumentUtils';
import {
  normalizeBrowserToolResult,
  normalizeJavaScriptToolResult,
  normalizePythonToolResult,
  normalizeWorkspaceListResult,
  normalizeWorkspaceMutationResult,
  normalizeWorkspaceReadResult,
} from './toolResultNormalization';
import type {
  AgentRunEvidenceEntry,
  AgentRunEvidenceKind,
  AgentRunEvidenceRecorder,
  AgentRunEvidenceStatus,
  EmbeddingConfig,
  LlmProviderConfig,
} from '../../types';
import { normalizeToolName } from './toolNameNormalization';

const MAX_FETCH_SIZE = 100 * 1024; // 100KB
const PYTHON_WORKSPACE_MAX_FILES = 128;
const PYTHON_WORKSPACE_MAX_BYTES = 8 * 1024 * 1024;
const JAVASCRIPT_WORKSPACE_MAX_FILES = 128;
const JAVASCRIPT_WORKSPACE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PYTHON_TOOL_TIMEOUT_MS = 15 * 60 * 1000;
const PYTHON_HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;
const MAX_WORKFLOW_EVIDENCE_READ_LIMIT = 24;

export interface ToolExecutionContext {
  provider?: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames?: string[];
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (
    globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64');
  }

  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('');
  return btoa(binary);
}

function decodeBase64ToBytes(base64Data: string): Uint8Array {
  const sanitized = base64Data.replace(/\s+/g, '');
  const bufferCtor = (
    globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }
  ).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(sanitized, 'base64'));
  }

  const binary = atob(sanitized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// ── Resolve active provider with hydrated API key ────────────────────────
async function hydrateProviderApiKey(provider: LlmProviderConfig | null | undefined) {
  if (!provider) return null;
  const hydrated = await hydrateProviderForRequest(provider);
  if (providerRequiresApiKey(provider) && !hydrated.apiKey) return null;
  return hydrated;
}

async function resolveActiveProvider(context?: ToolExecutionContext) {
  if (context?.provider) {
    return hydrateProviderApiKey(context.provider);
  }

  const settings = useSettingsStore.getState();
  const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
  return hydrateProviderApiKey(provider);
}

function resolveEnabledProviders(context?: ToolExecutionContext): LlmProviderConfig[] {
  if (Array.isArray(context?.allProviders) && context.allProviders.length > 0) {
    return context.allProviders.filter((provider) => provider.enabled);
  }

  return useSettingsStore.getState().providers.filter((provider) => provider.enabled);
}

function normalizeOllamaEmbeddingBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
}

function resolveMemorySearchEmbeddingConfig(
  provider: LlmProviderConfig | null | undefined,
): EmbeddingConfig | undefined {
  if (!provider) {
    return undefined;
  }

  const normalizedApiKey = provider.apiKey?.trim() || undefined;
  const normalizedBaseUrl = provider.baseUrl?.trim() || undefined;
  const lowerName = provider.name.toLowerCase();
  const lowerBaseUrl = (normalizedBaseUrl || '').toLowerCase();

  if (looksLikeGeminiProvider(provider)) {
    const usesVertexExpressBase =
      isVertexNativeGeminiBaseUrl(normalizedBaseUrl) &&
      !/\/projects\/[^/]+\/locations\/[^/]+$/i.test(normalizedBaseUrl || '');
    if (usesVertexExpressBase) {
      return undefined;
    }

    return {
      provider: 'gemini',
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
    };
  }

  if (lowerName.includes('openai') || lowerBaseUrl.includes('api.openai.com')) {
    return {
      provider: 'openai',
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
    };
  }

  if (lowerName.includes('mistral') || lowerBaseUrl.includes('mistral.ai')) {
    return {
      provider: 'mistral',
      apiKey: normalizedApiKey,
    };
  }

  if (lowerName.includes('voyage') || lowerBaseUrl.includes('voyageai.com')) {
    return {
      provider: 'voyage',
      apiKey: normalizedApiKey,
    };
  }

  if (lowerName.includes('ollama') || /(?:localhost|127\.0\.0\.1):11434/.test(lowerBaseUrl)) {
    return {
      provider: 'ollama',
      baseUrl: normalizeOllamaEmbeddingBaseUrl(normalizedBaseUrl),
    };
  }

  return undefined;
}

// ── Native tool names for routing ────────────────────────────────────────
const NATIVE_TOOL_NAMES = new Set([
  'calendar_list',
  'calendar_events',
  'calendar_create_event',
  'email_compose',
  'sms_compose',
  'phone_call',
  'maps_open',
  'contacts_pick',
  'contacts_manage_access',
  'contacts_view',
  'contacts_edit',
  'contacts_create',
  'contacts_share',
  'contacts_search_full',
  'contacts_get_full',
  'contacts_search',
  'contacts_get',
  'location_current',
  'clipboard_read',
  'clipboard_write',
  'share_text',
  'share_url',
  'share_file',
  'share_contact',
  'share',
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
]);

const PARITY_TOOL_NAMES = new Set([
  'canvas_list',
  'canvas_read',
  'canvas_create',
  'canvas_update',
  'canvas_delete',
  'canvas_navigate',
  'canvas_eval',
  'canvas_snapshot',
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
  'pdf_read',
  'camera_snap',
  'audio_transcribe',
  'memory_search',
  'ssh_exec',
  'ssh_background_job_status',
  'ssh_background_job_wait',
  'ssh_list_directory',
  'ssh_read_file',
  'ssh_write_file',
  'ssh_rename_path',
  'ssh_delete_path',
  'ssh_make_directory',
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
  'tool_catalog',
  'poll_create',
  'message_effect',
  'speak',
  'agents_list',
  'agents_switch',
  'agents_configure',
]);

const BROWSER_TOOL_NAMES = new Set([
  'browser_launch',
  'browser_stop',
  'browser_status',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_hover',
  'browser_select',
  'browser_drag',
  'browser_wait',
  'browser_screenshot',
  'browser_snapshot',
  'browser_console',
  'browser_errors',
  'browser_network',
  'browser_cookies',
  'browser_storage',
  'browser_evaluate',
  'browser_upload',
  'browser_download',
  'browser_pdf',
  'browser_fill_form',
  'browser_dialog',
]);

const WORKSPACE_TOOL_NAMES = new Set([
  'workspace_read_file',
  'workspace_write_file',
  'workspace_list_files',
  'workspace_mkdir',
  'workspace_rename',
  'workspace_delete',
  'workspace_status',
  'workspace_launch_browser',
  'workspace_delegate_task',
]);

function getWorkspaceDir(conversationId: string): Directory {
  return new Directory(Paths.document, 'workspace', conversationId);
}

function sanitizePath(inputPath: string): string {
  return sanitizeWorkspaceRelativePath(inputPath);
}

async function readConversationWorkspaceFile(
  conversationId: string,
  safePath: string,
  fallbackConversationId?: string,
): Promise<string> {
  const primaryFile = new File(getWorkspaceDir(conversationId), safePath);

  if (primaryFile.exists) {
    return await primaryFile.text();
  }

  if (fallbackConversationId && fallbackConversationId !== conversationId) {
    const fallbackFile = new File(getWorkspaceDir(fallbackConversationId), safePath);
    if (fallbackFile.exists) {
      return await fallbackFile.text();
    }
  }

  throw new Error(`file not found: ${safePath}`);
}

async function listConversationWorkspaceDirectory(
  conversationId: string,
  safePath: string,
  fallbackConversationId?: string,
): Promise<Array<{ path: string; kind: 'file' | 'directory' }>> {
  const resolveEntries = (targetConversationId: string) => {
    const targetDir = safePath
      ? new Directory(getWorkspaceDir(targetConversationId), safePath)
      : getWorkspaceDir(targetConversationId);

    if (!targetDir.exists) {
      return null;
    }

    return targetDir.list().map((entry) => ({
      path: safePath ? `${safePath}/${entry.name}` : entry.name,
      kind: ('text' in entry ? 'file' : 'directory') as 'file' | 'directory',
    }));
  };

  const primaryEntries = resolveEntries(conversationId);
  if (primaryEntries) {
    return primaryEntries;
  }

  if (fallbackConversationId && fallbackConversationId !== conversationId) {
    const fallbackEntries = resolveEntries(fallbackConversationId);
    if (fallbackEntries) {
      return fallbackEntries;
    }
  }

  throw new Error(`directory not found: ${safePath || '/'}`);
}

function createConversationFileContext(conversationId: string, fallbackConversationId?: string) {
  return {
    conversationId,
    readConversationFile: async (path: string) => {
      const safePath = sanitizePath(path);
      if (!safePath) {
        throw new Error('conversation workspace path must not be empty');
      }
      return readConversationWorkspaceFile(conversationId, safePath, fallbackConversationId);
    },
    listConversationDirectory: async (path: string) => {
      const safePath = sanitizePath(path);
      return listConversationWorkspaceDirectory(conversationId, safePath, fallbackConversationId);
    },
  };
}

async function ensureDir(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}

async function executeReadFile(
  args: { path: string },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'read_file');
  if (pathArg.error) return pathArg.error;

  const dir = getWorkspaceDir(conversationId);
  const safePath = sanitizePath(pathArg.value!);
  if (!safePath) return 'Error: "path" is required for read_file';
  try {
    return await readConversationWorkspaceFile(conversationId, safePath, fallbackConversationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

async function executeWriteFile(
  args: { path: string; content: string },
  conversationId: string,
): Promise<string> {
  const pathArg = requireToolStringArg(args as Record<string, unknown>, 'path', 'write_file', {
    allRequired: ['path', 'content'],
  });
  if (pathArg.error) return pathArg.error;
  const contentArg = requireToolStringArg(
    args as Record<string, unknown>,
    'content',
    'write_file',
    { allowEmpty: true, allRequired: ['path', 'content'] },
  );
  if (contentArg.error) return contentArg.error;

  const dir = getWorkspaceDir(conversationId);
  const safePath = sanitizePath(pathArg.value!);
  if (!safePath) return 'Error: "path" is required for write_file';

  await ensureDir(dir);
  const parentPath = safePath.includes('/') ? safePath.split('/').slice(0, -1).join('/') : '';
  if (parentPath) {
    await ensureDir(new Directory(dir, parentPath));
  }

  const file = new File(dir, safePath);
  file.write(contentArg.value!);
  return `Wrote ${contentArg.value!.length} chars to ${safePath}`;
}

async function executeListFiles(args: { path?: string }, conversationId: string): Promise<string> {
  const dir = getWorkspaceDir(conversationId);
  await ensureDir(dir);

  const pathArg = getOptionalToolStringArg(args as Record<string, unknown>, 'path', 'list_files');
  if (pathArg.error) return pathArg.error;

  const safePath = sanitizePath(pathArg.value || '');
  const targetDir = safePath ? new Directory(dir, safePath) : dir;

  if (!targetDir.exists) {
    return `Error: directory not found: ${safePath || '/'}`;
  }

  const entries = targetDir.list();
  const result: string[] = entries
    .map((entry) => ('text' in entry ? entry.name : `${entry.name}/`))
    .sort();

  return result.length > 0 ? result.join('\n') : '(empty directory)';
}

async function executeFetchUrl(args: {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: string;
}): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return `Error: only http and https URLs are allowed`;
    }

    // SSRF protection — block private/internal addresses
    if (!isAllowedUrl(args.url)) {
      return `Error: URL blocked by security policy (private/internal address)`;
    }

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 30000);
    const normalizedHeaders = Object.fromEntries(
      Object.entries(args.headers || {}).map(([key, value]) => [key, String(value)]),
    );

    const response = await fetch(args.url, {
      method: (args.method || 'GET').toUpperCase(),
      headers: normalizedHeaders,
      body: args.body,
      credentials: 'omit',
      signal: controller.signal,
    });

    const text = await response.text();
    const truncated =
      text.length > MAX_FETCH_SIZE
        ? text.slice(0, MAX_FETCH_SIZE) + '\n\n[Truncated — response exceeded 100KB]'
        : text;

    return `HTTP ${response.status}\n\n${truncated}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error fetching URL: ${message}`;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

type ReadMemoryScope = 'all' | 'conversation' | 'global';
type WriteMemoryScope = 'conversation' | 'global';

function resolveReadMemoryScope(
  args: Record<string, unknown>,
): { value: ReadMemoryScope } | { error: string } {
  const scopeArg = getOptionalToolStringArg(args, 'scope', 'read_memory');
  if (scopeArg.error) {
    return { error: scopeArg.error };
  }

  const normalized = (scopeArg.value || 'all').trim().toLowerCase();
  if (normalized === 'all' || normalized === 'conversation' || normalized === 'global') {
    return { value: normalized };
  }

  return { error: 'Error: "scope" for read_memory must be one of: all, conversation, global' };
}

function resolveWriteMemoryScope(
  args: Record<string, unknown>,
): { value: WriteMemoryScope } | { error: string } {
  const scopeArg = getOptionalToolStringArg(args, 'scope', 'update_memory');
  if (scopeArg.error) {
    return { error: scopeArg.error };
  }

  const normalized = (scopeArg.value || 'conversation').trim().toLowerCase();
  if (normalized === 'conversation' || normalized === 'global') {
    return { value: normalized };
  }

  return { error: 'Error: "scope" for update_memory must be one of: conversation, global' };
}

function formatMemorySection(title: string, content: string | null): string {
  return `## ${title}\n${content || `(${title} is empty)`}`;
}

async function executeUpdateMemory(
  args: Record<string, unknown>,
  conversationMemoryId: string,
): Promise<string> {
  const contentArg = requireToolStringArg(args, 'content', 'update_memory', { allowEmpty: true });
  if (contentArg.error) {
    return contentArg.error;
  }

  const modeValue = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'append';
  if (modeValue !== 'append' && modeValue !== 'replace') {
    return 'Error: "mode" for update_memory must be one of: append, replace';
  }

  const scope = resolveWriteMemoryScope(args);
  if ('error' in scope) {
    return scope.error;
  }

  const content = contentArg.value || '';
  const targetLabel = scope.value === 'conversation' ? 'Conversation memory' : 'Global memory';

  if (scope.value === 'global') {
    if (modeValue === 'replace') {
      writeGlobalMemory(content);
      return `${targetLabel} replaced (${content.length} chars written)`;
    }
    await appendGlobalMemory(content);
    return `${targetLabel} updated (${content.length} chars appended)`;
  }

  if (modeValue === 'replace') {
    writeConversationMemory(conversationMemoryId, content);
    return `${targetLabel} replaced (${content.length} chars written)`;
  }

  await appendConversationMemory(conversationMemoryId, content);
  return `${targetLabel} updated (${content.length} chars appended)`;
}

async function executeReadMemory(
  args: Record<string, unknown>,
  conversationMemoryId: string,
): Promise<string> {
  const scope = resolveReadMemoryScope(args);
  if ('error' in scope) {
    return scope.error;
  }

  const conversationContent =
    scope.value === 'global' ? null : await readConversationMemory(conversationMemoryId);
  const globalContent = scope.value === 'conversation' ? null : await readGlobalMemory();

  if (scope.value === 'conversation') {
    return conversationContent || '(Conversation memory is empty)';
  }

  if (scope.value === 'global') {
    return globalContent || '(Global memory is empty)';
  }

  return [
    formatMemorySection('Conversation Memory', conversationContent),
    formatMemorySection('Global Memory', globalContent),
  ].join('\n\n');
}

type WorkflowEvidenceTarget = {
  conversationId: string;
  runId?: string;
  workerSessionId?: string;
  defaultRecorder: AgentRunEvidenceRecorder;
};

type ResolvedWorkflowEvidenceRun = WorkflowEvidenceTarget & {
  runId: string;
  run: {
    evidence?: AgentRunEvidenceEntry[];
  };
};

function normalizeWorkflowEvidenceText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeWorkflowEvidenceStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? [normalized] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function parseWorkflowEvidenceEnumList<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  label: string,
): { value?: T[] } | { error: string } {
  const normalized = normalizeWorkflowEvidenceStringList(value);
  if (!normalized) {
    return { value: undefined };
  }

  const invalid = normalized.filter((entry) => !allowedValues.includes(entry as T));
  if (invalid.length > 0) {
    return { error: `Error: "${label}" must only contain: ${allowedValues.join(', ')}` };
  }

  return { value: normalized as T[] };
}

function resolveWorkflowEvidenceTarget(
  conversationId: string,
  workspaceConversationId?: string,
): WorkflowEvidenceTarget | { error: string } {
  const subAgent = getSubAgent(conversationId);
  if (subAgent) {
    const parentConversationId = subAgent.parentConversationId?.trim();
    const parentRunId = subAgent.agentRunId?.trim();

    if (!parentConversationId) {
      return {
        error:
          'Error: the current worker session is missing its parent conversation, so workflow evidence is unavailable.',
      };
    }

    if (!parentRunId) {
      return {
        error:
          'Error: the current worker session is not attached to a workflow run, so workflow evidence is unavailable.',
      };
    }

    return {
      conversationId: parentConversationId,
      runId: parentRunId,
      workerSessionId: subAgent.sessionId,
      defaultRecorder: 'worker',
    };
  }

  return {
    conversationId: workspaceConversationId || conversationId,
    defaultRecorder: 'supervisor',
  };
}

function resolveWorkflowEvidenceRun(
  conversationId: string,
  workspaceConversationId?: string,
): ResolvedWorkflowEvidenceRun | { error: string } {
  const target = resolveWorkflowEvidenceTarget(conversationId, workspaceConversationId);
  if ('error' in target) {
    return target;
  }

  const store = useChatStore.getState();
  const conversation = store.conversations.find(
    (candidate) => candidate.id === target.conversationId,
  );
  if (!conversation) {
    return {
      error: `Error: conversation "${target.conversationId}" was not found for workflow evidence.`,
    };
  }

  const runId = target.runId || conversation.activeAgentRunId;
  if (!runId) {
    return {
      error:
        'Error: no active workflow run is available for workflow evidence in this conversation.',
    };
  }

  const run = (conversation.agentRuns ?? []).find((candidate) => candidate.id === runId);
  if (!run) {
    return { error: `Error: workflow run "${runId}" was not found.` };
  }

  return {
    ...target,
    runId,
    run,
  };
}

function buildWorkflowEvidenceDrafts(
  args: Record<string, unknown>,
  target: WorkflowEvidenceTarget,
): { value: AgentRunEvidenceDraft[] } | { error: string } {
  if (!Array.isArray(args.entries) || args.entries.length === 0) {
    return { error: 'Error: "entries" must be a non-empty array for record_workflow_evidence.' };
  }

  const drafts: AgentRunEvidenceDraft[] = [];

  for (let index = 0; index < args.entries.length; index += 1) {
    const rawEntry = args.entries[index];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return { error: `Error: entries[${index}] must be an object.` };
    }

    const entry = rawEntry as Record<string, unknown>;
    const kind = normalizeWorkflowEvidenceText(entry.kind)?.toLowerCase() as
      | AgentRunEvidenceKind
      | undefined;
    if (!kind || !AGENT_RUN_EVIDENCE_KIND_VALUES.includes(kind)) {
      return {
        error: `Error: entries[${index}].kind must be one of: ${AGENT_RUN_EVIDENCE_KIND_VALUES.join(', ')}`,
      };
    }

    const content = normalizeWorkflowEvidenceText(entry.content);
    if (!content) {
      return {
        error: `Error: entries[${index}].content is required for record_workflow_evidence.`,
      };
    }

    const status = normalizeWorkflowEvidenceText(entry.status)?.toLowerCase() as
      | AgentRunEvidenceStatus
      | undefined;
    if (status && !AGENT_RUN_EVIDENCE_STATUS_VALUES.includes(status)) {
      return {
        error: `Error: entries[${index}].status must be one of: ${AGENT_RUN_EVIDENCE_STATUS_VALUES.join(', ')}`,
      };
    }

    const recorder = normalizeWorkflowEvidenceText(entry.recorder)?.toLowerCase() as
      | AgentRunEvidenceRecorder
      | undefined;
    if (recorder && !AGENT_RUN_EVIDENCE_RECORDER_VALUES.includes(recorder)) {
      return {
        error: `Error: entries[${index}].recorder must be one of: ${AGENT_RUN_EVIDENCE_RECORDER_VALUES.join(', ')}`,
      };
    }

    const artifactWorkspacePathRaw = normalizeWorkflowEvidenceText(entry.artifactWorkspacePath);
    const artifactWorkspacePath = artifactWorkspacePathRaw
      ? sanitizeWorkspaceRelativePath(artifactWorkspacePathRaw)
      : undefined;

    if (artifactWorkspacePathRaw && !artifactWorkspacePath) {
      return {
        error: `Error: entries[${index}].artifactWorkspacePath must be a valid workspace-relative path.`,
      };
    }

    drafts.push({
      kind,
      content,
      ...(status ? { status } : {}),
      recorder: recorder ?? target.defaultRecorder,
      ...(normalizeWorkflowEvidenceText(entry.id)
        ? { id: normalizeWorkflowEvidenceText(entry.id) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.title)
        ? { title: normalizeWorkflowEvidenceText(entry.title) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.dedupeKey)
        ? { dedupeKey: normalizeWorkflowEvidenceText(entry.dedupeKey) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.sourceName)
        ? { sourceName: normalizeWorkflowEvidenceText(entry.sourceName) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.sourceUri)
        ? { sourceUri: normalizeWorkflowEvidenceText(entry.sourceUri) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.toolName)
        ? { toolName: normalizeWorkflowEvidenceText(entry.toolName) }
        : {}),
      ...(normalizeWorkflowEvidenceText(entry.workerSessionId) || target.workerSessionId
        ? {
            workerSessionId:
              normalizeWorkflowEvidenceText(entry.workerSessionId) || target.workerSessionId,
          }
        : {}),
      ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
      ...(normalizeWorkflowEvidenceStringList(entry.tags)
        ? { tags: normalizeWorkflowEvidenceStringList(entry.tags) }
        : {}),
    });
  }

  return { value: drafts };
}

function buildWorkflowEvidenceFilter(
  args: Record<string, unknown>,
): { value: AgentRunEvidenceFilter } | { error: string } {
  const kinds = parseWorkflowEvidenceEnumList(
    args.kinds ?? args.kind,
    AGENT_RUN_EVIDENCE_KIND_VALUES,
    'kinds',
  );
  if ('error' in kinds) {
    return kinds;
  }

  const statuses = parseWorkflowEvidenceEnumList(
    args.statuses ?? args.status,
    AGENT_RUN_EVIDENCE_STATUS_VALUES,
    'statuses',
  );
  if ('error' in statuses) {
    return statuses;
  }

  const recorders = parseWorkflowEvidenceEnumList(
    args.recorders ?? args.recorder,
    AGENT_RUN_EVIDENCE_RECORDER_VALUES,
    'recorders',
  );
  if ('error' in recorders) {
    return recorders;
  }

  const queryArg = getOptionalToolStringArg(args, 'query', 'read_workflow_evidence');
  if (queryArg.error) {
    return { error: queryArg.error };
  }

  if (args.limit !== undefined && (!Number.isFinite(args.limit) || Number(args.limit) <= 0)) {
    return { error: 'Error: "limit" for read_workflow_evidence must be a positive number.' };
  }

  if (args.includeContent !== undefined && typeof args.includeContent !== 'boolean') {
    return { error: 'Error: "includeContent" for read_workflow_evidence must be true or false.' };
  }

  const limit =
    args.limit !== undefined
      ? Math.min(MAX_WORKFLOW_EVIDENCE_READ_LIMIT, Math.max(1, Math.trunc(Number(args.limit))))
      : 12;

  return {
    value: {
      ...(kinds.value ? { kinds: kinds.value } : {}),
      ...(statuses.value ? { statuses: statuses.value } : {}),
      ...(recorders.value ? { recorders: recorders.value } : {}),
      ...(queryArg.value ? { query: queryArg.value } : {}),
      limit,
      includeContent: args.includeContent !== false,
    },
  };
}

function summarizeWorkflowEvidenceEntries(entries: ReadonlyArray<AgentRunEvidenceEntry>): {
  totalEntries: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  byRecorder: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byRecorder: Record<string, number> = {};

  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    byRecorder[entry.recorder] = (byRecorder[entry.recorder] || 0) + 1;
  }

  return {
    totalEntries: entries.length,
    byKind,
    byStatus,
    byRecorder,
  };
}

function serializeWorkflowEvidenceEntry(
  entry: AgentRunEvidenceEntry,
  includeContent: boolean,
): Record<string, unknown> {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    recorder: entry.recorder,
    title: entry.title,
    ...(includeContent ? { content: entry.content } : {}),
    ...(entry.dedupeKey ? { dedupeKey: entry.dedupeKey } : {}),
    ...(entry.sourceName ? { sourceName: entry.sourceName } : {}),
    ...(entry.sourceUri ? { sourceUri: entry.sourceUri } : {}),
    ...(entry.toolName ? { toolName: entry.toolName } : {}),
    ...(entry.workerSessionId ? { workerSessionId: entry.workerSessionId } : {}),
    ...(entry.artifactWorkspacePath ? { artifactWorkspacePath: entry.artifactWorkspacePath } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function resolveOptionalWorkflowEvidenceRun(
  conversationId: string,
  workspaceConversationId?: string,
): ResolvedWorkflowEvidenceRun | undefined {
  const resolvedRun = resolveWorkflowEvidenceRun(conversationId, workspaceConversationId);
  return 'error' in resolvedRun ? undefined : resolvedRun;
}

function buildWorkflowEvidenceDraftFromRecord(
  entry: Record<string, unknown>,
  target: WorkflowEvidenceTarget,
  defaultRecorder: AgentRunEvidenceRecorder,
): AgentRunEvidenceDraft | undefined {
  const kind = normalizeWorkflowEvidenceText(entry.kind)?.toLowerCase() as
    | AgentRunEvidenceKind
    | undefined;
  const content = normalizeWorkflowEvidenceText(entry.content);
  if (!kind || !content || !AGENT_RUN_EVIDENCE_KIND_VALUES.includes(kind)) {
    return undefined;
  }

  const statusText = normalizeWorkflowEvidenceText(entry.status)?.toLowerCase() as
    | AgentRunEvidenceStatus
    | undefined;
  const status =
    statusText && AGENT_RUN_EVIDENCE_STATUS_VALUES.includes(statusText) ? statusText : undefined;
  const recorderText = normalizeWorkflowEvidenceText(entry.recorder)?.toLowerCase() as
    | AgentRunEvidenceRecorder
    | undefined;
  const recorder =
    recorderText && AGENT_RUN_EVIDENCE_RECORDER_VALUES.includes(recorderText)
      ? recorderText
      : undefined;
  const artifactWorkspacePathRaw = normalizeWorkflowEvidenceText(entry.artifactWorkspacePath);
  const artifactWorkspacePath = artifactWorkspacePathRaw
    ? sanitizeWorkspaceRelativePath(artifactWorkspacePathRaw)
    : undefined;

  return {
    kind,
    content,
    ...(status ? { status } : {}),
    recorder: recorder ?? defaultRecorder,
    ...(normalizeWorkflowEvidenceText(entry.id)
      ? { id: normalizeWorkflowEvidenceText(entry.id) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.title)
      ? { title: normalizeWorkflowEvidenceText(entry.title) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.dedupeKey)
      ? { dedupeKey: normalizeWorkflowEvidenceText(entry.dedupeKey) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.sourceName)
      ? { sourceName: normalizeWorkflowEvidenceText(entry.sourceName) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.sourceUri)
      ? { sourceUri: normalizeWorkflowEvidenceText(entry.sourceUri) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.toolName)
      ? { toolName: normalizeWorkflowEvidenceText(entry.toolName) }
      : {}),
    ...(normalizeWorkflowEvidenceText(entry.workerSessionId) || target.workerSessionId
      ? {
          workerSessionId:
            normalizeWorkflowEvidenceText(entry.workerSessionId) || target.workerSessionId,
        }
      : {}),
    ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
    ...(normalizeWorkflowEvidenceStringList(entry.tags)
      ? { tags: normalizeWorkflowEvidenceStringList(entry.tags) }
      : {}),
  };
}

function buildPythonWorkflowBridgeState(
  resolvedRun: ResolvedWorkflowEvidenceRun | undefined,
): PythonWorkflowBridgeState | undefined {
  if (!resolvedRun) {
    return undefined;
  }

  return {
    evidence: filterAgentRunEvidenceEntries(resolvedRun.run.evidence, {
      limit: MAX_PYTHON_WORKFLOW_BRIDGE_ENTRIES,
      includeContent: true,
    }).map((entry) =>
      serializeWorkflowEvidenceEntry(entry, true),
    ) as unknown as PythonWorkflowBridgeState['evidence'],
  };
}

function buildPythonWorkflowBridgeDrafts(
  result: PythonExecutionResult,
  target: WorkflowEvidenceTarget,
): AgentRunEvidenceDraft[] {
  const emittedEntries = result.workflowBridge?.emittedEvidence;
  if (!Array.isArray(emittedEntries) || emittedEntries.length === 0) {
    return [];
  }

  return emittedEntries
    .map((entry) =>
      buildWorkflowEvidenceDraftFromRecord(
        entry as unknown as Record<string, unknown>,
        target,
        'python',
      ),
    )
    .filter((draft): draft is AgentRunEvidenceDraft => Boolean(draft));
}

function recordAutomaticPythonWorkflowEvidence(
  resolvedRun: ResolvedWorkflowEvidenceRun,
  result: PythonExecutionResult,
): number {
  const pythonBridgeDrafts = buildPythonWorkflowBridgeDrafts(result, resolvedRun);
  const automaticDrafts = buildAutomaticPythonEvidenceEntries({
    success: result.success,
    output: result.output,
    error: result.error,
    files: result.files,
    emittedEvidenceCount: pythonBridgeDrafts.length,
    workerSessionId: resolvedRun.workerSessionId,
  });
  const drafts = [...pythonBridgeDrafts, ...automaticDrafts];

  if (drafts.length === 0) {
    return 0;
  }

  const recordedEntries = useChatStore
    .getState()
    .recordAgentRunEvidence(
      resolvedRun.conversationId,
      drafts,
      { timestamp: Date.now() },
      resolvedRun.runId,
    );

  return recordedEntries ? drafts.length : 0;
}

async function executeRecordWorkflowEvidence(
  args: Record<string, unknown>,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const resolvedRun = resolveWorkflowEvidenceRun(conversationId, context?.workspaceConversationId);
  if ('error' in resolvedRun) {
    return resolvedRun.error;
  }

  const drafts = buildWorkflowEvidenceDrafts(args, resolvedRun);
  if ('error' in drafts) {
    return drafts.error;
  }

  const timestamp = Date.now();
  const storedEntries = useChatStore
    .getState()
    .recordAgentRunEvidence(
      resolvedRun.conversationId,
      drafts.value,
      { timestamp },
      resolvedRun.runId,
    );

  if (!storedEntries) {
    return `Error: unable to record workflow evidence for run "${resolvedRun.runId}".`;
  }

  const latestEntries = filterAgentRunEvidenceEntries(storedEntries, {
    limit: Math.min(MAX_WORKFLOW_EVIDENCE_READ_LIMIT, drafts.value.length),
  });

  return JSON.stringify(
    {
      status: 'ok',
      conversationId: resolvedRun.conversationId,
      runId: resolvedRun.runId,
      ...(resolvedRun.workerSessionId ? { workerSessionId: resolvedRun.workerSessionId } : {}),
      recorded: drafts.value.length,
      ...summarizeWorkflowEvidenceEntries(storedEntries),
      latestEntries: latestEntries.map((entry) => serializeWorkflowEvidenceEntry(entry, true)),
    },
    null,
    2,
  );
}

async function executeReadWorkflowEvidence(
  args: Record<string, unknown>,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const resolvedRun = resolveWorkflowEvidenceRun(conversationId, context?.workspaceConversationId);
  if ('error' in resolvedRun) {
    return resolvedRun.error;
  }

  const filter = buildWorkflowEvidenceFilter(args);
  if ('error' in filter) {
    return filter.error;
  }

  const includeContent = filter.value.includeContent !== false;
  const entries = filterAgentRunEvidenceEntries(resolvedRun.run.evidence, filter.value);
  const allEntries = resolvedRun.run.evidence ?? [];

  return JSON.stringify(
    {
      status: 'ok',
      conversationId: resolvedRun.conversationId,
      runId: resolvedRun.runId,
      ...(resolvedRun.workerSessionId ? { workerSessionId: resolvedRun.workerSessionId } : {}),
      ...summarizeWorkflowEvidenceEntries(allEntries),
      returnedEntries: entries.length,
      filter: {
        ...(filter.value.kinds ? { kinds: filter.value.kinds } : {}),
        ...(filter.value.statuses ? { statuses: filter.value.statuses } : {}),
        ...(filter.value.recorders ? { recorders: filter.value.recorders } : {}),
        ...(filter.value.query ? { query: filter.value.query } : {}),
        limit: filter.value.limit,
        includeContent,
      },
      entries: entries.map((entry) => serializeWorkflowEvidenceEntry(entry, includeContent)),
    },
    null,
    2,
  );
}

type WorkspaceSnapshotUsage = {
  fileCount: number;
  totalBytes: number;
};

type WorkspaceSnapshotLimits = {
  maxFiles: number;
  maxBytes: number;
  label: string;
};

const WORKSPACE_TEXT_DECODER = new TextDecoder();

async function readConversationWorkspaceBytes(
  conversationId: string,
  safePath: string,
): Promise<Uint8Array> {
  const file = new File(getWorkspaceDir(conversationId), safePath);

  if (!file.exists) {
    throw new Error(`file not found: ${safePath}`);
  }

  const candidate = file as File & {
    bytes?: () => Promise<Uint8Array | ArrayBuffer>;
  };

  if (typeof candidate.bytes === 'function') {
    const bytes = await candidate.bytes();
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  return new TextEncoder().encode(await file.text());
}

function getParentWorkspacePath(safePath: string): string {
  const parts = safePath.split('/');
  parts.pop();
  return parts.join('/');
}

async function addWorkspaceSnapshotFile(
  conversationId: string,
  safePath: string,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  if (!safePath || snapshotFiles.has(safePath)) {
    return;
  }

  if (usage.fileCount >= limits.maxFiles) {
    throw new Error(`${limits.label} exceeded ${limits.maxFiles} files.`);
  }

  const bytes = await readConversationWorkspaceBytes(conversationId, safePath);
  if (usage.totalBytes + bytes.length > limits.maxBytes) {
    throw new Error(`${limits.label} exceeded ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.`);
  }

  snapshotFiles.set(safePath, bytes);
  usage.fileCount += 1;
  usage.totalBytes += bytes.length;
}

async function collectWorkspaceSnapshotDirectory(
  conversationId: string,
  relativeDirPath: string,
  directory: Directory,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  const entries = directory.list();
  for (const entry of entries) {
    const childPath = relativeDirPath ? `${relativeDirPath}/${entry.name}` : entry.name;
    if ('list' in entry) {
      await collectWorkspaceSnapshotDirectory(
        conversationId,
        childPath,
        entry as Directory,
        snapshotFiles,
        usage,
        limits,
      );
      continue;
    }

    await addWorkspaceSnapshotFile(conversationId, childPath, snapshotFiles, usage, limits);
  }
}

async function collectConversationWorkspaceSnapshot(
  conversationId: string,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  const workspaceDir = getWorkspaceDir(conversationId);
  if (!workspaceDir.exists) {
    return;
  }

  await collectWorkspaceSnapshotDirectory(
    conversationId,
    '',
    workspaceDir,
    snapshotFiles,
    usage,
    limits,
  );
}

async function collectWorkspaceSnapshotWithFallback(
  conversationId: string,
  fallbackConversationId: string | undefined,
  snapshotFiles: Map<string, Uint8Array>,
  usage: WorkspaceSnapshotUsage,
  limits: WorkspaceSnapshotLimits,
): Promise<void> {
  await collectConversationWorkspaceSnapshot(conversationId, snapshotFiles, usage, limits);

  if (fallbackConversationId && fallbackConversationId !== conversationId) {
    await collectConversationWorkspaceSnapshot(
      fallbackConversationId,
      snapshotFiles,
      usage,
      limits,
    );
  }
}

function buildPythonWorkspaceFiles(snapshotFiles: Map<string, Uint8Array>): PythonWorkspaceFile[] {
  return Array.from(snapshotFiles.entries())
    .map(([path, bytes]) => ({ path, contentBase64: encodeBytesToBase64(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildJavaScriptWorkspaceFiles(
  snapshotFiles: Map<string, Uint8Array>,
): Array<{ path: string; content: string }> {
  return Array.from(snapshotFiles.entries())
    .map(([path, bytes]) => ({ path, content: WORKSPACE_TEXT_DECODER.decode(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function preparePythonWorkspaceExecution(
  conversationId: string,
  safePath?: string,
  fallbackConversationId?: string,
): Promise<{ files: PythonWorkspaceFile[]; packages: string[] }> {
  const snapshotFiles = new Map<string, Uint8Array>();
  const usage = { fileCount: 0, totalBytes: 0 };

  await collectWorkspaceSnapshotWithFallback(
    conversationId,
    fallbackConversationId,
    snapshotFiles,
    usage,
    {
      maxFiles: PYTHON_WORKSPACE_MAX_FILES,
      maxBytes: PYTHON_WORKSPACE_MAX_BYTES,
      label: 'Python workspace snapshot',
    },
  );

  const scriptSource = safePath
    ? await readConversationWorkspaceFile(conversationId, safePath, fallbackConversationId)
    : '';
  return {
    files: buildPythonWorkspaceFiles(snapshotFiles),
    packages: scriptSource ? extractPep723Dependencies(scriptSource) : [],
  };
}

async function prepareJavaScriptWorkspaceExecution(
  conversationId: string,
  fallbackConversationId?: string,
): Promise<Array<{ path: string; content: string }>> {
  const snapshotFiles = new Map<string, Uint8Array>();
  const usage = { fileCount: 0, totalBytes: 0 };

  await collectWorkspaceSnapshotWithFallback(
    conversationId,
    fallbackConversationId,
    snapshotFiles,
    usage,
    {
      maxFiles: JAVASCRIPT_WORKSPACE_MAX_FILES,
      maxBytes: JAVASCRIPT_WORKSPACE_MAX_BYTES,
      label: 'JavaScript workspace snapshot',
    },
  );

  return buildJavaScriptWorkspaceFiles(snapshotFiles);
}

function diffJavaScriptWorkspaceFiles(
  initialFiles: Map<string, string>,
  nextFiles: Map<string, string>,
): {
  changedFiles: Array<{ path: string; content: string }>;
  deletedPaths: string[];
} {
  const changedFiles: Array<{ path: string; content: string }> = [];
  for (const [path, content] of nextFiles.entries()) {
    if (initialFiles.get(path) !== content) {
      changedFiles.push({ path, content });
    }
  }

  const deletedPaths = Array.from(initialFiles.keys())
    .filter((path) => !nextFiles.has(path))
    .sort((left, right) => left.localeCompare(right));

  changedFiles.sort((left, right) => left.path.localeCompare(right.path));
  return { changedFiles, deletedPaths };
}

async function persistJavaScriptWorkspaceChanges(
  conversationId: string,
  changedFiles: Array<{ path: string; content: string }>,
  deletedPaths: string[],
): Promise<void> {
  if (changedFiles.length === 0 && deletedPaths.length === 0) {
    return;
  }

  const workspaceDir = getWorkspaceDir(conversationId);
  await ensureDir(workspaceDir);

  for (const path of deletedPaths) {
    const safePath = sanitizePath(path);
    if (!safePath) {
      throw new Error('JavaScript returned an invalid workspace file path.');
    }

    const file = new File(workspaceDir, safePath);
    if (file.exists) {
      file.delete();
    }
  }

  for (const file of changedFiles) {
    const safePath = sanitizePath(file.path);
    if (!safePath) {
      throw new Error('JavaScript returned an invalid workspace file path.');
    }

    const parentPath = getParentWorkspacePath(safePath);
    if (parentPath) {
      await ensureDir(new Directory(workspaceDir, parentPath));
    }

    new File(workspaceDir, safePath).write(file.content);
  }
}

async function persistPythonWorkspaceFiles(
  conversationId: string,
  files: PythonWorkspaceFile[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const workspaceDir = getWorkspaceDir(conversationId);
  await ensureDir(workspaceDir);

  for (const file of files) {
    const safePath = sanitizePath(file.path);
    if (!safePath) {
      throw new Error('Python returned an invalid workspace file path.');
    }

    const parentPath = getParentWorkspacePath(safePath);
    if (parentPath) {
      await ensureDir(new Directory(workspaceDir, parentPath));
    }

    new File(workspaceDir, safePath).write(decodeBase64ToBytes(file.contentBase64));
  }
}

function normalizeJavaScriptArgv(value: unknown): { argv?: string[]; error?: string } {
  if (value == null) {
    return { argv: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "argv" for javascript must be an array of strings when provided' };
  }

  const argv: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "argv" for javascript must be an array of strings when provided' };
    }
    argv.push(entry);
  }

  return { argv };
}

function normalizeJavaScriptEnv(value: unknown): { env?: Record<string, string>; error?: string } {
  if (value == null) {
    return { env: undefined };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: 'Error: "env" for javascript must be an object of string values when provided',
    };
  }

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return {
        error: 'Error: "env" for javascript must be an object of string values when provided',
      };
    }
    env[key] = entry;
  }

  return { env };
}

async function executeJavascript(
  args: {
    code?: string;
    path?: string;
    scriptPath?: string;
    argv?: string[];
    env?: Record<string, string>;
  },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  try {
    const rawArgs = args as Record<string, unknown>;
    const codeArg = getOptionalToolStringArg(rawArgs, 'code', 'javascript');
    if (codeArg.error) {
      return codeArg.error;
    }

    const pathArg = getOptionalToolStringArg(rawArgs, 'path', 'javascript');
    if (pathArg.error) {
      return pathArg.error;
    }

    const scriptPathArg =
      pathArg.value == null
        ? getOptionalToolStringArg(rawArgs, 'scriptPath', 'javascript')
        : { value: undefined as string | undefined };
    if (scriptPathArg.error) {
      return scriptPathArg.error;
    }

    const argvArg = normalizeJavaScriptArgv(rawArgs.argv);
    if (argvArg.error) {
      return argvArg.error;
    }

    const envArg = normalizeJavaScriptEnv(rawArgs.env);
    if (envArg.error) {
      return envArg.error;
    }

    const selectedPath = pathArg.value ?? scriptPathArg.value;
    if (!codeArg.value && !selectedPath) {
      return 'Error: javascript requires either "code" or "path".';
    }

    if (codeArg.value && selectedPath) {
      return 'Error: javascript accepts either "code" or "path", not both.';
    }

    const safePath = selectedPath ? sanitizePath(selectedPath) : undefined;
    if (selectedPath && !safePath) {
      return 'Error: "path" is required for javascript and must not be empty.';
    }

    const workspaceFiles = await prepareJavaScriptWorkspaceExecution(
      conversationId,
      fallbackConversationId,
    );
    const initialCache = buildFileCache(workspaceFiles);
    const nextCache = new Map(initialCache);
    const execution = executeWorkspaceJavaScript({
      ...(safePath ? { path: safePath } : { code: codeArg.value! }),
      fileCache: nextCache,
      workingDirectory: '',
      argv: argvArg.argv,
      env: envArg.env,
    });

    const output =
      execution.result !== undefined
        ? formatJavaScriptResult(execution.result)
        : '(no return value)';

    if (execution.hadError) {
      return output;
    }

    const { changedFiles, deletedPaths } = diffJavaScriptWorkspaceFiles(
      initialCache,
      execution.fileCache,
    );
    if (changedFiles.length > 0 || deletedPaths.length > 0) {
      await persistJavaScriptWorkspaceChanges(conversationId, changedFiles, deletedPaths);
    }

    return normalizeJavaScriptToolResult({
      output,
      files: changedFiles,
      deletedPaths,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

function normalizePythonPackages(value: unknown): { packages?: string[]; error?: string } {
  if (value == null) {
    return { packages: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "packages" for python must be an array of strings when provided' };
  }

  const packages: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "packages" for python must be an array of strings when provided' };
    }

    const normalized = entry.trim();
    if (normalized) {
      packages.push(normalized);
    }
  }

  return { packages: Array.from(new Set(packages)) };
}

function normalizePythonIndexUrls(value: unknown): { indexUrls?: string[]; error?: string } {
  if (value == null) {
    return { indexUrls: undefined };
  }

  if (!Array.isArray(value)) {
    return {
      error: 'Error: "indexUrls" for python must be an array of HTTP(S) URLs when provided',
    };
  }

  const indexUrls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return {
        error: 'Error: "indexUrls" for python must be an array of HTTP(S) URLs when provided',
      };
    }

    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }

    if (!PYTHON_HTTP_URL_PATTERN.test(normalized)) {
      return { error: 'Error: "indexUrls" for python must contain only HTTP(S) URLs' };
    }

    indexUrls.push(normalized);
  }

  return { indexUrls: Array.from(new Set(indexUrls)) };
}

function normalizePythonArgv(value: unknown): { argv?: string[]; error?: string } {
  if (value == null) {
    return { argv: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "argv" for python must be an array of strings when provided' };
  }

  const argv: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "argv" for python must be an array of strings when provided' };
    }
    argv.push(entry);
  }

  return { argv };
}

function normalizePythonEnv(value: unknown): { env?: Record<string, string>; error?: string } {
  if (value == null) {
    return { env: undefined };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Error: "env" for python must be an object of string values when provided' };
  }

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "env" for python must be an object of string values when provided' };
    }
    env[key] = entry;
  }

  return { env };
}

function normalizePythonTimeoutMs(value: unknown): { timeoutMs?: number; error?: string } {
  if (value == null) {
    return { timeoutMs: undefined };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: 'Error: "timeoutMs" for python must be a finite number when provided' };
  }

  const normalized = Math.trunc(value);
  if (normalized < 1000 || normalized > MAX_PYTHON_TOOL_TIMEOUT_MS) {
    return {
      error: `Error: "timeoutMs" for python must be between 1000 and ${MAX_PYTHON_TOOL_TIMEOUT_MS} milliseconds`,
    };
  }

  return { timeoutMs: normalized };
}

async function executePythonTool(
  args: {
    code?: string;
    path?: string;
    scriptPath?: string;
    packages?: string[];
    indexUrls?: string[];
    argv?: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  },
  conversationId: string,
  workspaceConversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  try {
    const rawArgs = args as Record<string, unknown>;
    const codeArg = getOptionalToolStringArg(rawArgs, 'code', 'python');
    if (codeArg.error) {
      return codeArg.error;
    }

    const pathArg = getOptionalToolStringArg(rawArgs, 'path', 'python');
    if (pathArg.error) {
      return pathArg.error;
    }

    const scriptPathArg =
      pathArg.value == null
        ? getOptionalToolStringArg(rawArgs, 'scriptPath', 'python')
        : { value: undefined as string | undefined };
    if (scriptPathArg.error) {
      return scriptPathArg.error;
    }

    const selectedPath = pathArg.value ?? scriptPathArg.value;
    if (!codeArg.value && !selectedPath) {
      return 'Error: python requires either "code" or "path".';
    }

    if (codeArg.value && selectedPath) {
      return 'Error: python accepts either "code" or "path", not both.';
    }

    const packagesArg = normalizePythonPackages(rawArgs?.packages);
    if (packagesArg.error) {
      return packagesArg.error;
    }

    const indexUrlsArg = normalizePythonIndexUrls(rawArgs?.indexUrls);
    if (indexUrlsArg.error) {
      return indexUrlsArg.error;
    }

    const argvArg = normalizePythonArgv(rawArgs?.argv);
    if (argvArg.error) {
      return argvArg.error;
    }

    const envArg = normalizePythonEnv(rawArgs?.env);
    if (envArg.error) {
      return envArg.error;
    }

    const timeoutArg = normalizePythonTimeoutMs(rawArgs?.timeoutMs);
    if (timeoutArg.error) {
      return timeoutArg.error;
    }

    if (codeArg.value && argvArg.argv?.length) {
      return 'Error: "argv" for python can only be used with "path".';
    }

    const resolvedWorkflowEvidenceRun = resolveOptionalWorkflowEvidenceRun(
      conversationId,
      context?.workspaceConversationId,
    );
    const workflowBridge = buildPythonWorkflowBridgeState(resolvedWorkflowEvidenceRun);

    let result;
    if (selectedPath) {
      const safePath = sanitizePath(selectedPath);
      if (!safePath) {
        return 'Error: "path" is required for python and must not be empty.';
      }

      const prepared = await preparePythonWorkspaceExecution(
        workspaceConversationId,
        safePath,
        context?.workspaceReadFallbackConversationId,
      );
      result = await executePython({
        scriptPath: safePath,
        argv: argvArg.argv,
        files: prepared.files,
        workingDirectory: '',
        packages: Array.from(new Set([...(packagesArg.packages || []), ...prepared.packages])),
        ...(indexUrlsArg.indexUrls ? { indexUrls: indexUrlsArg.indexUrls } : {}),
        env: envArg.env,
        ...(timeoutArg.timeoutMs != null ? { timeoutMs: timeoutArg.timeoutMs } : {}),
        ...(workflowBridge ? { workflowBridge } : {}),
      });
    } else {
      const prepared = await preparePythonWorkspaceExecution(
        workspaceConversationId,
        undefined,
        context?.workspaceReadFallbackConversationId,
      );
      result = await executePython({
        code: codeArg.value!,
        files: prepared.files,
        workingDirectory: '',
        packages: Array.from(new Set([...(packagesArg.packages || []), ...prepared.packages])),
        ...(indexUrlsArg.indexUrls ? { indexUrls: indexUrlsArg.indexUrls } : {}),
        env: envArg.env,
        ...(timeoutArg.timeoutMs != null ? { timeoutMs: timeoutArg.timeoutMs } : {}),
        ...(workflowBridge ? { workflowBridge } : {}),
      });
    }

    if (result.files?.length) {
      await persistPythonWorkspaceFiles(workspaceConversationId, result.files);
    }

    const workflowEvidenceCount = resolvedWorkflowEvidenceRun
      ? recordAutomaticPythonWorkflowEvidence(resolvedWorkflowEvidenceRun, result)
      : 0;

    const normalizedResult = normalizePythonToolResult({
      ...result,
      workflowEvidenceCount,
    });
    if (!result.success) {
      return `Error: ${normalizedResult}`;
    }

    return normalizedResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

async function executeCreateTask(args: { schedule: string; prompt: string }): Promise<string> {
  const id = useSchedulerStore.getState().addJob({
    name: args.prompt.slice(0, 60),
    schedule: { kind: 'cron', expr: args.schedule },
    prompt: args.prompt,
  });
  return JSON.stringify({
    status: 'task_created',
    id,
    schedule: args.schedule,
    prompt: args.prompt,
  });
}

async function executeImageGenerate(
  args: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    style?: 'vivid' | 'natural';
  },
  conversationId: string,
): Promise<string> {
  const settings = useSettingsStore.getState();
  const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
  if (!provider) {
    return JSON.stringify({
      status: 'error',
      message: 'No enabled provider configured for image generation.',
    });
  }

  const apiKey = await resolveProviderApiKey(provider);
  if (providerRequiresApiKey(provider) && !apiKey) {
    return JSON.stringify({
      status: 'error',
      message: `Missing API key for provider ${provider.name}.`,
    });
  }

  try {
    const result = await generateImage({ ...provider, apiKey }, { ...args, conversationId });
    return JSON.stringify(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', message });
  }
}

function normalizeImageEditInputPaths(args: Record<string, unknown>): string[] {
  const rawPaths: string[] = [];

  if (typeof args.imagePath === 'string' && args.imagePath.trim()) {
    rawPaths.push(args.imagePath.trim());
  } else if (typeof args.imagePath !== 'undefined' && args.imagePath !== null) {
    throw new Error('imagePath must be a string');
  }

  if (typeof args.imagePaths !== 'undefined') {
    if (!Array.isArray(args.imagePaths)) {
      throw new Error('imagePaths must be an array of strings');
    }

    for (let index = 0; index < args.imagePaths.length; index += 1) {
      const candidate = args.imagePaths[index];
      if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new Error(`imagePaths[${index}] must be a non-empty string`);
      }
      rawPaths.push(candidate.trim());
    }
  }

  return Array.from(new Set(rawPaths));
}

function buildWorkspaceImageEditSource(
  path: string,
  conversationId: string,
): {
  uri: string;
  name: string;
} {
  const safePath = sanitizePath(path);
  if (!safePath) {
    throw new Error(`Invalid workspace image path: ${path}`);
  }

  const file = new File(getWorkspaceDir(conversationId), safePath);
  return {
    uri: file.uri,
    name: safePath.split('/').pop() || safePath,
  };
}

async function executeImageEdit(
  args: {
    prompt?: string;
    imagePath?: string;
    imagePaths?: string[];
    maskPath?: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    inputFidelity?: 'high' | 'low';
    moderation?: 'auto' | 'low';
    outputCompression?: number;
  },
  conversationId: string,
): Promise<string> {
  const settings = useSettingsStore.getState();
  const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
  if (!provider) {
    return JSON.stringify({
      status: 'error',
      message: 'No enabled provider configured for image editing.',
    });
  }

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return JSON.stringify({ status: 'error', message: 'image_edit requires a non-empty prompt.' });
  }

  const apiKey = await resolveProviderApiKey(provider);
  if (providerRequiresApiKey(provider) && !apiKey) {
    return JSON.stringify({
      status: 'error',
      message: `Missing API key for provider ${provider.name}.`,
    });
  }

  try {
    const imagePaths = normalizeImageEditInputPaths(args as Record<string, unknown>);
    if (imagePaths.length === 0) {
      return JSON.stringify({
        status: 'error',
        message: 'image_edit requires imagePath or imagePaths.',
      });
    }

    const images = imagePaths.map((path) => buildWorkspaceImageEditSource(path, conversationId));
    const mask =
      typeof args.maskPath === 'string' && args.maskPath.trim()
        ? buildWorkspaceImageEditSource(args.maskPath.trim(), conversationId)
        : undefined;

    const result = await editImage(
      { ...provider, apiKey },
      {
        prompt,
        images,
        ...(mask ? { mask } : {}),
        model: args.model,
        size: args.size,
        quality: args.quality,
        format: args.format,
        background: args.background,
        inputFidelity: args.inputFidelity,
        moderation: args.moderation,
        outputCompression: args.outputCompression,
        conversationId,
      },
    );
    return JSON.stringify(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', message });
  }
}

// ── Central dispatcher ───────────────────────────────────────────────────

export async function executeTool(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const normalizedName = normalizeToolName(name);

  // Permission check
  const permissions = useToolPermissionsStore.getState();
  if (!permissions.isAllowed(normalizedName)) {
    logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
    return `Error: tool "${normalizedName}" is not allowed by your permission settings`;
  }

  let parsedArgs: any;
  try {
    parsedArgs = argsString ? JSON.parse(argsString) : {};
  } catch {
    parsedArgs = {};
  }

  // Approval gate — blocks destructive/sensitive tools until human approves
  if (needsApprovalWithContext(normalizedName, parsedArgs)) {
    const truncatedArgs = argsString.length > 200 ? argsString.slice(0, 200) + '…' : argsString;
    const decision = await requestToolApproval({
      toolName: normalizedName,
      targetId: parsedArgs?.targetId,
      args: parsedArgs,
      description: `Execute ${normalizedName}(${truncatedArgs})`,
    });
    if (decision !== 'approved') {
      logToolCall(normalizedName, argsString, 'denied', 0, conversationId);
      return `Error: tool "${normalizedName}" was ${decision} by user approval`;
    }
  }

  const startTime = Date.now();
  let result: string;
  try {
    result = await executeToolInner(normalizedName, argsString, conversationId, context);
    logToolCall(normalizedName, argsString, 'success', Date.now() - startTime, conversationId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logToolCall(
      normalizedName,
      argsString,
      'error',
      Date.now() - startTime,
      conversationId,
      message,
    );
    return `Error: ${message}`;
  }
  return result;
}

// ── Tool name normalization ───────────────────────────────────────────────
export { normalizeToolName };

async function executeToolInner(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  // ── Tool name normalization ────────────────────────────────────────
  // Handle common model mistakes: wrong casing, aliases, prefixes
  name = normalizeToolName(name);

  let args: any;
  try {
    args = argsString ? JSON.parse(argsString) : {};
  } catch {
    const preview = argsString.length > 300 ? argsString.slice(0, 300) + '…' : argsString;
    return `Error: tool "${name}" received malformed JSON arguments that could not be parsed. Raw input: ${preview}\nPlease retry the tool call with valid JSON arguments.`;
  }

  const workspaceConversationId = context?.workspaceConversationId || conversationId;
  const workspaceReadFallbackConversationId = context?.workspaceReadFallbackConversationId;
  const conversationFileContext = createConversationFileContext(
    workspaceConversationId,
    workspaceReadFallbackConversationId,
  );

  // ── MCP tools (mcp__serverId__toolName) ────────────────────────────
  if (parseMcpToolName(name)) {
    return executeMcpTool(mcpManager.getClients(), name, argsString, {
      isToolAllowed:
        typeof (mcpManager as { isToolAllowed?: (serverId: string, toolName: string) => boolean })
          .isToolAllowed === 'function'
          ? (serverId, toolName) => mcpManager.isToolAllowed(serverId, toolName)
          : undefined,
    });
  }

  // ── Skill tools (skill__skillId__toolName) ─────────────────────────
  if (parseSkillToolName(name)) {
    return executeSkillTool(name, argsString, conversationFileContext);
  }

  // ── Native device tools ────────────────────────────────────────────
  if (NATIVE_TOOL_NAMES.has(name)) {
    return executeNativeTool(name, argsString);
  }

  // ── Parity tools ──────────────────────────────────────────────────
  if (PARITY_TOOL_NAMES.has(name)) {
    switch (name) {
      case 'canvas_list':
        return executeCanvasList(args);
      case 'canvas_read':
        return executeCanvasRead(args);
      case 'canvas_create':
        return executeCanvasCreate(args, conversationFileContext);
      case 'canvas_update':
        return executeCanvasUpdate(args, conversationFileContext);
      case 'canvas_delete':
        return executeCanvasDelete(args);
      case 'canvas_navigate':
        return executeCanvasNavigate(args);
      case 'canvas_eval':
        return executeCanvasEval(args);
      case 'canvas_snapshot':
        return executeCanvasSnapshot(args);
      case 'sessions_spawn': {
        const sessionProvider = await resolveActiveProvider(context);
        if (!sessionProvider) {
          return JSON.stringify({
            status: 'error',
            error: 'No enabled provider configured for sub-agent sessions.',
          });
        }
        const sessionAllProviders = resolveEnabledProviders(context);
        return executeSessionSpawn(
          args,
          conversationId,
          sessionProvider,
          sessionAllProviders,
          context?.model,
        );
      }
      case 'sessions_list':
        return executeSessionList();
      case 'sessions_send': {
        const sendProvider = await resolveActiveProvider(context);
        if (!sendProvider) {
          return JSON.stringify({
            status: 'error',
            error: 'No enabled provider configured for sub-agent sessions.',
          });
        }
        return executeSessionSend(args, sendProvider, context?.model);
      }
      case 'sessions_history':
        return executeSessionHistory(args);
      case 'sessions_output':
        return executeSessionOutput(args);
      case 'sessions_surface_output':
        return executeSessionSurfaceOutput(args);
      case 'sessions_status':
        return executeSessionStatus(args);
      case 'sessions_wait':
        return executeSessionWait(args, conversationId);
      case 'sessions_cancel':
        return executeSessionCancel(args);
      case 'sessions_yield':
        return executeSessionYield(args, conversationId);
      case 'wait':
        return executeWait(args);
      case 'pdf_read':
        return executePdfRead(args);
      case 'camera_snap':
        return executeCameraSnap(args);
      case 'audio_transcribe':
        return executeAudioTranscribe(args);
      case 'memory_search': {
        const memorySearchProvider = await resolveActiveProvider(context);
        return executeMemorySearch(args, resolveMemorySearchEmbeddingConfig(memorySearchProvider), {
          conversationId: workspaceConversationId,
        });
      }
      case 'ssh_exec':
        return executeSshExec(args);
      case 'ssh_background_job_status':
        return executeSshBackgroundJobStatus(args);
      case 'ssh_background_job_wait':
        return executeSshBackgroundJobWait(args);
      case 'ssh_list_directory':
        return executeSshListDirectory(args);
      case 'ssh_read_file':
        return executeSshReadFile(args);
      case 'ssh_write_file':
        return executeSshWriteFile(args);
      case 'ssh_rename_path':
        return executeSshRenamePath(args);
      case 'ssh_delete_path':
        return executeSshDeletePath(args);
      case 'ssh_make_directory':
        return executeSshMakeDirectory(args);
      case 'expo_eas_create_project':
        return executeExpoEasCreateProject(args);
      case 'expo_eas_list_projects':
        return executeExpoEasListProjects(args);
      case 'expo_eas_status':
        return executeExpoEasStatus(args);
      case 'expo_eas_probe':
        return executeExpoEasProbe(args);
      case 'expo_eas_build':
        return executeExpoEasBuild(args);
      case 'expo_eas_update':
        return executeExpoEasUpdate(args);
      case 'expo_eas_submit':
        return executeExpoEasSubmit(args);
      case 'expo_eas_deploy_web':
        return executeExpoEasDeployWeb(args);
      case 'expo_eas_workflow_runs':
        return executeExpoEasWorkflowRuns(args);
      case 'expo_eas_workflow_status':
        return executeExpoEasWorkflowStatus(args);
      case 'expo_eas_workflow_wait':
        return executeExpoEasWorkflowWait(args);
      case 'expo_eas_graphql':
        return executeExpoEasGraphql(args);
      case 'tool_catalog':
        return executeToolCatalog(args, {
          availableToolNames: context?.availableToolNames
            ? new Set(context.availableToolNames)
            : undefined,
        });
      case 'poll_create':
        return executePollCreate(args);
      case 'message_effect':
        return executeMessageEffect(args);
      case 'speak':
        return executeSpeak(args);
      case 'agents_list':
        return executeAgentsList();
      case 'agents_switch':
        return executeAgentsSwitch(args, conversationId);
      case 'agents_configure':
        return executeAgentsConfigure(args);
      default:
        return `Error: unhandled parity tool "${name}"`;
    }
  }

  // ── Browser automation tools ───────────────────────────────────────
  if (BROWSER_TOOL_NAMES.has(name)) {
    return executeBrowserTool(name, args);
  }

  // ── Workspace file tools ───────────────────────────────────────────
  if (WORKSPACE_TOOL_NAMES.has(name)) {
    return executeWorkspaceTool(name, args);
  }

  // ── Core + extended tools ──────────────────────────────────────────
  switch (name) {
    case 'read_file':
      return executeReadFile(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'write_file':
      return executeWriteFile(args, workspaceConversationId);
    case 'list_files':
      return executeListFiles(args, workspaceConversationId);
    case 'fetch_url':
      return executeFetchUrl(args);
    case 'update_memory':
      return executeUpdateMemory(args, workspaceConversationId);
    case 'read_memory':
      return executeReadMemory(args, workspaceConversationId);
    case 'record_workflow_evidence':
      return executeRecordWorkflowEvidence(args, conversationId, context);
    case 'read_workflow_evidence':
      return executeReadWorkflowEvidence(args, conversationId, context);
    case 'create_task':
      return executeCreateTask(args);
    case 'javascript':
      return executeJavascript(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'python':
      return executePythonTool(args, conversationId, workspaceConversationId, context);

    // Extended tools
    case 'web_search':
      return executeWebSearch(args);
    case 'web_fetch':
      return executeWebFetch(args);
    case 'file_edit':
      return executeFileEdit(args, workspaceConversationId);
    case 'glob_search':
      return executeGlobSearch(args, workspaceConversationId);
    case 'text_search':
      return executeTextSearch(args, workspaceConversationId);

    // Cron tool — full CRUD for scheduled jobs
    case 'cron': {
      const action = args.action || 'create';
      const store = useSchedulerStore.getState();
      switch (action) {
        case 'create':
          return executeCreateTask({
            schedule: args.schedule,
            prompt: args.prompt || args.command,
          });
        case 'list': {
          const jobs = store.jobs;
          if (jobs.length === 0) return JSON.stringify({ jobs: [] });
          return JSON.stringify({
            jobs: jobs.map((j: any) => ({
              id: j.id,
              name: j.name,
              enabled: j.enabled,
              schedule: j.schedule,
            })),
          });
        }
        case 'delete':
          if (!args.id) return 'Error: id is required for delete action';
          store.removeJob(args.id);
          return JSON.stringify({ status: 'deleted', id: args.id });
        case 'enable':
          if (!args.id) return 'Error: id is required for enable action';
          store.enableJob(args.id);
          return JSON.stringify({ status: 'enabled', id: args.id });
        case 'disable':
          if (!args.id) return 'Error: id is required for disable action';
          store.disableJob(args.id);
          return JSON.stringify({ status: 'disabled', id: args.id });
        case 'run': {
          if (!args.id) return 'Error: id is required for run action';
          const job = store.getJob(args.id);
          if (!job) return `Error: job not found: ${args.id}`;
          return JSON.stringify({ status: 'triggered', id: args.id, name: job.name });
        }
        default:
          return `Error: unknown cron action: ${action}`;
      }
    }

    // Notification — sends a local notification message to the user
    case 'notify':
      return executeNativeTool('notification_send', argsString);

    // Image generation — uses configured provider or reports inability
    case 'image_generate':
      return executeImageGenerate(args, workspaceConversationId);

    // Image editing — uses configured provider and workspace image inputs
    case 'image_edit':
      return executeImageEdit(args, workspaceConversationId);

    default:
      return `Error: unknown tool "${name}". Available tools include: read_file, write_file, list_files, fetch_url, update_memory, read_memory, record_workflow_evidence, read_workflow_evidence, create_task, javascript, python, web_search, web_fetch, file_edit, glob_search, text_search, canvas_list, canvas_read, canvas_create, canvas_update, canvas_eval, canvas_snapshot, notify, image_generate, image_edit. Tool names are case-sensitive.`;
  }
}

export async function loadMemory(conversationId: string): Promise<string | null> {
  try {
    return await readConversationMemory(conversationId);
  } catch {
    return null;
  }
}
