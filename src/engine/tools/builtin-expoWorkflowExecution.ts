import {
  inspectExpoWorkflowRun,
  listExpoWorkflowRuns,
  waitForExpoWorkflowRun,
} from '../../services/expo/workflowMonitoring';
import { runExpoGraphqlQuery } from '../../services/expo/rawGraphql';
import { getExpoProjectAutomationContext, withExpoAutomation } from './builtin-expoAutomation';
import { resolveExpoProjectForToolCall } from './builtin-expoProjectResolution';
import { normalizeExpoToolPayload } from './builtin-expoSummary';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export async function executeExpoEasWorkflowRuns(args: {
  projectId: string;
  limit?: number;
}): Promise<ToolRuntimeOutcome> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_runs', args.projectId);
  if ('response' in resolved) {
    return failedToolOutcome(resolved.response);
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;
  const result = await listExpoWorkflowRuns(projectId, args);
  const content = JSON.stringify(
    normalizeExpoToolPayload('expo_eas_workflow_runs', withExpoAutomation(projectId, result), {
      preferredFlow: automation.preferredFlow,
    }),
  );

  return result.status === 'ok' ? completedToolOutcome(content) : failedToolOutcome(content);
}

export async function executeExpoEasWorkflowStatus(args: {
  projectId: string;
  workflowRunId?: string;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<ToolRuntimeOutcome> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_status', args.projectId);
  if ('response' in resolved) {
    return failedToolOutcome(resolved.response);
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;
  const result = await inspectExpoWorkflowRun(projectId, args);
  const content = JSON.stringify(
    normalizeExpoToolPayload('expo_eas_workflow_status', withExpoAutomation(projectId, result), {
      preferredFlow: automation.preferredFlow,
    }),
  );

  return result.status === 'ok' ? completedToolOutcome(content) : failedToolOutcome(content);
}

export async function executeExpoEasWorkflowWait(args: {
  projectId: string;
  workflowRunId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<ToolRuntimeOutcome> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_wait', args.projectId);
  if ('response' in resolved) {
    return failedToolOutcome(resolved.response);
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;
  const result = await waitForExpoWorkflowRun(projectId, args);
  const content = JSON.stringify(
    normalizeExpoToolPayload('expo_eas_workflow_wait', withExpoAutomation(projectId, result), {
      preferredFlow: automation.preferredFlow,
    }),
  );

  return result.status === 'ok' ? completedToolOutcome(content) : failedToolOutcome(content);
}

export async function executeExpoEasGraphql(args: {
  query: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  accountId?: string;
}): Promise<ToolRuntimeOutcome> {
  let resolvedProjectId: string | undefined;
  if (args.projectId !== undefined) {
    const resolved = await resolveExpoProjectForToolCall('expo_eas_graphql', args.projectId);
    if ('response' in resolved) {
      return failedToolOutcome(resolved.response);
    }
    resolvedProjectId = resolved.project.id;
  }

  const result = await runExpoGraphqlQuery(
    resolvedProjectId ? { ...args, projectId: resolvedProjectId } : args,
  );
  const automationProjectId = resolvedProjectId || result.projectId;
  let content: string;
  if (automationProjectId) {
    try {
      const automation = getExpoProjectAutomationContext(automationProjectId).automation;
      content = JSON.stringify(
        normalizeExpoToolPayload(
          'expo_eas_graphql',
          withExpoAutomation(automationProjectId, result),
          {
            preferredFlow: automation.preferredFlow,
          },
        ),
      );
    } catch {
      content = JSON.stringify(normalizeExpoToolPayload('expo_eas_graphql', result));
    }
  } else {
    content = JSON.stringify(normalizeExpoToolPayload('expo_eas_graphql', result));
  }

  return result.status === 'error' ? failedToolOutcome(content) : completedToolOutcome(content);
}
