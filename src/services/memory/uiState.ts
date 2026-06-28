// ---------------------------------------------------------------------------
// Kavi — UI state extraction
// ---------------------------------------------------------------------------
// Turns accessibility-tree observations into a compact, typed state graph.
// The extraction is based on accessibility roles, tree indentation, attributes,
// and sibling/ancestor relationships. It intentionally avoids product-specific
// strings or English phrase rules so it works across app surfaces and locales.
// ---------------------------------------------------------------------------

import { compactUiSection, extractUiSectionsFromControls, type UiSectionSummary } from './uiSections';
import {
  compactLabelValue,
  extractLabelValues,
  type UiLabelValue,
} from './uiLabelValues';
import {
  extractTableSummaries,
  MAX_TABLE_SUMMARY_ITEMS,
  type UiTableSummary,
} from './uiTables';

type JsonRecord = Record<string, unknown>;

export interface AccessibilityNode {
  index: number;
  nodeId: string | null;
  indent: number;
  role: string;
  name: string | null;
  attributes: string[];
}

export interface UiControl {
  index: number;
  nodeId: string | null;
  role: string;
  name: string | null;
  value: string | null;
  options: string[];
  attributes: string[];
  label: string | null;
  required: boolean;
  checked: string | null;
  selected: string | null;
  disabled: boolean;
  expanded: string | null;
  contextLabels: string[];
}

export interface UiField {
  order: number;
  label: string;
  role: string;
  controlName: string | null;
  value: string | null;
  options: string[];
  controlIndex: number;
  nodeId: string | null;
  required: boolean;
  attributes: string[];
}

export interface UiStateSummary {
  nodeCount: number;
  roleCounts: Record<string, number>;
  controls: UiControl[];
  popupControls: UiControl[];
  sections: UiSectionSummary[];
  fields: UiField[];
  labelValues: UiLabelValue[];
  tables: UiTableSummary[];
  controlCount: number;
  textEntryCount: number;
  searchControlCount: number;
}

const ACTIONABLE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

const NON_CONTROL_CLICKABLE_ROLES = new Set(['labeltext', 'statictext']);

