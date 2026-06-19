import { resolveProviderEmbeddingConfig } from './embeddingConfigResolver';
import { executeSessionSend } from './builtin-session-send';
import { executeSessionSpawn } from './builtin-session-spawn';
import { executeMemorySearch } from './builtin-memory';
import {
  resolveToolProviderContext,
  type ToolProviderContextInput,
} from './toolProviderContext';
import type { ToolExecutionContext } from './toolExecutionContext';
import { executeWebSearch } from './web-search';

export const PROVIDER_AWARE_TOOL_NAMES = new Set([
  'memory_search',
  'sessions_send',
  'sessions_spawn',
  'web_search',
]);

export async function executeProviderAwareTool(params: {
  name: string;
  args: any;
  conversationId: string;
  workspaceConversationId: string;
  context?: ToolExecutionContext;
}): Promise<string | null> {
  if (!PROVIDER_AWARE_TOOL_NAMES.has(params.name)) {
    return null;
  }

  const providerContext = await resolveToolProviderContext(
    params.context as ToolProviderContextInput,
  );

  switch (params.name) {
    case 'sessions_spawn':
      if (!providerContext.provider) {
        return JSON.stringify({
          status: 'error',
          error: 'No enabled provider configured for sub-agent sessions.',
        });
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
        },
      );
    case 'sessions_send':
      if (!providerContext.provider) {
        return JSON.stringify({
          status: 'error',
          error: 'No enabled provider configured for sub-agent sessions.',
        });
      }
      return executeSessionSend(
        params.args,
        providerContext.provider,
        params.context?.model,
      );
    case 'memory_search':
      return executeMemorySearch(
        params.args,
        resolveProviderEmbeddingConfig(providerContext.provider),
        { conversationId: params.workspaceConversationId },
      );
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
