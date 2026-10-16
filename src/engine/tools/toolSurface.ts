// ---------------------------------------------------------------------------
// Kavi — Turn Tool Surface
// ---------------------------------------------------------------------------
// The tools a model turn sees: the core workbench, the discovery tools and the connected
// integrations' tools that fit up front (integrationToolSurface.ts), then every tool
// the live conversation has called or activated, in the order it first appeared, then the
// run's pins and async monitors. Nothing a conversation brought onto the surface leaves it
// until its messages leave the history window, so the declaration block only ever grows at
// its end: a prompt cache keeps the prefix, and a tool the model used stays callable.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from './toolNameNormalization';
import { UPDATE_PLAN_TOOL_NAME } from './plan-definitions';
import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';
import { SETUP_GUIDE_TOOL_NAME } from './setupGuideDefinition';

/**
 * Turn-1 surface for a general mobile assistant. Discovery still gates the long tail,
 * but the everyday read paths a phone assistant needs most — web lookup plus read-only
 * calendar, contacts, location, and device state — are present from the first turn so
 * an ordinary request does not cost a `tool_catalog` round-trip before it can start.
 * Every promoted native tool is read-only; mutations stay behind discovery and approval.
 *
 * `javascript` is here because exact work is everyday work: with code only in the
 * catalog the model added thirty amounts by hand and got them wrong (ledger 0/4, all
 * three arithmetic long tasks 7/12); with its schema on the surface it computed them
 * (12/12) at about a tenth more tokens. It still asks for approval before it runs.
 */
export const DEFAULT_CORE_TOOL_ORDER = [
  REQUEST_CLARIFICATION_TOOL_NAME,
  UPDATE_PLAN_TOOL_NAME,
  SETUP_GUIDE_TOOL_NAME,
  'memory_remember',
  'memory_search',
  'memory_forget',
  'read_file',
  'write_file',
  'list_files',
  'sessions_spawn',
  'wait',
  'cron',
  'reminder',
  'web_search',
  'web_fetch',
  'calendar_events',
  'contacts_search',
  'location_current',
  'device_query',
  'javascript',
] as const;

export const DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  DEFAULT_CORE_TOOL_ORDER,
);

/** How the model loads any registered tool the surface does not carry yet. */
const DISCOVERY_TOOL_ORDER = ['tool_catalog', 'tool_describe'] as const;

type PromptCachePlacement = Exclude<
  NonNullable<ToolDefinition['promptCache']>['placement'],
  undefined
>;

function withPromptCachePlacement(
  tool: ToolDefinition,
  placement: PromptCachePlacement,
): ToolDefinition {
  if (tool.promptCache?.placement === placement) {
    return tool;
  }
  return {
    ...tool,
    promptCache: {
      ...tool.promptCache,
      placement,
    },
  };
}

export interface ResolveTurnToolSurfaceParams {
  allTools: ReadonlyArray<ToolDefinition>;
  /** Tools the live conversation called or activated, in the order they first appeared. */
  conversationToolNames: ReadonlyArray<string>;
  pendingAsyncMonitorToolNames?: ReadonlySet<string>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  /** Connected integrations' tools declared from the first turn, in a stable order. */
  upfrontToolNames?: ReadonlyArray<string>;
}

export function resolveTurnToolSurface(params: ResolveTurnToolSurfaceParams): ToolDefinition[] {
  const toolByName = new Map(
    params.allTools
      .map((tool): [string, ToolDefinition] => [normalizeToolName(tool.name), tool])
      .filter(([toolName]) => Boolean(toolName)),
  );
  const surface = new Map<string, ToolDefinition>();
  const add = (toolNames: Iterable<string>) => {
    for (const toolName of toolNames) {
      const normalized = normalizeToolName(toolName);
      const tool = toolByName.get(normalized);
      if (tool && !surface.has(normalized)) {
        surface.set(normalized, tool);
      }
    }
  };

  add(DEFAULT_CORE_TOOL_ORDER);
  add(DISCOVERY_TOOL_ORDER);
  add(params.upfrontToolNames ?? []);
  // The prefix every turn shares; a provider cache breakpoint after it never moves, so a call
  // whose later tools changed still reads it.
  const stablePrefixLength = surface.size;
  // Only grows at its end, so an added tool leaves every earlier declaration where it was.
  add(params.conversationToolNames);
  add(params.explicitToolSurfaceToolNames ?? []);
  add(params.pendingAsyncMonitorToolNames ?? []);

  return Array.from(surface.values()).map((tool, index) =>
    withPromptCachePlacement(tool, index < stablePrefixLength ? 'stable_prefix' : 'dynamic_suffix'),
  );
}
