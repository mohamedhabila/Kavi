import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
import { hasExplicitToolContract } from './toolCapabilityContract';
import {
  getToolWorkflowContractIssues,
  type ToolWorkflowContractIssue,
} from './toolWorkflowContracts';

export function getToolsMissingExplicitCapabilities(): string[] {
  return TOOL_DEFINITIONS.filter((tool) => {
    const capabilities = tool.contract?.capabilities ?? [];
    return !hasExplicitToolContract(tool) || capabilities.length === 0;
  }).map((tool) => tool.name);
}

export function assertAllRegisteredToolsHaveExplicitCapabilities(): void {
  const missing = getToolsMissingExplicitCapabilities();
  if (missing.length > 0) {
    throw new Error(
      `Tools missing non-empty contract.capabilities (${missing.length}): ${missing.join(', ')}`,
    );
  }
  const workflowIssues = getRegisteredToolWorkflowContractIssues();
  if (workflowIssues.length > 0) {
    throw new Error(
      `Tools with invalid workflow contracts (${workflowIssues.length}): ${workflowIssues
        .map((issue) => `${issue.toolName}:${issue.code}`)
        .join(', ')}`,
    );
  }
}

export function getRegisteredToolWorkflowContractIssues(): ToolWorkflowContractIssue[] {
  return getToolWorkflowContractIssues([...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS]);
}
