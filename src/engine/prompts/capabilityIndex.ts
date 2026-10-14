// ---------------------------------------------------------------------------
// Kavi — Capability Index
// ---------------------------------------------------------------------------
// Progressive tool disclosure keeps the per-turn surface small, but it also hides
// what the device can do. Without an index the model cannot distinguish "no such
// capability" from "not exposed this turn", and answers from parametric knowledge
// instead of reaching for discovery. This renders a bounded, code-owned index of
// the capability domains that exist in this run.
//
// The index is run-constant by design: it heads the cacheable prompt prefix, so it
// must not vary with the current turn's tool surface.
//
// Derived from the run's own tool list, so it can never advertise a capability the
// user has not configured, and grouped by each tool's declared contract category, so a
// new tool is listed by what it is rather than by a hand-kept name list.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { inferToolCapabilityDescriptor } from '../tools/capabilityRegistry';
import { normalizeToolName } from '../tools/toolNameNormalization';

/**
 * Domains listed before the index is truncated. The built-in contracts declare about 30
 * categories and MCP and skill tools add one each, so a full run fits; the cap only bounds
 * the prompt if the vocabulary grows.
 */
export const MAX_CAPABILITY_INDEX_CATEGORIES = 40;

const EXCLUDED_CATEGORIES = new Set(['other']);
const DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

/**
 * Deliberately independent of the current turn's surface.
 *
 * This section is the first thing in the system prompt and is declared cacheable, so
 * its bytes are the head of the prompt cache prefix. Subtracting the exposed tools
 * made it change on every activation, which invalidated the cache from byte zero of
 * every request — the index meant to save discovery round-trips was costing a full
 * uncached prompt each time discovery succeeded. The set of capabilities available in
 * a run does not change, so listing all of them keeps the prefix byte-identical for
 * the whole run. The few already-exposed names it now repeats are far cheaper than
 * the re-billed prompt they replace.
 */
function collectAvailableToolsByCategory(
  allTools: ReadonlyArray<ToolDefinition>,
): Map<string, string[]> {
  const byCategory = new Map<string, string[]>();

  for (const tool of allTools) {
    const toolName = normalizeToolName(tool.name);
    if (!toolName || DISCOVERY_TOOL_NAMES.has(toolName)) {
      continue;
    }

    const category = inferToolCapabilityDescriptor(tool).category;
    if (!category || EXCLUDED_CATEGORIES.has(category)) {
      continue;
    }

    const signature = renderToolSignature(toolName, tool);
    const existing = byCategory.get(category);
    if (existing) {
      existing.push(signature);
      continue;
    }
    byCategory.set(category, [signature]);
  }

  return byCategory;
}

/**
 * A tool's name with the arguments it requires. A tool off the turn's surface is called by
 * name from this index, and with only a name the model guessed the arguments: Claude Sonnet
 * 5.5 sent sms_compose `to` and `body` for `recipients` and `message`, and needed a second call.
 */
function renderToolSignature(toolName: string, tool: ToolDefinition): string {
  const required = Array.isArray(tool.input_schema?.required)
    ? tool.input_schema.required.filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      )
    : [];
  return required.length > 0 ? `${toolName}(${required.join(', ')})` : toolName;
}

/**
 * Every tool of the domain by name. Two names and a count hid the ones a task needed:
 * "calendar: calendar_list, calendar_events, +2 more" left GLM 5.3 Flash no way to know
 * calendar_create_event existed, so it told the person the event was added without making
 * it. Any registered tool can be called by name, so a listed name is one call away; all
 * names cost about 430 more tokens, in the cached prefix.
 */
function renderCategoryLine(
  catalogCategory: string,
  toolSignatures: ReadonlyArray<string>,
): string {
  return `- ${catalogCategory}: ${toolSignatures.join(', ')}`;
}

/**
 * Returns an empty string when the run exposes no categorized capability, so a bare
 * surface does not spend tokens on an empty heading.
 */
export function buildCapabilityIndexPromptSection(params: {
  allTools: ReadonlyArray<ToolDefinition>;
}): string {
  const byCategory = collectAvailableToolsByCategory(params.allTools);
  if (byCategory.size === 0) {
    return '';
  }

  const orderedCategories = Array.from(byCategory.keys()).sort();
  const shownCategories = orderedCategories.slice(0, MAX_CAPABILITY_INDEX_CATEGORIES);
  const omittedCategoryCount = orderedCategories.length - shownCategories.length;

  const lines = [
    '## Capability Index',
    'Available this run, each with its required arguments. A tool named here can be called',
    'directly; for anything else, search tool_catalog for what you need to do. Search before',
    'saying something is unavailable.',
    ...shownCategories.map((category) =>
      renderCategoryLine(category, byCategory.get(category) ?? []),
    ),
  ];
  if (omittedCategoryCount > 0) {
    lines.push(
      `- ${omittedCategoryCount} further categories; search tool_catalog for what you need.`,
    );
  }

  return lines.join('\n');
}
