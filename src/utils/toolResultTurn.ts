type RoleMessage = { readonly role: string };

/**
 * Whether the user message at `index` directly follows tool results. Provider adapters
 * send such a message inside the tool-result turn (Anthropic merges it into the user
 * message that carries the tool results), so it continues the tool loop instead of
 * opening a new turn. A message that steered a running run arrives this way.
 */
export function continuesToolResultTurn(
  messages: ReadonlyArray<RoleMessage>,
  index: number,
): boolean {
  if (messages[index]?.role !== 'user') return false;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const role = messages[candidate]?.role;
    if (role === 'system' || role === 'user') continue;
    return role === 'tool';
  }
  return false;
}
