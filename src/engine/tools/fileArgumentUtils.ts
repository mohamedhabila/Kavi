export interface ToolArgResult<T> {
  value?: T;
  error?: string;
}

export function requireToolStringArg(
  args: Record<string, unknown> | null | undefined,
  field: string,
  toolName: string,
  options: { allowEmpty?: boolean; allRequired?: string[] } = {},
): ToolArgResult<string> {
  const value = args?.[field];

  if (typeof value !== 'string') {
    const receivedKeys = args ? Object.keys(args) : [];
    const keysInfo =
      receivedKeys.length > 0
        ? ` Received keys: [${receivedKeys.join(', ')}]`
        : ' Received: no arguments';
    const requiredInfo = options.allRequired?.length
      ? ` Required parameters: [${options.allRequired.join(', ')}].`
      : '';
    // Include a clear hint about what was wrong so the model can self-correct
    const wrongNameHint =
      receivedKeys.length > 0 ? ` Check parameter names — use "${field}" exactly.` : '';
    return {
      error: `Error: "${field}" is required for ${toolName} and must be a string.${keysInfo}${requiredInfo}${wrongNameHint} Do NOT retry with the same arguments.`,
    };
  }

  if (!options.allowEmpty && !value.trim()) {
    return {
      error: `Error: "${field}" is required for ${toolName} and must not be empty. Do NOT retry with the same arguments.`,
    };
  }

  return { value };
}

export function getOptionalToolStringArg(
  args: Record<string, unknown> | null | undefined,
  field: string,
  toolName: string,
): ToolArgResult<string | undefined> {
  const value = args?.[field];

  if (value == null) {
    return { value: undefined };
  }

  if (typeof value !== 'string') {
    return { error: `Error: "${field}" for ${toolName} must be a string when provided` };
  }

  return { value };
}

export function getOptionalToolBooleanArg(
  args: Record<string, unknown> | null | undefined,
  field: string,
  toolName: string,
): ToolArgResult<boolean | undefined> {
  const value = args?.[field];

  if (value == null) {
    return { value: undefined };
  }

  if (typeof value !== 'boolean') {
    return { error: `Error: "${field}" for ${toolName} must be a boolean when provided` };
  }

  return { value };
}

export function sanitizeWorkspaceRelativePath(inputPath: string): string {
  let normalized = inputPath;
  try {
    normalized = decodeURIComponent(inputPath);
  } catch {
    normalized = inputPath;
  }

  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.replace(/\0/g, '');

  let previous = '';
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized.replace(/\.\.\//g, '').replace(/\.\.$/g, '');
  }

  normalized = normalized.replace(/^\/+/, '');
  return normalized.trim();
}
