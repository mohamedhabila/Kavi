import type { AgentRunAsyncOperation, AgentRunControlGraphState } from '../../types/agentRun';
import {
  resolveRequestDecision,
  type RequestPolicyDisposition,
} from '../../services/agents/requestDecisionPolicy';
import type { RequestFrame, RequiredRequestInformation } from '../../services/agents/requestFrame';

export interface RequestDecisionToolAuthority {
  isAvailable: (toolName: string) => boolean;
  isAllowed: (toolName: string) => boolean;
  requiresApproval: (toolName: string, args?: Record<string, unknown>) => boolean;
}

function activeOperations(graphSnapshot: AgentRunControlGraphState): AgentRunAsyncOperation[] {
  return graphSnapshot.asyncWork.pendingOperations.filter(
    (operation) => operation.status === 'running' || operation.status === 'cancel_requested',
  );
}

function uniqueMonitorToolNames(operation: AgentRunAsyncOperation): string[] {
  return Array.from(
    new Set(operation.monitorToolNames.map((toolName) => toolName.trim()).filter(Boolean)),
  );
}

function monitorToolArgs(
  operation: AgentRunAsyncOperation,
  toolName: string,
): Record<string, unknown> | undefined {
  return operation.waitToolName === toolName ? operation.waitArgs : operation.statusArgs;
}

function resolveMonitorPolicyDisposition(
  operations: ReadonlyArray<AgentRunAsyncOperation>,
  authority: RequestDecisionToolAuthority,
): RequestPolicyDisposition {
  let approvalRequired = false;

  for (const operation of operations) {
    const availableTools = uniqueMonitorToolNames(operation).filter(authority.isAvailable);
    const allowedTools = availableTools.filter(authority.isAllowed);
    if (allowedTools.length === 0) {
      return 'prohibited';
    }
    if (
      allowedTools.every((toolName) =>
        authority.requiresApproval(toolName, monitorToolArgs(operation, toolName)),
      )
    ) {
      approvalRequired = true;
    }
  }

  return approvalRequired ? 'approval_required' : 'allowed';
}

function operationStatusRequirements(
  operations: ReadonlyArray<AgentRunAsyncOperation>,
): RequiredRequestInformation[] {
  return operations.map((_, index) => ({
    key: `async.operation.${index}.status`,
    authority: 'tool',
    requiredFor: 'execution',
    resolution: 'unresolved',
  }));
}

function policyRequirement(
  disposition: RequestPolicyDisposition,
): RequiredRequestInformation | undefined {
  if (disposition === 'approval_required') {
    return {
      key: 'async.monitor.authorization',
      authority: 'policy',
      requiredFor: 'authorization',
      resolution: 'unresolved',
    };
  }
  if (disposition === 'prohibited') {
    return {
      key: 'async.monitor.policy',
      authority: 'policy',
      requiredFor: 'execution',
      resolution: 'unresolved',
    };
  }
  return undefined;
}

/**
 * Refines a structural request frame only for an explicit graph-owned resume.
 * Every input is code-owned: persisted async state plus the runtime tool authority snapshot.
 */
export function resolveGraphEntryRequestDecision(params: {
  frame: RequestFrame;
  graphSnapshot?: AgentRunControlGraphState;
  toolAuthority: RequestDecisionToolAuthority;
}): RequestFrame {
  if (
    params.frame.mode === 'agentic' &&
    params.frame.continuation === 'resume_waiting_user' &&
    params.graphSnapshot?.pendingUserInput
  ) {
    return resolveRequestDecision({
      frame: params.frame,
      requiredInformation: params.graphSnapshot.pendingUserInput.requiredInformation.map(
        ({ key, requiredFor }) => ({
          key,
          authority: 'user' as const,
          requiredFor,
          resolution: 'user_provided' as const,
        }),
      ),
      policyDisposition: 'allowed',
      permissionState: 'not_required',
      awaitingExternalOperation: false,
    });
  }
  if (
    params.frame.mode !== 'agentic' ||
    params.frame.continuation !== 'resume_waiting_async' ||
    !params.graphSnapshot
  ) {
    return params.frame;
  }

  const operations = activeOperations(params.graphSnapshot);
  if (operations.length > 0) {
    const policyDisposition = resolveMonitorPolicyDisposition(operations, params.toolAuthority);
    const policyInformation = policyRequirement(policyDisposition);
    return resolveRequestDecision({
      frame: params.frame,
      requiredInformation: [
        ...operationStatusRequirements(operations),
        ...(policyInformation ? [policyInformation] : []),
      ],
      policyDisposition,
      permissionState: 'not_required',
      awaitingExternalOperation: false,
    });
  }

  if (
    params.graphSnapshot.status !== 'waiting_async' &&
    !params.graphSnapshot.asyncWork.awaitingBackgroundWorkers
  ) {
    return params.frame;
  }

  return resolveRequestDecision({
    frame: params.frame,
    requiredInformation: [
      {
        key: 'async.background_workers',
        authority: 'tool',
        requiredFor: 'execution',
        resolution: 'unresolved',
      },
    ],
    policyDisposition: 'allowed',
    permissionState: 'not_required',
    awaitingExternalOperation: true,
  });
}
