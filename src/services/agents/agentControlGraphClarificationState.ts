import type { AgentRunControlGraphPendingUserInput } from '../../types/agentRun';
import {
  isRequestClarificationSemanticRole,
  isRequestInformationKey,
  MAX_REQUEST_CLARIFICATION_FIELDS,
} from './requestClarification';

function normalizedId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizedTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

export function normalizeAgentControlGraphPendingUserInput(
  value: Partial<AgentRunControlGraphPendingUserInput> | undefined,
): AgentRunControlGraphPendingUserInput | undefined {
  const requestedAfterUserMessageId = normalizedId(value?.requestedAfterUserMessageId);
  if (!requestedAfterUserMessageId || !Array.isArray(value?.requiredInformation)) {
    return undefined;
  }
  const requiredInformation = value.requiredInformation
    .map((entry) => {
      if (
        !entry ||
        !isRequestInformationKey(entry.key) ||
        (entry.requiredFor !== 'understanding' && entry.requiredFor !== 'execution') ||
        !isRequestClarificationSemanticRole(entry.semanticRole) ||
        (entry.resolution !== 'unresolved' && entry.resolution !== 'user_provided')
      ) {
        return undefined;
      }
      return {
        key: entry.key,
        requiredFor: entry.requiredFor,
        semanticRole: entry.semanticRole,
        resolution: entry.resolution,
      };
    })
    .filter(
      (entry): entry is AgentRunControlGraphPendingUserInput['requiredInformation'][number] =>
        entry !== undefined,
    );
  if (
    requiredInformation.length === 0 ||
    requiredInformation.length > MAX_REQUEST_CLARIFICATION_FIELDS ||
    requiredInformation.length !== value.requiredInformation.length ||
    new Set(requiredInformation.map((entry) => entry.key)).size !== requiredInformation.length
  ) {
    return undefined;
  }
  return {
    requestedAfterUserMessageId,
    requiredInformation,
    updatedAt: normalizedTimestamp(value.updatedAt),
  };
}

export function admitAgentControlGraphClarificationReply(params: {
  pendingUserInput: AgentRunControlGraphPendingUserInput | undefined;
  resolvedUserInformationKeys: ReadonlyArray<string> | undefined;
  updatedAt: number;
}): AgentRunControlGraphPendingUserInput | undefined {
  if (!params.pendingUserInput) return undefined;
  const resolvedKeys = new Set(
    params.resolvedUserInformationKeys?.map((key) => key.trim()).filter(Boolean) ?? [],
  );
  const pendingKeys = new Set(
    params.pendingUserInput.requiredInformation.map((entry) => entry.key),
  );
  if ([...resolvedKeys].some((key) => !pendingKeys.has(key))) {
    throw new Error('clarification_resolution_key_unknown');
  }
  return {
    ...params.pendingUserInput,
    requiredInformation: params.pendingUserInput.requiredInformation.map((entry) => ({
      ...entry,
      resolution: resolvedKeys.has(entry.key) ? 'user_provided' : entry.resolution,
    })),
    updatedAt: params.updatedAt,
  };
}
