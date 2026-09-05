import { TOOL_DEFINITIONS } from './definitions';
import { normalizeToolName } from './toolNameNormalization';

/**
 * Indexes each tool's declared runtime requirements once.
 *
 * Kept separate from the availability resolver so that module depends on tool
 * declarations rather than on a list of tool names it has to be edited to extend.
 *
 * Code-owned service skill tools (`skill__weather__current`, `skill__github__repos`,
 * ...) are already present here: `TOOL_DEFINITIONS` aggregates
 * `createCodeOwnedServiceToolDefinitions()` (see `engine/tools/domains/index.ts`), which
 * builds those tools' contracts from the same skill declarations the runtime registry
 * uses — so a secret-gated skill tool is gated the moment its skill file declares the
 * requirement, with no separate dynamic lookup needed.
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
