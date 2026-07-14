import { executeSessionSend } from './builtin-session-send';
import { executeSessionSpawn } from './builtin-session-spawn';
import { resolveToolProviderContext, type ToolProviderContextInput } from './toolProviderContext';
import type { ToolExecutionContext } from './toolExecutionContext';
import { executeWebSearch } from './web-search';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';

export const PROVIDER_AWARE_TOOL_NAMES = new Set(['sessions_send', 'sessions_spawn', 'web_search']);

export async function executeProviderAwareTool(params: {
  name: string;
  args: any;
  conversationId: string;
  workspaceConversationId: string;
  context?: ToolExecutionContext;
}): Promise<ToolRuntimeOutcome | null> {
  if (!PROVIDER_AWARE_TOOL_NAMES.has(params.name)) {
    return null;
  }

  const providerContext = await resolveToolProviderContext(
    params.context as ToolProviderContextInput,
  );

  switch (params.name) {
    case 'sessions_spawn':
      if (!providerContext.provider) {
        return failedToolOutcome(
          JSON.stringify({
            status: 'error',
            error: 'No enabled provider configured for sub-agent sessions.',
          }),
        );
      }
      return executeSessionSpawn(
        params.args,
        params.conversationId,
        providerContext.provider,
        providerContext.allProviders,
        providerContext.model || params.context?.model,
        {
          controlGraphGoals: params.context?.controlGraphGoals,
          agentRunId: params.context?.agentRunId,
          memoryConversationId: params.context?.memoryConversationId,
        },
      );
    case 'sessions_send':
      if (!providerContext.provider) {
        return failedToolOutcome(
          JSON.stringify({
            status: 'error',
            error: 'No enabled provider configured for sub-agent sessions.',
          }),
        );
      }
      return executeSessionSend(params.args, providerContext.provider, params.context?.model);
    case 'web_search':
      return executeWebSearch(params.args, {
        provider: providerContext.provider ?? undefined,
        allProviders: providerContext.allProviders,
        model: providerContext.model,
      });
    default:
      return null;
  }
}
