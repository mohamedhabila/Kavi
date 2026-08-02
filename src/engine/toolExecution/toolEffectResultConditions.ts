export interface ToolEffectResultCondition {
  readonly resultPath: readonly string[];
  readonly values: readonly string[];
}

function readResultPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function toolEffectResultConditionsMatch(
  result: Record<string, unknown>,
  conditions: readonly ToolEffectResultCondition[] | undefined,
): boolean {
  return Boolean(
    conditions?.length &&
    conditions.every((condition) => {
      const value = readResultPath(result, condition.resultPath);
      return typeof value === 'string' && condition.values.includes(value);
    }),
  );
}
