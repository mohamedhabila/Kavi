import type { AccessibilityNode } from './uiState';

type JsonRecord = Record<string, unknown>;

export interface UiLabelValue {
  label: string;
  value: string;
  sourceIndex: number;
  contextLabels: string[];
  nearbyTextBefore: string[];
}

const CONTEXT_LABEL_ROLES = new Set([
  'article',
  'complementary',
  'group',
  'heading',
  'main',
  'navigation',
  'region',
  'section',
  'strong',
]);

const MAX_LABEL_VALUE_ITEMS = 36;
const MAX_LABEL_VALUE_CONTEXT_ITEMS = 8;
const REQUIRED_MARKER = '*';

export function extractLabelValues(nodes: AccessibilityNode[]): UiLabelValue[] {
  const out: UiLabelValue[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const label = nodes[index];
    if (!label.name || !label.name.trim().endsWith(':')) continue;
    const labelText = label.name.trim().slice(0, -1).trim();
    if (!labelText) continue;
    const value = findFollowingValue(nodes, index, label.indent);
    if (!value) continue;
    out.push({
      label: labelText,
      value: value.text,
      sourceIndex: label.index,
      contextLabels: findContextLabels(nodes, index),
      nearbyTextBefore: nearbyTextBefore(nodes, index, label.indent),
    });
    if (out.length >= MAX_LABEL_VALUE_ITEMS) break;
  }
  return out;
}

export function compactLabelValue(labelValue: UiLabelValue): JsonRecord {
  return dropEmpty({
    label: labelValue.label,
    value: labelValue.value,
    sourceIndex: labelValue.sourceIndex,
    contextLabels: labelValue.contextLabels.length > 0 ? labelValue.contextLabels : undefined,
    nearbyTextBefore:
      labelValue.nearbyTextBefore.length > 0 ? labelValue.nearbyTextBefore : undefined,
  });
}

interface LabelValueMatch {
  text: string;
  index: number;
}

function findFollowingValue(
  nodes: AccessibilityNode[],
  startIndex: number,
  labelIndent: number,
): LabelValueMatch | null {
  for (let index = startIndex + 1; index < Math.min(nodes.length, startIndex + 12); index += 1) {
    const node = nodes[index];
    if (node.indent < labelIndent) break;
    if (!node.name) continue;
    if (node.name.trim() === REQUIRED_MARKER) continue;
    if (node.name.trim().endsWith(':')) continue;
    return { text: node.name.trim(), index };
  }
  return null;
}

function findContextLabels(nodes: AccessibilityNode[], nodeIndex: number): string[] {
  const current = nodes[nodeIndex];
  if (!current) return [];
  const labels: string[] = [];
  const seen = new Set<string>();

  const addLabel = (value: string | null | undefined): void => {
    const normalized = normalizeLabelText(value ? [value] : []);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    labels.push(normalized);
  };

  let ancestorIndent = current.indent;
  for (let index = nodeIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.indent >= ancestorIndent) continue;
    ancestorIndent = node.indent;
    if (CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) addLabel(node.name);
    if (ancestorIndent === 0) break;
  }

  const lowerBound = Math.max(0, nodeIndex - 32);
  for (let index = nodeIndex - 1; index >= lowerBound && labels.length < 6; index -= 1) {
    const node = nodes[index];
    if (node.indent > current.indent) continue;
    if (!CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) continue;
    addLabel(node.name);
  }

  return labels.slice(0, 6);
}

function nearbyTextBefore(
  nodes: AccessibilityNode[],
  labelIndex: number,
  labelIndent: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let index = labelIndex - 1;
    index >= 0 && out.length < MAX_LABEL_VALUE_CONTEXT_ITEMS;
    index -= 1
  ) {
    const node = nodes[index];
    if (node.indent < labelIndent) break;
    addNearbyNodeText(nodes, index, seen, out);
  }
  return out.reverse();
}

function addNearbyNodeText(
  nodes: AccessibilityNode[],
  index: number,
  seen: Set<string>,
  out: string[],
): void {
  const text = nodeText(nodes, index);
  if (!text || text === REQUIRED_MARKER || text.endsWith(':') || seen.has(text)) return;
  seen.add(text);
  out.push(text);
}

function nodeText(nodes: AccessibilityNode[], index: number): string | null {
  const node = nodes[index];
  if (!node) return null;
  const parts: string[] = [];
  if (node.name) parts.push(node.name);
  for (let childIndex = index + 1; childIndex < nodes.length; childIndex += 1) {
    const child = nodes[childIndex];
    if (child.indent <= node.indent) break;
    if (child.name) parts.push(child.name);
    if (parts.join(' ').length >= 220) break;
  }
  const text = normalizeLabelText(parts);
  return text ? fitText(text, 220) : null;
}

function normalizeLabelText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part && part !== REQUIRED_MARKER)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dropEmpty(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''),
  );
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
