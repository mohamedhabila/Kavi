// ---------------------------------------------------------------------------
// Kavi — Tool Name Normalization
// ---------------------------------------------------------------------------
// Runtime dispatch records the surfaced name. Structural registry resolution
// maps delimiter-separated aliases (e.g. provider:tool) to registered builtins.

import type { ToolDefinition } from '../../types/tool';
import { TOOL_DEFINITIONS } from './definitions';

export function normalizeToolName(name: string): string {
  return name.trim();
}

export function normalizeToolNameList(toolNames: ReadonlyArray<string> | undefined): string[] {
  return Array.from(
    new Set((toolNames ?? []).map((toolName) => normalizeToolName(toolName)).filter(Boolean)),
  );
}

let registeredToolNames: Set<string> | null = null;

function getRegisteredToolNames(): Set<string> {
  if (!registeredToolNames) {
    registeredToolNames = new Set(
      TOOL_DEFINITIONS.filter((tool): tool is ToolDefinition => Boolean(tool?.name)).map((tool) =>
        normalizeToolName(tool.name),
      ),
    );
  }
  return registeredToolNames;
}

/**
 * Resolve a model-emitted tool name to a registered builtin when a
 * colon-delimited segment matches the tool registry (structural — no NL).
 */
export function resolveRegisteredToolName(name: string): string {
  const registry = getRegisteredToolNames();
  const trimmed = normalizeToolName(name);
  if (registry.has(trimmed)) {
    return trimmed;
  }

  const segments = trimmed
    .split(':')
    .map((segment) => normalizeToolName(segment))
    .filter(Boolean);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = segments[index]!;
    if (registry.has(candidate)) {
      return candidate;
    }
  }

  return trimmed;
}

export function isRegisteredToolName(name: string): boolean {
  return getRegisteredToolNames().has(resolveRegisteredToolName(name));
}
