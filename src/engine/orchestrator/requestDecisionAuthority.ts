import { needsApprovalWithContext } from '../../services/remote/approvalStore';
import { useToolPermissionsStore } from '../../services/security/permissions';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import type { RequestDecisionToolAuthority } from '../graph/requestDecisionSignals';

export function buildRuntimeRequestDecisionToolAuthority(params: {
  availableToolNames: ReadonlySet<string>;
  personaId: string;
}): RequestDecisionToolAuthority {
  const permissions = useToolPermissionsStore.getState();
  const canonicalName = (toolName: string) => resolveRegisteredToolName(toolName);

  return {
    isAvailable: (toolName) => params.availableToolNames.has(canonicalName(toolName)),
    isAllowed: (toolName) => permissions.isAllowed(canonicalName(toolName)),
    requiresApproval: (toolName, args) =>
      needsApprovalWithContext(canonicalName(toolName), args, params.personaId),
  };
}
