import { executeAgentsConfigure, executeAgentsList, executeAgentsSwitch } from './builtin-agents';
import { executeMessageEffect, executePollCreate } from './builtin-interaction';
import { executeSpeak } from './builtin-media';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

export const BUILTIN_AGENT_TOOL_NAMES = new Set([
  'poll_create',
  'message_effect',
  'speak',
  'agents_list',
  'agents_switch',
  'agents_configure',
  'agents',
]);

export async function executeBuiltinAgentTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, conversationId } = params;

  switch (name) {
    case 'poll_create':
      return executePollCreate(args);
    case 'message_effect':
      return executeMessageEffect(args);
    case 'speak':
      return executeSpeak(args);
    case 'agents_list':
      return executeAgentsList();
    case 'agents_switch':
      return executeAgentsSwitch(args, conversationId);
    case 'agents_configure':
      return executeAgentsConfigure(args);
    case 'agents': {
      const action = typeof args?.action === 'string' ? args.action.toLowerCase() : '';
      if (action === 'list') return executeAgentsList();
      if (action === 'switch') return executeAgentsSwitch(args, conversationId);
      if (action === 'configure') return executeAgentsConfigure(args);
      return 'Error: agents requires action ∈ {list, switch, configure}';
    }
    default:
      return null;
  }
}
