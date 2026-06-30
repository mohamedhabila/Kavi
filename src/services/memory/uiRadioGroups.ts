import type { AccessibilityNode, UiField } from './uiState';
import { extractUiSymbolMarkers } from './uiSymbols';

const RADIO_GROUP_ROLE = 'radiogroup';
const RADIO_ROLE = 'radio';

function normalizedText(value: string | null | undefined): string {
  return value?.normalize('NFKC').replace(/\s+/gu, ' ').trim() ?? '';
}

function subtreeEndIndex(nodes: ReadonlyArray<AccessibilityNode>, startIndex: number): number {
  const start = nodes[startIndex];
  if (!start) return startIndex;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].indent <= start.indent) return index;
  }
  return nodes.length;
}

function stripWrappingQuote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === "'" || first === '"') && first === last ? value.slice(1, -1) : value;
}

function attributeValue(attributes: ReadonlyArray<string>, key: string): string | null {
  const prefix = `${key}=`;
  const raw = attributes.find((attribute) => attribute.trim().startsWith(prefix));
  if (!raw) return null;
  return stripWrappingQuote(raw.trim().slice(prefix.length).trim());
}

function attributeIsTrue(attributes: ReadonlyArray<string>, key: string): boolean {
  return attributeValue(attributes, key)?.toLocaleLowerCase() === 'true';
}

function groupFieldFromNode(
  nodes: ReadonlyArray<AccessibilityNode>,
  groupIndex: number,
  order: number,
): UiField | null {
  const group = nodes[groupIndex];
  const label = normalizedText(group.name);
  if (!label) return null;
  const endIndex = subtreeEndIndex(nodes, groupIndex);
  const options: string[] = [];
  const seen = new Set<string>();
  let value: string | null = null;
  for (let index = groupIndex + 1; index < endIndex; index += 1) {
    const node = nodes[index];
    if (node.role.toLocaleLowerCase() !== RADIO_ROLE) continue;
    const option = normalizedText(node.name);
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (!value && (attributeIsTrue(node.attributes, 'checked') || attributeIsTrue(node.attributes, 'selected'))) {
      value = option;
    }
  }
  if (options.length === 0) return null;
  return {
    order,
    label,
    role: group.role,
    controlName: group.name,
    value,
    options,
    adjacentControls: [],
    controlIndex: group.index,
    nodeId: group.nodeId,
    required: false,
    attributes: group.attributes,
    symbolMarkers: extractUiSymbolMarkers([
      { source: 'controlName', text: group.name },
      { source: 'value', text: value },
      ...options.map((option) => ({ source: 'option', text: option })),
    ]),
  };
}

export function extractRadioGroupFields(
  nodes: ReadonlyArray<AccessibilityNode>,
  startOrder: number,
): UiField[] {
  const fields: UiField[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].role.toLocaleLowerCase() !== RADIO_GROUP_ROLE) continue;
    const field = groupFieldFromNode(nodes, index, startOrder + fields.length);
    if (field) fields.push(field);
  }
  return fields;
}

export function radioControlIndexesInGroups(
  nodes: ReadonlyArray<AccessibilityNode>,
): Set<number> {
  const indexes = new Set<number>();
  for (let groupIndex = 0; groupIndex < nodes.length; groupIndex += 1) {
    if (nodes[groupIndex].role.toLocaleLowerCase() !== RADIO_GROUP_ROLE) continue;
    const endIndex = subtreeEndIndex(nodes, groupIndex);
    for (let index = groupIndex + 1; index < endIndex; index += 1) {
      if (nodes[index].role.toLocaleLowerCase() === RADIO_ROLE) indexes.add(nodes[index].index);
    }
  }
  return indexes;
}
