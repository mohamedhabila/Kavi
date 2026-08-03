// ---------------------------------------------------------------------------
// Kavi — Conversation Mode Escalation
// ---------------------------------------------------------------------------
// Chitchat is the cheap path: no graph goals, no delegation, and no authority to
// mutate non-memory state. That boundary is correct for actual chitchat, but it
// used to fail silently — the assistant would discover `calendar_create_event`,
// have it dropped from the surface, and answer as though the capability did not
// exist. Detection here is purely structural: it reports that a chitchat turn has
// reached for a capability only an agentic run may use, so the graph can escalate
// the conversation instead of quietly degrading it.
//
// This module is pure. It records no state and performs no mutation.
// ---------------------------------------------------------------------------

import type { ConversationMode } from '../../../types/conversation';
import type { ToolDefinition } from '../../../types/tool';
import { normalizeToolName } from '../../tools/toolNameNormalization';

export type ConversationModeEscalation =
  | Readonly<{ required: false }>
  | Readonly<{
      required: true;
      reason: 'side_effect_capability_discovered' | 'iteration_budget_exhausted';
      /** Tools the turn discovered but chitchat may not call. Bounded for logging. */
      blockedToolNames: ReadonlyArray<string>;
    }>;

const NOT_REQUIRED: ConversationModeEscalation = { required: false };
const MAX_REPORTED_TOOL_NAMES = 6;

function isMemoryResourceTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return (tool?.contract?.resourceKinds ?? []).includes('memory');
}

function isSideEffectfulTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return (tool?.contract?.sideEffects ?? []).some((sideEffect) => sideEffect !== 'none');
}

/**
 * Mirrors the chitchat drop rule in `resolveTurnToolSurface`: a discovered tool that
 * would mutate non-memory state. Keeping the predicate here means the surface can
 * report the escalation without changing what it is allowed to expose.
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
    if (!tool || !isSideEffectfulTool(tool) || isMemoryResourceTool(tool)) {
      continue;
    }
    blockedToolNames.push(toolName);
  }

  if (blockedToolNames.length === 0) {
    return NOT_REQUIRED;
  }

  return {
    required: true,
    reason: 'side_effect_capability_discovered',
    blockedToolNames: blockedToolNames.slice(0, MAX_REPORTED_TOOL_NAMES),
  };
}

/**
 * A chitchat run that exhausts its iteration budget with work still open is the
 * second silent cliff: chitchat has no goal state, so nothing else reports it.
 */
export function detectChitchatBudgetEscalation(params: {
  conversationMode: ConversationMode | undefined;
  iteration: number;
  maxToolIterations: number;
  hasUnfinishedWork: boolean;
}): ConversationModeEscalation {
  if (
    params.conversationMode !== 'chitchat' ||
    !params.hasUnfinishedWork ||
    params.iteration < params.maxToolIterations
  ) {
    return NOT_REQUIRED;
  }

  return {
    required: true,
    reason: 'iteration_budget_exhausted',
    blockedToolNames: [],
  };
}

export function buildConversationModeEscalationDetail(
  escalation: Extract<ConversationModeEscalation, { required: true }>,
): string {
  const tools = escalation.blockedToolNames.join(',');
  return `from:chitchat,to:agentic,reason:${escalation.reason}${tools ? `,tools:${tools}` : ''}`;
}
