import type { ToolDefinition } from '../../types/tool';

function unique<T>(values: Iterable<T | undefined | null>): T[] {
  return Array.from(new Set(Array.from(values).filter((value): value is T => value != null)));
}

export function hasExplicitToolContract(tool: Pick<ToolDefinition, 'contract'>): boolean {
  return Boolean(tool.contract);
}

export function normalizeExplicitToolContractList<T extends string>(
  values: ReadonlyArray<string> | undefined,
  allowed: ReadonlySet<string>,
): T[] {
  return unique(
    (values ?? []).map((value) => {
      const normalized = value?.trim();
      if (!normalized || !allowed.has(normalized)) {
        return undefined;
      }
      return normalized as T;
    }),
  );
}

export function normalizeExplicitToolContractValue<T extends string>(
  value: string | undefined,
  allowed: ReadonlySet<string>,
): T | undefined {
  const normalized = value?.trim();
  if (!normalized || !allowed.has(normalized)) {
    return undefined;
  }
  return normalized as T;
}
