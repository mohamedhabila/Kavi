export function getErrorMessageWithCauses(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  while (current) {
    const message = current instanceof Error ? current.message.trim() : String(current).trim();
    if (message && !messages.includes(message)) {
      messages.push(message);
    }

    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }

    break;
  }

  return messages.join(' -> ');
}
