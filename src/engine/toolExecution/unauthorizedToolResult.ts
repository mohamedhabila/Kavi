/**
 * Result content for a tool call the run is not permitted to make.
 *
 * This is a permission boundary — a delegated worker's `tools` grant, or a conversation
 * mode that exists so casual chat cannot mutate state. It is no longer reached merely
 * because a turn did not advertise the tool: a registered, permitted call now executes
 * whenever it is made, because which capability a task needs is not knowable before the
 * work is under way.
 *
 * So this message must not offer discovery. `tool_catalog` cannot widen a permission set,
 * and the previous wording sent the model to a recovery that could not apply — traced
 * live as alternating rejected calls and useless discovery calls until the run's iteration
 * budget was gone. Saying plainly that the boundary is fixed, and that reporting the
 * limitation is a legitimate outcome, is the only honest guidance available.
 */
export function buildUnauthorizedToolResult(toolName: string): string {
  return (
    `Tool "${toolName}" is not permitted in this run, so it cannot be called. This is a ` +
    `permission boundary rather than a temporary state: repeating the call, or trying to ` +
    `discover the tool, will not change it. Use a capability that is available, or say ` +
    `what you cannot do and why.`
  );
}
