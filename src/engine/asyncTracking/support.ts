import type { AsyncOperationKind, TrackedAsyncOperation } from './types';

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractStringArg(argumentsText: string, key: string): string | undefined {
  const parsedArgs = parseJsonRecord(argumentsText);
  const value = typeof parsedArgs?.[key] === 'string' ? String(parsedArgs[key]).trim() : '';
  return value || undefined;
}

export function buildTrackedAsyncOperationKey(
  kind: AsyncOperationKind,
  resourceId: string,
): string {
  return `${kind}:${resourceId}`;
}

export function uniqueToolNames(toolNames: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(toolNames).filter(Boolean)));
}

function cloneAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return { ...value };
}

export function cloneTrackedAsyncOperation(
  operation: TrackedAsyncOperation,
): TrackedAsyncOperation {
  return {
    ...operation,
    monitorToolNames: [...operation.monitorToolNames],
    ...(operation.statusArgs ? { statusArgs: cloneAsyncOperationArgs(operation.statusArgs) } : {}),
    ...(operation.waitArgs ? { waitArgs: cloneAsyncOperationArgs(operation.waitArgs) } : {}),
  };
}
