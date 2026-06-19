// ---------------------------------------------------------------------------
// Kavi — Tool Executor
// ---------------------------------------------------------------------------
// Central dispatcher: routes tool calls to the correct executor.

import { readConversationMemory } from '../../services/memory/store';
import { logToolCall } from '../../services/security/audit';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { needsApprovalWithContext, requestToolApproval } from '../../services/remote/approvalStore';
import { isE2EAgentEvalRuntime } from './e2eNativeCalendarFixtures';
import { normalizeToolName, resolveRegisteredToolName } from './toolNameNormalization';
import { executeToolInner } from './toolDispatchRouter';
import type { ToolExecutionContext } from './toolExecutionContext';

// ── Central dispatcher ───────────────────────────────────────────────────

export async function executeTool(
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const normalizedName = resolveRegisteredToolName(name);

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
  if (!isE2EAgentEvalRuntime() && needsApprovalWithContext(normalizedName, parsedArgs)) {
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

export async function loadMemory(conversationId: string): Promise<string | null> {
  try {
    return await readConversationMemory(conversationId);
  } catch {
    return null;
  }
}