// ---------------------------------------------------------------------------
// Kavi — Capability Index
// ---------------------------------------------------------------------------
// Progressive tool disclosure keeps the per-turn surface small, but it also hides
// what the device can do. Without an index the model cannot distinguish "no such
// capability" from "not exposed this turn", and answers from parametric knowledge
// instead of reaching for discovery. This renders a bounded, code-owned index of
// the domains that exist in this run but are not currently on the surface.
//
// Derived from the run's own tool list, so it can never advertise a capability the
// user has not configured.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import {
  getToolManagerCategoryForToolName,
  mapDeferredCategoryToToolCatalogCategory,
} from '../tools/toolManagerCategories';
import { normalizeToolName } from '../tools/toolNameNormalization';

/** Domains listed before the index is truncated. */
export const MAX_CAPABILITY_INDEX_CATEGORIES = 14;
/** Tool names shown per domain; the rest are summarized as a count. */
export const MAX_CAPABILITY_INDEX_TOOLS_PER_CATEGORY = 2;

const EXCLUDED_CATEGORIES = new Set(['other', 'tools']);
const DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

function collectUnexposedToolsByCategory(
  allTools: ReadonlyArray<ToolDefinition>,
  selectedToolNames: ReadonlySet<string>,
): Map<string, string[]> {
  const byCategory = new Map<string, string[]>();

  for (const tool of allTools) {
    const toolName = normalizeToolName(tool.name);
    if (!toolName || DISCOVERY_TOOL_NAMES.has(toolName) || selectedToolNames.has(toolName)) {
      continue;
    }

    const managerCategory = getToolManagerCategoryForToolName(toolName);
    if (EXCLUDED_CATEGORIES.has(managerCategory)) {
      continue;
    }
    const catalogCategory = mapDeferredCategoryToToolCatalogCategory(managerCategory);
    if (!catalogCategory) {
      continue;
    }

    const existing = byCategory.get(catalogCategory);
    if (existing) {
      existing.push(toolName);
      continue;
    }
    byCategory.set(catalogCategory, [toolName]);
  }

  return byCategory;
}

function renderCategoryLine(catalogCategory: string, toolNames: ReadonlyArray<string>): string {
  const shown = toolNames.slice(0, MAX_CAPABILITY_INDEX_TOOLS_PER_CATEGORY);
  const remaining = toolNames.length - shown.length;
  const suffix = remaining > 0 ? `, +${remaining} more` : '';
  return `- ${catalogCategory}: ${shown.join(', ')}${suffix}`;
}

/**
 * Returns an empty string when nothing is hidden, so a fully exposed surface does
 * not spend tokens restating what the model can already see.
 */
export function buildCapabilityIndexPromptSection(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  selectedToolNames: ReadonlySet<string>;
}): string {
  const byCategory = collectUnexposedToolsByCategory(params.allTools, params.selectedToolNames);
  if (byCategory.size === 0) {
    return '';
  }

  const orderedCategories = Array.from(byCategory.keys()).sort();
  const shownCategories = orderedCategories.slice(0, MAX_CAPABILITY_INDEX_CATEGORIES);
  const omittedCategoryCount = orderedCategories.length - shownCategories.length;

  const lines = [
    '## Capability Index',
    'Available this run but not on this turn’s surface. Expose one with tool_catalog using the',
    'category shown, then call it. Never call a listed capability unavailable without trying that.',
    ...shownCategories.map((category) =>
      renderCategoryLine(category, byCategory.get(category) ?? []),
    ),
  ];
  if (omittedCategoryCount > 0) {
    lines.push(
      `- ${omittedCategoryCount} further categories; call tool_catalog with no arguments to list them.`,
    );
  }

  return lines.join('\n');
}
