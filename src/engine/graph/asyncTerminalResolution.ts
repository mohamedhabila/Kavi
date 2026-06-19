const ASYNC_TERMINAL_RESULT_STATUSES = new Set([
  'completed',
  'complete',
  'success',
  'succeeded',
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
  'timeout',
  'timed_out',
]);

type AsyncTerminalToolMessage = {
  content?: string;
  isError?: boolean;
};

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function agentControlGraphToolMessageShowsAsyncTerminalResolution(
  toolMessage: AsyncTerminalToolMessage,
): boolean {
  if (toolMessage.isError) {
    return false;
  }

  const parsed = parseJsonRecord(toolMessage.content);
  if (!parsed) {
    return false;
  }

  const status = typeof parsed.status === 'string' ? parsed.status.trim().toLowerCase() : '';
  if (ASYNC_TERMINAL_RESULT_STATUSES.has(status)) {
    return true;
  }

  const pendingCount = typeof parsed.pendingCount === 'number' ? parsed.pendingCount : undefined;
  const completedCount =
    typeof parsed.completedCount === 'number' ? parsed.completedCount : undefined;
  const failedCount = typeof parsed.failedCount === 'number' ? parsed.failedCount : undefined;
  return pendingCount === 0 && Boolean((completedCount ?? 0) > 0 || (failedCount ?? 0) > 0);
}
