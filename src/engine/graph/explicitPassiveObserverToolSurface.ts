import type { ConversationMode } from '../../types/conversation';
import type { ToolDefinition } from '../../types/tool';
import { inferToolCapabilityDescriptor } from '../tools/capabilityRegistry';
import { descriptorIsPassiveAsyncObserver } from '../tools/toolLifecycleSemantics';
import { normalizeToolName } from '../tools/toolNameNormalization';

const DIRECT_TOOL_ACTION = '(?:call|use|using|invoke|run)';
const NEGATED_TOOL_ACTION =
  "(?:do\\s+not|don['’]?t|never|avoid)\\s+(?:call|use|using|invoke|run)|without\\s+(?:calling|using|invoking|running)";

function normalizeUserText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function toolReferencePattern(toolName: string): string {
  const escapedToolName = escapeRegExp(toolName.toLowerCase());
  return `(?:the\\s+)?(?:generic\\s+)?(?:tool\\s+)?\`?${escapedToolName}\`?(?:\\s+tool)?(?=$|[^\\p{L}\\p{N}_])`;
}

function explicitlyRequestsTool(text: string, toolName: string): boolean {
  const toolReference = toolReferencePattern(toolName);
  const negatedRequest = new RegExp(`\\b(?:${NEGATED_TOOL_ACTION})\\s+${toolReference}`, 'u');
  if (negatedRequest.test(text)) return false;

  return new RegExp(`\\b${DIRECT_TOOL_ACTION}\\s+${toolReference}`, 'u').test(text);
}

/**
 * Promotes a directly requested passive observer into the grounded tool surface.
 * This only improves discovery: runtime policy and tool execution still enforce
 * authority. Tools with producer, compute, or mutation effects are excluded.
 */
export function resolveExplicitPassiveObserverToolNames(params: {
  conversationMode?: ConversationMode;
  latestUserMessageText: string;
  tools: ReadonlyArray<ToolDefinition>;
}): string[] {
  if (params.conversationMode !== 'agentic') return [];

  const text = normalizeUserText(params.latestUserMessageText);
  if (!text) return [];

  return params.tools.flatMap((tool) => {
    const toolName = normalizeToolName(tool.name);
    if (!toolName || !descriptorIsPassiveAsyncObserver(inferToolCapabilityDescriptor(tool))) {
      return [];
    }
    return explicitlyRequestsTool(text, toolName) ? [toolName] : [];
  });
}
