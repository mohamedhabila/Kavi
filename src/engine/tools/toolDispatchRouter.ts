// ---------------------------------------------------------------------------
// Kavi — Tool Dispatch Router
// ---------------------------------------------------------------------------
// Routes normalized tool calls to the correct executor implementation.

import { executeWebFetch } from './web-fetch';
import { executeFileEdit, executeGlobSearch, executeTextSearch } from './extended';
import { executeNativeTool } from './native/executor';
import { tryExecuteNativeToolInEnvironment } from './native/executionEnvironment';
import { parseMcpToolName, executeMcpTool } from '../../services/mcp/bridge';
import { mcpManager } from '../../services/mcp/manager';
import { parseSkillToolName, executeSkillTool } from '../../services/skills/manager';
import { runJobNow } from '../../services/scheduler/engine';
import {
  deleteScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  setScheduledJobEnabled,
  updateScheduledJob,
} from '../../services/scheduler/commands';
import { executeBrowserTool } from './browserToolExecutor';
import { executeImageEdit, executeImageGenerate } from './toolImageExecution';
import { executeJavascript } from './toolJavaScriptExecution';
import { executeBuiltinTool, BUILTIN_TOOL_NAMES } from './toolBuiltinExecution';
import { executeWorkspaceTool } from './workspaceToolExecutor';
import { resolveRegisteredToolName } from './toolNameNormalization';
import { executeProviderAwareTool } from './providerAwareToolExecution';
import { parseToolArgumentsJson } from '../toolExecution/toolArgumentJsonRecovery';
import { resolveToolWorkspaceContext, type ToolExecutionContext } from './toolExecutionContext';
import { executePythonTool } from './toolPythonExecution';
import { executeUpdateGoals } from './toolGoalExecution';
import { executeRequestClarification } from './toolRequestClarificationExecution';
import { createConversationFileContext } from './toolWorkspaceFiles';
import { executeListFiles, executeReadFile, executeWriteFile } from './toolWorkspaceCoreExecution';
import {
  executeCreateTask,
  rejectedScheduledJobOutcome,
  resolveScheduledJobTarget,
} from './toolScheduledJobExecution';
import type { AuthorizedToolEffectExecutionClaim } from '../../services/executionJournal/authorizedToolEffectExecutionClaim';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

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
  'photos_pick',
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

// ── Inner dispatcher ─────────────────────────────────────────────────────

