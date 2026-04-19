// ---------------------------------------------------------------------------
// Kavi — Tool Result Error Helpers
// ---------------------------------------------------------------------------

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isToolResultErrorLike(result: string | undefined): boolean {
  if (typeof result !== 'string') {
    return false;
  }

  const trimmed = result.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(Error:|Blocked:)/i.test(trimmed)) {
    return true;
  }

  if (!trimmed.startsWith('{')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainRecord(parsed)) {
      return false;
    }

    if (parsed.isError === true) {
      return true;
    }

    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return true;
    }

    if (typeof parsed.status === 'string' && parsed.status.trim().toLowerCase() === 'error') {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
