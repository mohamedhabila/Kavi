import { TOOL_DEFINITIONS } from './definitions';
import { normalizeToolName } from './toolNameNormalization';

/**
 * Indexes each tool's declared runtime requirements once.
 *
 * Kept separate from the availability resolver so that module depends on tool
 * declarations rather than on a list of tool names it has to be edited to extend.
 */
const REQUIREMENTS_BY_TOOL_NAME: ReadonlyMap<string, readonly string[]> = new Map(
  TOOL_DEFINITIONS.filter((tool) => (tool.contract?.runtimeRequirements ?? []).length > 0).map(
    (tool) =>
      [
        normalizeToolName(tool.name),
        Object.freeze([...(tool.contract?.runtimeRequirements ?? [])]),
      ] as const,
  ),
);

const NO_REQUIREMENTS: readonly string[] = Object.freeze([]);

export function resolveToolRuntimeRequirements(toolName: string): readonly string[] {
  return REQUIREMENTS_BY_TOOL_NAME.get(normalizeToolName(toolName)) ?? NO_REQUIREMENTS;
}
