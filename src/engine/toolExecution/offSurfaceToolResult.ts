import { TOOL_CATALOG_TOOL } from '../tools/builtin-definitions-coordination';

/**
 * Result content for a tool call that names a tool registered for this run but absent
 * from the current turn's surface.
 *
 * Saying only that a tool "is not allowed" states a fact with no legal next move, so
 * the model's cheapest remaining option is to try the same call again. Traced live: a
 * tool that had already returned successfully was evicted under tool-budget pressure,
 * and the identical call was then rejected four more times before the model attempted
 * discovery unprompted. Naming the recovery is what ends that, exactly as returning the
 * current goal list alongside a rejected `update_goals` ended the equivalent loop in the
 * graph layer.
 */
export function buildOffSurfaceToolResult(toolName: string): string {
  return (
    `Tool "${toolName}" is registered for this run but is not on the current turn's ` +
    `tool surface, so it cannot be called right now. Repeating this call unchanged ` +
    `will be rejected the same way. Use \`${TOOL_CATALOG_TOOL.name}\` to bring the ` +
    `capability back onto the surface, or continue with a tool that is already available.`
  );
}