const FIELD_CONTROL_ROLES = new Set([
  'combobox',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);

const OPTION_ROLES = new Set(['option']);
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

const MAX_CONTROL_SUMMARY_ITEMS = 96;
const MAX_FIELD_SUMMARY_ITEMS = 36;
const MAX_LABEL_VALUE_ITEMS = 36;
const MAX_NAME_SUMMARY_ITEMS = 192;
const MAX_CONTROL_OPTIONS = 48;
const MAX_PARSED_ACCESSIBILITY_NODES = 2_500;
const REQUIRED_MARKER = '*';

function isInteractiveControlNode(node: AccessibilityNode): boolean {
  const role = node.role.toLocaleLowerCase();
  return (
    ACTIONABLE_ROLES.has(role) ||
    Boolean(
      node.name &&
        !NON_CONTROL_CLICKABLE_ROLES.has(role) &&
        node.attributes.some((attribute) => attribute.trim() === 'clickable'),
    )
  );
}

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

export function extractUiStateSummary(nodes: AccessibilityNode[]): UiStateSummary {
  const roleCounts = countRoles(nodes);
  const labelBlocks = extractLabelBlocks(nodes);
  const usedLabelIndexes = new Set<number>();
  const controls: UiControl[] = [];
  const fields: UiField[] = [];

  for (const node of nodes) {
    if (!isInteractiveControlNode(node)) continue;
    const labelBlock = findNearestUnusedPriorLabel(node, labelBlocks, usedLabelIndexes);
    if (labelBlock) usedLabelIndexes.add(labelBlock.index);
    const options = childPopupItemNames(nodes, node.index);
    const contextLabels = findContextLabels(nodes, node.index);
    const control = controlFromNode(
      node,
      labelBlock?.text ?? null,
      labelBlock?.required ?? false,
      options,
      contextLabels,
    );
    controls.push(control);
    if (labelBlock && FIELD_CONTROL_ROLES.has(node.role.toLocaleLowerCase())) {
      fields.push({
        order: fields.length,
        label: labelBlock.text,
        role: node.role,
        controlName: node.name,
        value: control.value,
        options: control.options,
        controlIndex: node.index,
        nodeId: node.nodeId,
        required: labelBlock.required || control.required,
        attributes: control.attributes,
      });
    }
  }

  const labelValues = extractLabelValues(nodes);
  const tables = extractTableSummaries(nodes);
  const sections = extractUiSectionsFromControls(nodes, controls);
  const popupControls = controls.filter(
    (control) => control.options.length > 0 || control.expanded !== null,
  );
  return {
    nodeCount: nodes.length,
    roleCounts,
    controls,
    popupControls,
    sections,
    fields,
    labelValues,
    tables,
    controlCount: controls.length,
    textEntryCount: controls.filter((control) => control.role.toLocaleLowerCase() === 'textbox')
      .length,
    searchControlCount: controls.filter(
      (control) => control.role.toLocaleLowerCase() === 'searchbox',
    ).length,
  };
}

export function compactControl(control: UiControl): JsonRecord {
  return dropEmpty({
    index: control.index,
    nodeId: control.nodeId,
    role: control.role,
    name: control.name,
    label: control.label,
    value: control.value,
    options: control.options.length > 0 ? control.options : undefined,
    required: control.required || undefined,
    checked: control.checked,
    selected: control.selected,
    disabled: control.disabled || undefined,
    expanded: control.expanded,
    contextLabels: control.contextLabels.length > 0 ? control.contextLabels : undefined,
  });
}

export function compactField(field: UiField): JsonRecord {
  return dropEmpty({
    order: field.order,
    label: field.label,
    role: field.role,
    controlName: field.controlName,
    value: field.value,
    options: field.options.length > 0 ? field.options : undefined,
    controlIndex: field.controlIndex,
    nodeId: field.nodeId,
    required: field.required || undefined,
  });
}

export function compactUiInventory(summary: UiStateSummary): JsonRecord {
  const textEntryControls = compactControlsByRole(summary.controls, ['textbox']);
  const searchControls = compactControlsByRole(summary.controls, ['searchbox']);
  return {
    nodeCount: summary.nodeCount,
    controlCount: summary.controlCount,
    textEntryCount: summary.textEntryCount,
    searchControlCount: summary.searchControlCount,
    fieldLabels: uniqueNamedValues(summary.fields.map((field) => field.label)),
    controlNames: uniqueNamedValues(summary.controls.map((control) => control.name)),
    sections: summary.sections.map(compactUiSection),
    textEntryControls,
    searchControls,
    popupControls: summary.popupControls.slice(0, MAX_CONTROL_SUMMARY_ITEMS).map(compactControl),
    fields: summary.fields.slice(0, MAX_FIELD_SUMMARY_ITEMS).map(compactField),
    controls: summary.controls.slice(0, MAX_CONTROL_SUMMARY_ITEMS).map(compactControl),
    labelValues: summary.labelValues.slice(0, MAX_LABEL_VALUE_ITEMS).map(compactLabelValue),
    tables: summary.tables.slice(0, MAX_TABLE_SUMMARY_ITEMS).map(compactTableSummary),
    roleCounts: summary.roleCounts,
  };
}

function compactControlsByRole(controls: UiControl[], roles: string[]): JsonRecord[] {
  const roleSet = new Set(roles.map((role) => role.toLocaleLowerCase()));
  return controls
    .filter((control) => roleSet.has(control.role.toLocaleLowerCase()))
    .slice(0, MAX_CONTROL_SUMMARY_ITEMS)
    .map(compactControl);
}

function uniqueNamedValues(values: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_NAME_SUMMARY_ITEMS) break;
  }
  return out;
}

function compactTableSummary(table: UiTableSummary): JsonRecord {
  return dropEmpty({
    index: table.index,
    role: table.role,
    columnLabels: table.columnLabels,
    rowCount: table.rowCount,
    columnValueSamples: table.columnValueSamples,
    rowSamples: table.rowSamples,
  });
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
    name: name ? fitText(name, 260) : null,
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

function countRoles(nodes: AccessibilityNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    counts[node.role] = (counts[node.role] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    }),
  );
}

interface LabelBlock {
  index: number;
  indent: number;
  text: string;
  required: boolean;
}