export async function executeToolInner(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
  authorizedEffectExecutionClaim?: AuthorizedToolEffectExecutionClaim,
): Promise<ToolRuntimeOutcome> {
  name = resolveRegisteredToolName(name);

  let args: any;
  try {
    args = parseToolArgumentsJson(argsString);
  } catch {
    const preview = argsString.length > 300 ? argsString.slice(0, 300) + '…' : argsString;
    return failedToolOutcome(
      `Error: tool "${name}" received malformed JSON arguments that could not be parsed. Raw input: ${preview}\nPlease retry the tool call with valid JSON arguments.`,
    );
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
      signal: context?.executionSignal,
    });
  }

  // ── Skill tools (skill__skillId__toolName) ─────────────────────────
  if (parseSkillToolName(name)) {
    return executeSkillTool(name, argsString, {
      ...conversationFileContext,
      executionSignal: context?.executionSignal,
    });
  }

  // ── Native device tools ────────────────────────────────────────────
  if (NATIVE_TOOL_NAMES.has(name)) {
    const environmentResult = await tryExecuteNativeToolInEnvironment({
      name,
      argsString,
      conversationId,
      context,
    });
    if (environmentResult !== null) {
      return environmentResult;
    }
    return executeNativeTool(name, argsString, context?.executionSignal);
  }

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

  // ── Builtin tools ──────────────────────────────────────────────────
  if (BUILTIN_TOOL_NAMES.has(name)) {
    return executeBuiltinTool({
      name,
      args,
      conversationId,
      workspaceConversationId,
      conversationFileContext,
      context,
      ...(authorizedEffectExecutionClaim ? { authorizedEffectExecutionClaim } : {}),
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
    case 'request_clarification':
      return executeRequestClarification(args);

    // Extended tools
    case 'web_fetch':
      return executeWebFetch(args, context?.executionSignal);
    case 'file_edit':
      return executeFileEdit(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'glob_search':
      return executeGlobSearch(args, workspaceConversationId, workspaceReadFallbackConversationId);
    case 'text_search':
      return executeTextSearch(args, workspaceConversationId, workspaceReadFallbackConversationId);

    // Cron tool — full CRUD for scheduled jobs
    case 'cron': {
      const action = args.action || 'create';
      switch (action) {
        case 'create':
          return executeCreateTask({
            schedule: args.schedule,
            prompt: args.prompt || args.command,
            name: args.name,
            timezone: args.timezone,
            mode: args.mode,
          });
        case 'list': {
          const jobs = await listScheduledJobs();
          if (jobs.length === 0) {
            return completedToolOutcome(JSON.stringify({ status: 'listed', jobs: [] }));
          }
          return completedToolOutcome(
            JSON.stringify({
              status: 'listed',
              jobs: jobs.map((j: any) => ({
                id: j.id,
                name: j.name,
                enabled: j.enabled,
                schedule: j.schedule,
                mode: j.payload.mode,
                state: j.runningAttemptId
                  ? 'running'
                  : j.nextRetryAtMs
                    ? 'retry_scheduled'
                    : j.enabled
                      ? 'scheduled'
                      : 'disabled',
                nextRunAtMs: j.nextRetryAtMs ?? j.nextRunAtMs,
                lastError: j.lastError,
                deliveryWarning: j.lastDeliveryError,
                wakeWarning: j.lastWakeError,
              })),
            }),
          );
        }
        case 'update': {
          const target = await resolveScheduledJobTarget({
            action,
            id: args.id,
            name: args.name,
          });
          if (target.status === 'rejected') return target.outcome;
          const existingJob = target.job ?? (await getScheduledJob(target.id));
          if (!existingJob) {
            return rejectedScheduledJobOutcome({
              code: 'scheduled_job_not_found',
              error: `Scheduled task not found: ${target.id}`,
              details: { id: target.id },
              repair: {
                retryable: true,
                code: 'scheduled_job_not_found',
                fields: ['id'],
                tool: 'cron',
                retryArguments: { action: 'list' },
              },
            });
          }
          const updates: Parameters<typeof updateScheduledJob>[1] = {};
          const requestedTimezone =
            typeof args.timezone === 'string' && args.timezone.trim()
              ? args.timezone.trim()
              : undefined;
          const requestedMode =
            args.mode === undefined
              ? undefined
              : args.mode === 'agentic' || args.mode === 'chitchat'
                ? args.mode
                : null;
          if (requestedMode === null) {
            return rejectedScheduledJobOutcome({
              code: 'invalid_scheduled_job',
              error: 'mode must be agentic or chitchat.',
              repair: {
                retryable: true,
                code: 'invalid_scheduled_job',
                invalidFields: ['mode'],
              },
            });
          }
          if (typeof args.newName === 'string' && args.newName.trim()) {
            updates.name = args.newName.trim();
          }
          if (typeof args.schedule === 'string' && args.schedule.trim()) {
            const timezone =
              requestedTimezone ??
              (existingJob.schedule.kind === 'cron' ? existingJob.schedule.tz : undefined);
            updates.schedule = {
              kind: 'cron',
              expr: args.schedule.trim(),
              ...(timezone ? { tz: timezone } : {}),
            };
          } else if (requestedTimezone) {
            if (existingJob.schedule.kind !== 'cron') {
              return rejectedScheduledJobOutcome({
                code: 'invalid_scheduled_job',
                error: 'timezone can only update a cron schedule.',
                repair: {
                  retryable: true,
                  code: 'invalid_scheduled_job',
                  invalidFields: ['timezone'],
                },
              });
            }
            updates.schedule = { ...existingJob.schedule, tz: requestedTimezone };
          }
          if ((typeof args.prompt === 'string' && args.prompt.trim()) || requestedMode) {
            updates.payload = {
              ...existingJob.payload,
              ...(typeof args.prompt === 'string' && args.prompt.trim()
                ? { prompt: args.prompt.trim() }
                : {}),
              ...(requestedMode ? { mode: requestedMode } : {}),
            };
          }
          if (Object.keys(updates).length === 0) {
            return rejectedScheduledJobOutcome({
              code: 'scheduled_job_update_empty',
              error:
                'update requires at least one of newName, schedule, prompt, timezone, or mode.',
              repair: {
                retryable: true,
                code: 'scheduled_job_update_empty',
                missingFields: ['newName', 'schedule', 'prompt', 'timezone', 'mode'],
              },
            });
          }
          try {
            const result = await updateScheduledJob(target.id, updates);
            if (result.status === 'not_found') {
              return rejectedScheduledJobOutcome({
                code: 'scheduled_job_not_found',
                error: `Scheduled task not found: ${target.id}`,
                details: { id: target.id },
                repair: {
                  retryable: true,
                  code: 'scheduled_job_not_found',
                  fields: ['id'],
                  tool: 'cron',
                  retryArguments: { action: 'list' },
                },
              });
            }
            return completedToolOutcome(
              JSON.stringify({
                status: 'updated',
                id: target.id,
                ...(result.warning ? { warning: result.warning } : {}),
              }),
            );
          } catch (error) {
            return failedToolOutcome(
              JSON.stringify({
                status: 'error',
                code: 'scheduled_job_update_failed',
                error: error instanceof Error ? error.message : String(error),
                id: target.id,
              }),
            );
          }
        }
        case 'delete': {
          const target = await resolveScheduledJobTarget({
            action,
            id: args.id,
            name: args.name,
          });
          if (target.status === 'rejected') return target.outcome;
          try {
            const result = await deleteScheduledJob(target.id);
            if (result === 'not_found') {
              return rejectedScheduledJobOutcome({
                code: 'scheduled_job_not_found',
                error: `Scheduled task not found: ${target.id}`,
                details: { id: target.id },
              });
            }
            if (result === 'busy') {
              return rejectedScheduledJobOutcome({
                code: 'scheduled_job_busy',
                error: `Scheduled task is currently running: ${target.id}`,
                details: { id: target.id },
              });
            }
            return completedToolOutcome(JSON.stringify({ status: 'deleted', id: target.id }));
          } catch (error) {
            return failedToolOutcome(
              JSON.stringify({
                status: 'error',
                code: 'scheduled_job_delete_failed',
                error: error instanceof Error ? error.message : String(error),
                id: target.id,
              }),
            );
          }
        }
        case 'enable': {
          const target = await resolveScheduledJobTarget({
            action,
            id: args.id,
            name: args.name,
          });
          if (target.status === 'rejected') return target.outcome;
          try {
            const result = await setScheduledJobEnabled(target.id, true);
            if (result.status === 'not_found') {
              return rejectedScheduledJobOutcome({
                code: 'scheduled_job_not_found',
                error: `Scheduled task not found: ${target.id}`,
                details: { id: target.id },
              });
            }
            return completedToolOutcome(
              JSON.stringify({
                status: 'enabled',
                id: target.id,
                ...(result.warning ? { warning: result.warning } : {}),
              }),
            );
          } catch (error) {
            return failedToolOutcome(
              JSON.stringify({
                status: 'error',
                code: 'scheduled_job_enable_failed',
                error: error instanceof Error ? error.message : String(error),
                id: target.id,
              }),
            );
          }
        }
        case 'disable': {
          const target = await resolveScheduledJobTarget({
            action,
            id: args.id,
            name: args.name,
          });
          if (target.status === 'rejected') return target.outcome;
          try {
            const result = await setScheduledJobEnabled(target.id, false);
            if (result.status === 'not_found') {
              return rejectedScheduledJobOutcome({
                code: 'scheduled_job_not_found',
                error: `Scheduled task not found: ${target.id}`,
                details: { id: target.id },
              });
            }
            return completedToolOutcome(
              JSON.stringify({
                status: 'disabled',
                id: target.id,
                ...(result.warning ? { warning: result.warning } : {}),
              }),
            );
          } catch (error) {
            return failedToolOutcome(
              JSON.stringify({
                status: 'error',
                code: 'scheduled_job_disable_failed',
                error: error instanceof Error ? error.message : String(error),
                id: target.id,
              }),
            );
          }
        }
        case 'run': {
          const target = await resolveScheduledJobTarget({
            action,
            id: args.id,
            name: args.name,
          });
          if (target.status === 'rejected') return target.outcome;
          const result = await runJobNow(target.id, { trigger: 'manual' });
          if (result.status === 'not_found') {
            return rejectedScheduledJobOutcome({
              code: 'scheduled_job_not_found',
              error: `Scheduled task not found: ${target.id}`,
              details: { id: target.id },
            });
          }
          if (
            result.status === 'retrying' ||
            result.status === 'failed' ||
            result.status === 'busy' ||
            result.status === 'skipped'
          ) {
            return failedToolOutcome(
              JSON.stringify({
                status: 'error',
                code:
                  result.status === 'retrying'
                    ? 'scheduled_job_retrying'
                    : result.status === 'busy'
                      ? 'scheduled_job_busy'
                      : result.status === 'skipped'
                        ? 'scheduled_job_not_due'
                        : 'scheduled_job_failed',
                error: result.error,
                retryScheduled: result.status === 'retrying',
                id: target.id,
                name: result.name,
              }),
            );
          }
          return completedToolOutcome(
            JSON.stringify({
              status: result.status,
              id: target.id,
              name: result.name,
              ...(result.status === 'succeeded' && result.warning
                ? { warning: result.warning }
                : {}),
            }),
          );
        }
        default:
          return rejectedScheduledJobOutcome({
            code: 'scheduled_job_action_unknown',
            error: `Unknown cron action: ${action}`,
            repair: {
              retryable: true,
              code: 'scheduled_job_action_unknown',
              invalidFields: ['action'],
            },
          });
      }
    }

    // Image generation — uses configured provider or reports inability
    case 'image_generate':
      return executeImageGenerate(args, workspaceConversationId);

    // Image editing — uses configured provider and workspace image inputs
    case 'image_edit':
      return executeImageEdit(args, workspaceConversationId);

    default:
      return failedToolOutcome(
        `Error: unknown tool "${name}". Available tools include: read_file, write_file, list_files, update_goals, javascript, python, web_search, web_fetch, file_edit, glob_search, text_search, cron, canvas_list, canvas_read, canvas_create, canvas_update, canvas_eval, canvas_snapshot, image_generate, image_edit. Tool names are case-sensitive.`,
      );
  }
}
