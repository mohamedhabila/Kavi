import type { AccessibilityNode, UiControl } from './uiState';

export interface UiVisibleTextSnippet {
  index: number;
  text: string;
  contextLabels: string[];
}

const MAX_VISIBLE_TEXT_SNIPPETS = 64;
const MAX_VISIBLE_TEXT_CHARS = 260;
const TEXT_ROLES = new Set(['statictext', 'text', 'time']);
const TEXT_CONTEXT_ROLES = new Set([
  'article',
  'complementary',
  'dialog',
  'form',
  'group',
  'main',
  'region',
  'section',
  'tabpanel',
]);
const TEXT_BOUNDARY_ROLES = new Set([
  'button',
  'checkbox',
  'columnheader',
  'combobox',
  'grid',
  'gridcell',
  'labeltext',
  'link',
  'menuitem',
  'option',
  'radio',
  'row',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'table',
  'textbox',
]);
const CONTENT_TEXT_PATTERN = /[\p{L}\p{N}]/u;
const PRIVATE_USE_PATTERN = /[\uE000-\uF8FF]/gu;
const ESCAPED_PRIVATE_USE_PATTERN = /\\u[eEfF][0-9a-fA-F]{3}/g;

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const semanticText = normalized
    ?.replace(PRIVATE_USE_PATTERN, '')
    .replace(ESCAPED_PRIVATE_USE_PATTERN, '')
    .trim();
  if (!normalized || !semanticText || !CONTENT_TEXT_PATTERN.test(semanticText)) return null;
  return normalized.length <= MAX_VISIBLE_TEXT_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_VISIBLE_TEXT_CHARS - 1).trimEnd()}\u2026`;
}

function normalizedKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function hasTextBoundaryAncestor(
  nodes: ReadonlyArray<AccessibilityNode>,
  textIndex: number,
): boolean {
  const text = nodes[textIndex];
  if (!text) return true;
  let ancestorIndent = text.indent;
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.indent >= ancestorIndent) continue;
    ancestorIndent = node.indent;
    if (TEXT_BOUNDARY_ROLES.has(node.role.toLocaleLowerCase())) return true;
    if (ancestorIndent === 0) break;
  }
  return false;
}

function contextLabelsForText(
  nodes: ReadonlyArray<AccessibilityNode>,
  textIndex: number,
): string[] {
  const text = nodes[textIndex];
  if (!text) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  let ancestorIndent = text.indent;
  for (let index = textIndex - 1; index >= 0 && labels.length < 4; index -= 1) {
    const node = nodes[index];
    if (node.indent >= ancestorIndent) continue;
    ancestorIndent = node.indent;
    if (TEXT_CONTEXT_ROLES.has(node.role.toLocaleLowerCase())) {
      const label = normalizeText(node.name);
      if (label) {
        const key = normalizedKey(label);
        if (!seen.has(key)) {
          seen.add(key);
          labels.unshift(label);
        }
      }
    }
    if (ancestorIndent === 0) break;
  }
  return labels;
}

function visibleTextDepthScore(nodes: ReadonlyArray<AccessibilityNode>, textIndex: number): number {
  const text = nodes[textIndex];
  if (!text) return Number.MAX_SAFE_INTEGER;
  let nearestContextIndent = 0;
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.indent >= text.indent) continue;
    if (TEXT_CONTEXT_ROLES.has(node.role.toLocaleLowerCase())) {
      nearestContextIndent = node.indent;
      break;
    }
    if (node.indent === 0) break;
  }
  return text.indent - nearestContextIndent;
}

export function extractVisibleTextSnippets(
  nodes: ReadonlyArray<AccessibilityNode>,
  controls: ReadonlyArray<UiControl>,
): UiVisibleTextSnippet[] {
  const controlNameKeys = new Set(
    controls
      .map((control) => normalizeText(control.name))
      .filter((name): name is string => Boolean(name))
      .map(normalizedKey),
  );
  const snippets: UiVisibleTextSnippet[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!TEXT_ROLES.has(node.role.toLocaleLowerCase())) continue;
    if (hasTextBoundaryAncestor(nodes, index)) continue;
    const text = normalizeText(node.name);
    if (!text) continue;
    const key = normalizedKey(text);
    if (seen.has(key) || controlNameKeys.has(key)) continue;
    seen.add(key);
    snippets.push({
      index,
      text,
      contextLabels: contextLabelsForText(nodes, index),
    });
  }

  return snippets
    .sort((left, right) => {
      const depthDelta =
        visibleTextDepthScore(nodes, left.index) - visibleTextDepthScore(nodes, right.index);
      if (depthDelta !== 0) return depthDelta;
      return left.index - right.index;
    })
    .slice(0, MAX_VISIBLE_TEXT_SNIPPETS)
    .sort((left, right) => left.index - right.index);
}
