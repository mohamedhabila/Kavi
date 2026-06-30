export interface AccessibilityNode {
  index: number;
  nodeId: string | null;
  indent: number;
  role: string;
  name: string | null;
  attributes: string[];
}

const MAX_ACCESSIBILITY_NODE_NAME_CHARS = 520;
const MAX_PARSED_ACCESSIBILITY_NODES = 2_500;

export function parseAccessibilityTree(tree: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  const lines = tree.split(/\r?\n/);
  for (const rawLine of lines) {
    if (nodes.length >= MAX_PARSED_ACCESSIBILITY_NODES) break;
    const parsed = parseAccessibilityLine(rawLine, nodes.length);
    if (parsed) nodes.push(parsed);
  }
  return nodes;
}

function parseAccessibilityLine(rawLine: string, index: number): AccessibilityNode | null {
  if (!rawLine.trim()) return null;
  const indent = rawLine.match(/^\s*/)?.[0]?.length ?? 0;
  const line = rawLine.trim();
  const idMatch = line.match(/^\[([^\]]+)\]/);
  const withoutId = line.replace(/^\[[^\]]+\]\s*/, '');
  const firstQuote = firstQuoteIndex(withoutId);
  const roleRaw =
    firstQuote >= 0 ? withoutId.slice(0, firstQuote).trim() : withoutId.split(',')[0]?.trim();
  const roleHead = roleRaw ?? '';
  const role = roleHead.replace(/\s+/g, '_');
  if (!role) return null;
  const name = firstQuote >= 0 ? readQuotedValue(withoutId, firstQuote) : null;
  const afterName =
    firstQuote >= 0 && name !== null
      ? withoutId.slice(firstQuote + name.length + 2)
      : withoutId.slice(roleHead.length);
  const attributes = splitAttributes(afterName).slice(0, 16);
  return {
    index,
    nodeId: idMatch?.[1] ?? null,
    indent,
    role: fitText(role, 80),
    name: name ? fitText(name, MAX_ACCESSIBILITY_NODE_NAME_CHARS) : null,
    attributes,
  };
}

function firstQuoteIndex(value: string): number {
  const single = value.indexOf("'");
  const double = value.indexOf('"');
  if (single < 0) return double;
  if (double < 0) return single;
  return Math.min(single, double);
}

function readQuotedValue(value: string, quoteIndex: number): string | null {
  const quote = value[quoteIndex];
  const end = value.indexOf(quote, quoteIndex + 1);
  if (end <= quoteIndex) return null;
  return value.slice(quoteIndex + 1, end);
}

function splitAttributes(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