function extractLabelBlocks(nodes: AccessibilityNode[]): LabelBlock[] {
  const labels: LabelBlock[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.role !== 'LabelText') continue;
    const parts: string[] = [];
    if (node.name) parts.push(node.name);
    let required = node.name === REQUIRED_MARKER;
    for (let childIndex = index + 1; childIndex < nodes.length; childIndex += 1) {
      const child = nodes[childIndex];
      if (child.indent <= node.indent) break;
      if (child.name) {
        parts.push(child.name);
        if (child.name === REQUIRED_MARKER) required = true;
      }
    }
    const text = normalizeLabelText(parts);
    if (text) labels.push({ index, indent: node.indent, text, required });
  }
  return labels;
}

function normalizeLabelText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part && part !== REQUIRED_MARKER)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNearestUnusedPriorLabel(
  control: AccessibilityNode,
  labelBlocks: LabelBlock[],
  usedLabelIndexes: Set<number>,
): LabelBlock | null {
  let best: LabelBlock | null = null;
  for (let index = labelBlocks.length - 1; index >= 0; index -= 1) {
    const label = labelBlocks[index];
    if (label.index >= control.index) continue;
    if (usedLabelIndexes.has(label.index)) continue;
    if (label.indent > control.indent + 2) continue;
    best = label;
    break;
  }
  return best;
}

function controlFromNode(
  node: AccessibilityNode,
  label: string | null,
  labelRequired: boolean,
  options: string[],
  contextLabels: string[],
): UiControl {
  return {
    index: node.index,
    nodeId: node.nodeId,
    role: node.role,
    name: node.name,
    value: attributeValue(node.attributes, 'value'),
    options,
    attributes: node.attributes,
    label,
    required: labelRequired || hasAttributeFlag(node.attributes, 'required'),
    checked: attributeValue(node.attributes, 'checked'),
    selected: attributeValue(node.attributes, 'selected'),
    disabled: hasAttributeFlag(node.attributes, 'disabled'),
    expanded: attributeValue(node.attributes, 'expanded'),
    contextLabels,
  };
}

function findContextLabels(nodes: AccessibilityNode[], controlIndex: number): string[] {
  const control = nodes[controlIndex];
  if (!control) return [];
  const labels: string[] = [];
  const seen = new Set<string>();

  const addLabel = (value: string | null | undefined): void => {
    const normalized = normalizeLabelText(value ? [value] : []);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    labels.push(normalized);
  };

  let ancestorIndent = control.indent;
  for (let index = controlIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.indent >= ancestorIndent) continue;
    ancestorIndent = node.indent;
    if (CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) addLabel(node.name);
    if (ancestorIndent === 0) break;
  }

  const lowerBound = Math.max(0, controlIndex - 32);
  for (let index = controlIndex - 1; index >= lowerBound && labels.length < 6; index -= 1) {
    const node = nodes[index];
    if (node.indent > control.indent) continue;
    if (!CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) continue;
    addLabel(node.name);
  }

  return labels.slice(0, 6);
}

function childPopupItemNames(nodes: AccessibilityNode[], controlIndex: number): string[] {
  const control = nodes[controlIndex];
  if (!control) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const hasPopup =
    hasAttributeFlag(control.attributes, 'hasPopup') ||
    attributeValue(control.attributes, 'expanded') !== null;
  const isExpandedOpen = attributeValue(control.attributes, 'expanded')?.toLocaleLowerCase() === 'true';
  const ownSubtreeEnd = subtreeEndIndex(nodes, controlIndex);
  collectPopupNames(nodes, controlIndex + 1, ownSubtreeEnd, hasPopup, seen, out);
  if (!hasPopup || out.length > 0 || !isExpandedOpen) return out;

  for (let index = ownSubtreeEnd; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent < control.indent) break;
    if (node.indent !== control.indent) continue;
    const siblingEnd = subtreeEndIndex(nodes, index);
    const before = out.length;
    collectPopupNames(nodes, index, siblingEnd, hasPopup, seen, out);
    if (out.length > before || out.length >= MAX_CONTROL_OPTIONS) break;
    index = siblingEnd - 1;
  }
  return out;
}

function collectPopupNames(
  nodes: AccessibilityNode[],
  startIndex: number,
  endIndex: number,
  hasPopup: boolean,
  seen: Set<string>,
  out: string[],
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const node = nodes[index];
    const role = node.role.toLocaleLowerCase();
    if (!OPTION_ROLES.has(role) && !(hasPopup && isInteractiveControlNode(node))) continue;
    const name = node.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
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
