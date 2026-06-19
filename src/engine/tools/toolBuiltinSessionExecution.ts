import { executeSessionCancel, executeSessionYield } from './builtin-session-control';
import { executeSessionHistory, executeSessionList, executeSessionOutput, executeSessionSurfaceOutput } from './builtin-session-history';
import { executeSessionStatus } from './builtin-session-status';
import { executeSessionWait } from './builtin-session-wait';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

export const BUILTIN_SESSION_TOOL_NAMES = new Set([
  'sessions_list',
  'sessions_history',
  'sessions_output',
  'sessions_surface_output',
  'sessions_status',
  'sessions_wait',
  'sessions_cancel',
  'sessions_yield',
]);

export async function executeBuiltinSessionTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, conversationId } = params;

  switch (name) {
    case 'sessions_list':
      return executeSessionList();
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
    default:
      return null;
  }
}
