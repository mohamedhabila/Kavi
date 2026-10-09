// ---------------------------------------------------------------------------
// Kavi — Conversation Mode Escalation
// ---------------------------------------------------------------------------
// Chitchat is the cheap path: no graph goals, no delegation, and no authority over
// the capabilities agentic orchestration owns (sub-agent sessions, goal mutation,
// remote shells, build tooling, source control, browser automation, arbitrary code,
// and open-world tools that can act on what they reach). Everyday actions such as
// calendar, contacts, messaging, and reminders stay inside chitchat's authority.
//
// Detection here is purely structural and uses the same contract predicate as
// chitchat's execution authority and tool surface (`isChitchatAuthorizedTool`): a
// chitchat turn escalates only when it discovers a tool chitchat may not call. A
// discovered tool chitchat may already call needs no escalation — escalating for it
// would move the conversation onto the agentic surface and goal bootstrap for good,
// at the cost of extra model turns, with no new authority actually needed.
//
// This module is pure. It records no state and performs no mutation.
// ---------------------------------------------------------------------------

import type { ConversationMode } from '../../../types/conversation';
import type { ToolDefinition } from '../../../types/tool';
import { isChitchatAuthorizedTool } from '../../goals/toolSurfaceAuthority';
import { normalizeToolName } from '../../tools/toolNameNormalization';

export type ConversationModeEscalation =
  | Readonly<{ required: false }>
  | Readonly<{
      required: true;
      reason: 'agentic_capability_discovered';
      /** Tools the turn discovered but chitchat may not call. Bounded for logging. */
      blockedToolNames: ReadonlyArray<string>;
    }>;

const NOT_REQUIRED: ConversationModeEscalation = { required: false };
const MAX_REPORTED_TOOL_NAMES = 6;

/**
 * Reports that a chitchat turn discovered a tool outside chitchat's authority, so the
 * graph can escalate the conversation instead of quietly degrading it.
 */
export function detectChitchatModeEscalation(params: {
  conversationMode: ConversationMode | undefined;
  allTools: ReadonlyArray<ToolDefinition>;
  activatedCatalogToolNames: ReadonlySet<string>;
}): ConversationModeEscalation {
  if (params.conversationMode !== 'chitchat' || params.activatedCatalogToolNames.size === 0) {
    return NOT_REQUIRED;
  }

  const toolByName = new Map(
    params.allTools
      .map((tool): [string, ToolDefinition] => [normalizeToolName(tool.name), tool])
      .filter(([toolName]) => Boolean(toolName)),
  );

  const blockedToolNames: string[] = [];
  for (const activatedToolName of params.activatedCatalogToolNames) {
    const toolName = normalizeToolName(activatedToolName);
    const tool = toolByName.get(toolName);
    if (!tool || isChitchatAuthorizedTool(tool)) {
      continue;
    }
    blockedToolNames.push(toolName);
  }

  if (blockedToolNames.length === 0) {
    return NOT_REQUIRED;
  }

  return {
    required: true,
    reason: 'agentic_capability_discovered',
    blockedToolNames: blockedToolNames.slice(0, MAX_REPORTED_TOOL_NAMES),
  };
}

export function buildConversationModeEscalationDetail(
  escalation: Extract<ConversationModeEscalation, { required: true }>,
): string {
  const tools = escalation.blockedToolNames.join(',');
  return `from:chitchat,to:agentic,reason:${escalation.reason}${tools ? `,tools:${tools}` : ''}`;
}
