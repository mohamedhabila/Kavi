type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** Namespaced tools registered at runtime: `mcp__<server>__<tool>`, `skill__<pack>__<tool>`. */
const DYNAMIC_TOOL_NAMESPACE_SEPARATOR = '__';

/**
 * The name a person sees for a tool step: its localized `toolCall.tools.<name>` entry.
 *
 * Every registered tool has one (enforced by `toolNameCoverage.test.ts`). The fallback
 * formats the identifier of a tool added at runtime — an MCP server or an installed
 * skill — whose own name is its last namespace segment; the server or pack id is not
 * what the step does.
 */
export function humanizeToolName(name: string, t?: TranslateFn): string {
  const key = `toolCall.tools.${name}`;
  const translated = t ? t(key) : key;
  if (translated && translated !== key) {
    return translated;
  }
  const ownName = name.split(DYNAMIC_TOOL_NAMESPACE_SEPARATOR).filter(Boolean).pop() ?? name;
  return ownName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
