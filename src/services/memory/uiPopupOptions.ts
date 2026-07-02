import { type AccessibilityNode } from './accessibilityTree';
import { isInteractiveUiNode } from './uiInteractivity';

export interface UiPopupOption {
  name: string;
  role: string;
}

const OPTION_ROLES = new Set(['option']);
const POPUP_BOUNDARY_FIELD_ROLES = new Set([
  'checkbox',
  'combobox',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);
const MAX_CONTROL_OPTIONS = 48;
const MAX_DETACHED_POPUP_SCAN_NODES = 1_500;

export function extractPopupOptions(
  nodes: AccessibilityNode[],
  controlIndex: number,
): UiPopupOption[] {
  const control = nodes[controlIndex];
  if (!control) return [];
  const tabItems = siblingTabItems(nodes, controlIndex);
  if (tabItems.length > 0) return tabItems;
  const out: UiPopupOption[] = [];
  const seen = new Set<string>();
  const hasPopup =
    hasAttributeFlag(control.attributes, 'hasPopup') ||
    attributeValue(control.attributes, 'expanded') !== null;
  const isExpandedOpen =
    attributeValue(control.attributes, 'expanded')?.toLocaleLowerCase() === 'true';
  const ownSubtreeEnd = subtreeEndIndex(nodes, controlIndex);
  collectPopupNames(nodes, controlIndex + 1, ownSubtreeEnd, hasPopup, seen, out);
  if (!hasPopup || out.length > 0 || !isExpandedOpen) return out;

  for (let index = ownSubtreeEnd; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent < control.indent) break;
    if (node.indent <= control.indent && node.role === 'LabelText') break;
    if (
      node.indent <= control.indent &&
      POPUP_BOUNDARY_FIELD_ROLES.has(node.role.toLocaleLowerCase())
    ) {
      break;
    }
    if (node.indent !== control.indent) continue;
    const siblingEnd = subtreeEndIndex(nodes, index);
    const before = out.length;
    collectPopupNames(nodes, index, siblingEnd, hasPopup, seen, out, false);
    if (out.length > before || out.length >= MAX_CONTROL_OPTIONS) break;
    index = siblingEnd - 1;
  }
  if (out.length === 0) collectDetachedListboxNames(nodes, controlIndex, seen, out);
  return out;
}

function siblingTabItems(nodes: AccessibilityNode[], controlIndex: number): UiPopupOption[] {
  const control = nodes[controlIndex];
  if (!control || control.role.toLocaleLowerCase() !== 'tab') return [];
  const parentIndex = nearestAncestorWithRole(nodes, controlIndex, 'tablist');
  if (parentIndex === null) return [];
  const parent = nodes[parentIndex];
  const endIndex = subtreeEndIndex(nodes, parentIndex);
  const out: UiPopupOption[] = [];
  const seen = new Set<string>();
  for (let index = parentIndex + 1; index < endIndex; index += 1) {
    const node = nodes[index];
    if (node.indent <= parent.indent) break;
    if (node.role.toLocaleLowerCase() !== 'tab') continue;
    const name = node.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, role: node.role });
    if (out.length >= MAX_CONTROL_OPTIONS) break;
  }
  return out.length > 1 ? out : [];
}

function nearestAncestorWithRole(
  nodes: AccessibilityNode[],
  nodeIndex: number,
  role: string,
): number | null {
  const node = nodes[nodeIndex];
  if (!node) return null;
  const normalizedRole = role.toLocaleLowerCase();
  let ancestorIndent = node.indent;
  for (let index = nodeIndex - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (candidate.indent >= ancestorIndent) continue;
    ancestorIndent = candidate.indent;
    if (candidate.role.toLocaleLowerCase() === normalizedRole) return index;
    if (ancestorIndent === 0) break;
  }
  return null;
}

function collectDetachedListboxNames(
  nodes: AccessibilityNode[],
  controlIndex: number,
  seen: Set<string>,
  out: UiPopupOption[],
): void {
  const endIndex = Math.min(nodes.length, controlIndex + MAX_DETACHED_POPUP_SCAN_NODES);
  for (let index = controlIndex + 1; index < endIndex; index += 1) {
    const node = nodes[index];
    if (node.role.toLocaleLowerCase() !== 'listbox') continue;
    const listboxEnd = subtreeEndIndex(nodes, index);
    const before = out.length;
    collectPopupNames(nodes, index + 1, listboxEnd, true, seen, out);
    if (out.length > before || out.length >= MAX_CONTROL_OPTIONS) break;
    index = listboxEnd - 1;
  }
}

function collectPopupNames(
  nodes: AccessibilityNode[],
  startIndex: number,
  endIndex: number,
  hasPopup: boolean,
  seen: Set<string>,
  out: UiPopupOption[],
  includeInteractiveStartNode = true,
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const node = nodes[index];
    const role = node.role.toLocaleLowerCase();
    const isStartNode = index === startIndex;
    const includeInteractiveNode = includeInteractiveStartNode || !isStartNode;
    if (
      !OPTION_ROLES.has(role) &&
      !(hasPopup && includeInteractiveNode && isInteractiveUiNode(node))
    ) {
      continue;
    }
    const name = node.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, role: node.role });
    if (out.length >= MAX_CONTROL_OPTIONS) break;
  }
}

function attributeValue(attributes: string[], key: string): string | null {
  const prefix = `${key}=`;
  const raw = attributes.find((attribute) => attribute.trim().startsWith(prefix));
  if (!raw) return null;
  const value = raw.trim().slice(prefix.length).trim();
  return stripWrappingQuote(value);
}

function hasAttributeFlag(attributes: string[], key: string): boolean {
  return attributes.some((attribute) => {
    const trimmed = attribute.trim();
    return trimmed === key || trimmed.startsWith(`${key}=`);
  });
}

function stripWrappingQuote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" || first === '"') && first === last) return value.slice(1, -1);
  }
  return value;
}

function subtreeEndIndex(nodes: AccessibilityNode[], startIndex: number): number {
  const start = nodes[startIndex];
  if (!start) return startIndex;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].indent <= start.indent) return index;
  }
  return nodes.length;
}
