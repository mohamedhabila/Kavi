import { needsApprovalWithContext } from '../../services/remote/approvalStore';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import type { RequestDecisionToolAuthority } from '../graph/requestDecisionSignals';

/** Answers availability, permission and approval exactly as tool execution will. */
export function buildRuntimeRequestDecisionToolAuthority(
  availableToolNames: ReadonlySet<string>,
): RequestDecisionToolAuthority {
  const permissions = useToolPermissionsStore.getState();
  const canonicalName = (toolName: string) => resolveRegisteredToolName(toolName);

  return {
    isAvailable: (toolName) => availableToolNames.has(canonicalName(toolName)),
    isAllowed: (toolName) => permissions.isAllowed(canonicalName(toolName)),
    requiresApproval: (toolName, args) => needsApprovalWithContext(canonicalName(toolName), args),
  };
}
