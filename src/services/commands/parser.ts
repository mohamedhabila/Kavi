// ---------------------------------------------------------------------------
// Kavi — Slash Command Parser
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  name: string;
  args: string;
  raw: string;
}

function normalizeCommandInput(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }

  return input;
}

export function isSlashCommand(input: unknown): boolean {
  const normalizedInput = normalizeCommandInput(input);
  if (!normalizedInput) {
    return false;
  }

  return normalizedInput.trimStart().startsWith('/');
}

export function parseCommand(input: unknown): ParsedCommand | null {
  const normalizedInput = normalizeCommandInput(input);
  if (!normalizedInput) {
    return null;
  }

  const trimmed = normalizedInput.trimStart();
  if (!trimmed.startsWith('/')) return null;

  const match = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/s);
  if (!match) return null;

  return {
    name: match[1].toLowerCase(),
    args: (match[2] ?? '').trim(),
    raw: normalizedInput,
  };
}
