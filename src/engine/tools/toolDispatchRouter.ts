// ---------------------------------------------------------------------------
// Kavi — Tool Dispatch Router
// ---------------------------------------------------------------------------
// Routes normalized tool calls to the correct executor implementation.

import { executeWebFetch } from './web-fetch';
import { executeFileEdit, executeGlobSearch, executeTextSearch } from './extended';
import { tryExecuteE2ENativeMobileTool } from './e2eNativeCalendarFixtures';
import { executeNativeTool } from './native/executor';
import { parseMcpToolName, executeMcpTool } from '../../services/mcp/bridge';
import { mcpManager } from '../../services/mcp/manager';
import { parseSkillToolName, executeSkillTool } from '../../services/skills/manager';
import { useSchedulerStore } from '../../services/scheduler/store';
import { executeBrowserTool } from './browserToolExecutor';
import { executeImageEdit, executeImageGenerate } from './toolImageExecution';
import { executeJavascript } from './toolJavaScriptExecution';
import { executeBuiltinTool, BUILTIN_TOOL_NAMES } from './toolBuiltinExecution';
import { executeWorkspaceTool } from './workspaceToolExecutor';
import { resolveRegisteredToolName } from './toolNameNormalization';
import { executeProviderAwareTool } from './providerAwareToolExecution';
import { resolveToolWorkspaceContext, type ToolExecutionContext } from './toolExecutionContext';
import { executePythonTool } from './toolPythonExecution';
import { executeUpdateGoals } from './toolGoalExecution';
import { createConversationFileContext } from './toolWorkspaceFiles';
import { executeListFiles, executeReadFile, executeWriteFile } from './toolWorkspaceCoreExecution';

// ── Native tool names for routing ────────────────────────────────────────

export const NATIVE_TOOL_NAMES = new Set([
  'calendar_list',
  'calendar_events',
  'calendar_create_event',
  'calendar_update_event',
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
  'contacts_form',
  'location_current',
  'clipboard_read',
  'clipboard_write',
  'clipboard',
  'share_text',
  'share_url',
  'share_file',
  'share_contact',
  'share',
  'open_url',
  'notification_send',
  'notification_schedule',
  'notification_cancel',
  'device_status',
  'device_info',
  'device_permissions',
  'device_health',
  'device_query',
  'photos_latest',
  'camera_clip',
  'screen_record',
  'haptic_feedback',
]);

export const BROWSER_TOOL_NAMES = new Set([
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
  'browser_inspect',
  'browser_cookies',
  'browser_storage',
  'browser_evaluate',
  'browser_upload',
  'browser_download',
  'browser_pdf',
  'browser_fill_form',
  'browser_dialog',
]);

export const WORKSPACE_TOOL_NAMES = new Set([
  'workspace_status',
  'workspace_launch_browser',
  'workspace_delegate_task',
]);

export async function executeCreateTask(args: {
  schedule: string;
  prompt: string;
}): Promise<string> {
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

// ── Inner dispatcher ─────────────────────────────────────────────────────

export async function executeToolInner(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  name = resolveRegisteredToolName(name);

  let args: any;
  try {
    args = argsString ? JSON.parse(argsString) : {};
  } catch {
    const preview = argsString.length > 300 ? argsString.slice(0, 300) + '…' : argsString;
    return `Error: tool "${name}" received malformed JSON arguments that could not be parsed. Raw input: ${preview}\nPlease retry the tool call with valid JSON arguments.`;
  }

  const { workspaceConversationId, workspaceReadFallbackConversationId } =
    resolveToolWorkspaceContext(conversationId, context);
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
    const e2eNativeFixture = await tryExecuteE2ENativeMobileTool(name, argsString);
    if (e2eNativeFixture !== null) {
      return e2eNativeFixture;
    }
    return executeNativeTool(name, argsString);
  }

  if (name !== 'memory_search') {
    const providerAwareResult = await executeProviderAwareTool({
      name,
      args,
      conversationId,
      workspaceConversationId,
      context,
    });
    if (providerAwareResult !== null) {
      return providerAwareResult;
    }
  }

  // ── Builtin tools ──────────────────────────────────────────────────
  if (BUILTIN_TOOL_NAMES.has(name)) {
    return executeBuiltinTool({
      name,
      args,
      conversationId,
      workspaceConversationId,
      conversationFileContext,
      context,
    });
  }

  // ── Browser automation tools ───────────────────────────────────────
  if (BROWSER_TOOL_NAMES.has(name)) {
    return executeBrowserTool(name, args);
  }

  // ── Explicit external workspace control tools ──────────────────────
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
    case 'javascript':
      return executeJavascript(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'python':
      return executePythonTool(args, conversationId, workspaceConversationId, context);
    case 'update_goals':
      return executeUpdateGoals(args);

    // Extended tools
    case 'web_fetch':
      return executeWebFetch(args);
    case 'file_edit':
      return executeFileEdit(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'glob_search':
      return executeGlobSearch(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'text_search':
      return executeTextSearch(args, workspaceConversationId, workspaceReadFallbackConversationId);

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

    // Image generation — uses configured provider or reports inability
    case 'image_generate':
      return executeImageGenerate(args, workspaceConversationId);

    // Image editing — uses configured provider and workspace image inputs
    case 'image_edit':
      return executeImageEdit(args, workspaceConversationId);

    default:
      return `Error: unknown tool "${name}". Available tools include: read_file, write_file, list_files, update_goals, javascript, python, web_search, web_fetch, file_edit, glob_search, text_search, cron, canvas_list, canvas_read, canvas_create, canvas_update, canvas_eval, canvas_snapshot, image_generate, image_edit. Tool names are case-sensitive.`;
  }
}
