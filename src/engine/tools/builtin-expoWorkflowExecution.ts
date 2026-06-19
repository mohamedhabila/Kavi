import {
  inspectExpoWorkflowRun,
  listExpoWorkflowRuns,
  waitForExpoWorkflowRun,
} from '../../services/expo/workflowMonitoring';
import { runExpoGraphqlQuery } from '../../services/expo/rawGraphql';
import { getExpoProjectAutomationContext, withExpoAutomation } from './builtin-expoAutomation';
import { resolveExpoProjectForToolCall } from './builtin-expoProjectResolution';
import { normalizeExpoToolPayload } from './builtin-expoSummary';

export async function executeExpoEasWorkflowRuns(args: {
  projectId: string;
  limit?: number;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_runs', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_runs',
      withExpoAutomation(projectId, await listExpoWorkflowRuns(projectId, args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasWorkflowStatus(args: {
  projectId: string;
  workflowRunId?: string;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_status', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_status',
      withExpoAutomation(projectId, await inspectExpoWorkflowRun(projectId, args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasWorkflowWait(args: {
  projectId: string;
  workflowRunId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<string> {
  const resolved = await resolveExpoProjectForToolCall('expo_eas_workflow_wait', args.projectId);
  if ('response' in resolved) {
    return resolved.response;
  }
  const projectId = resolved.project.id;
  const automation = getExpoProjectAutomationContext(projectId).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_wait',
      withExpoAutomation(projectId, await waitForExpoWorkflowRun(projectId, args)),
      { preferredFlow: automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasGraphql(args: {
  query: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  accountId?: string;
}): Promise<string> {
  let resolvedProjectId: string | undefined;
  if (args.projectId !== undefined) {
    const resolved = await resolveExpoProjectForToolCall('expo_eas_graphql', args.projectId);
    if ('response' in resolved) {
      return resolved.response;
    }
    resolvedProjectId = resolved.project.id;
  }

  const result = await runExpoGraphqlQuery(
    resolvedProjectId ? { ...args, projectId: resolvedProjectId } : args,
  );
  const automationProjectId = resolvedProjectId || result.projectId;
  if (automationProjectId) {
    try {
      const automation = getExpoProjectAutomationContext(automationProjectId).automation;
      return JSON.stringify(
        normalizeExpoToolPayload(
          'expo_eas_graphql',
          withExpoAutomation(automationProjectId, result),
          {
            preferredFlow: automation.preferredFlow,
          },
        ),
      );
    } catch {
      return JSON.stringify(normalizeExpoToolPayload('expo_eas_graphql', result));
    }
  }

  return JSON.stringify(normalizeExpoToolPayload('expo_eas_graphql', result));
}
