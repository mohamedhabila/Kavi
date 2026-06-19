export type ToolNameLike = {
  name?: string;
};

export function buildDeclaredToolNameSet(
  tools: ReadonlyArray<ToolNameLike> | undefined,
): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  for (const tool of tools ?? []) {
    const name = typeof tool.name === 'string' ? tool.name.trim() : '';
    if (name) {
      names.add(name);
    }
  }
  return names.size > 0 ? names : undefined;
}

export function isDeclaredToolName(
  name: string,
  declaredToolNames: ReadonlySet<string> | undefined,
): boolean {
  if (!declaredToolNames || declaredToolNames.size === 0) {
    return true;
  }
  return declaredToolNames.has(name.trim());
}
