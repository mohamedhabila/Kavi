// ---------------------------------------------------------------------------
// Kavi — UI state extraction
// ---------------------------------------------------------------------------
// Turns accessibility-tree observations into a compact, typed state graph.
// The extraction is based on accessibility roles, tree indentation, attributes,
// and sibling/ancestor relationships. It intentionally avoids product-specific
// strings or English phrase rules so it works across app surfaces and locales.
// ---------------------------------------------------------------------------

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

export interface UiLabelValue {
  label: string;
  value: string;
  sourceIndex: number;
}

export interface UiTableSummary {
  index: number;
  role: string;
  columnLabels: string[];
  rowCount: number;
  columnValueSamples: Array<{
    column: string;
    values: string[];
  }>;
  rowSamples: Array<Record<string, string>>;
}

export interface UiStateSummary {
  nodeCount: number;
  roleCounts: Record<string, number>;
  controls: UiControl[];
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

const FIELD_CONTROL_ROLES = new Set([
  'combobox',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);

const TABLE_CONTAINER_ROLES = new Set(['grid', 'table', 'treegrid']);
const ROW_ROLES = new Set(['row']);
const COLUMN_HEADER_ROLES = new Set(['columnheader']);
const CELL_ROLES = new Set(['cell', 'gridcell', 'rowheader']);
const OPTION_ROLES = new Set(['option']);

const MAX_CONTROL_SUMMARY_ITEMS = 36;
const MAX_FIELD_SUMMARY_ITEMS = 36;
const MAX_LABEL_VALUE_ITEMS = 36;
const MAX_NAME_SUMMARY_ITEMS = 48;
const MAX_CONTROL_OPTIONS = 48;
const MAX_TABLE_SUMMARY_ITEMS = 6;
const MAX_TABLE_COLUMNS = 18;
const MAX_TABLE_VALUES_PER_COLUMN = 12;
const MAX_TABLE_ROW_SAMPLES = 3;
const MAX_PARSED_ACCESSIBILITY_NODES = 2_500;
const REQUIRED_MARKER = '*';

function isInteractiveControlNode(node: AccessibilityNode): boolean {
  return ACTIONABLE_ROLES.has(node.role.toLocaleLowerCase());
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
    const options = childOptionNames(nodes, node.index);
    const control = controlFromNode(
      node,
      labelBlock?.text ?? null,
      labelBlock?.required ?? false,
      options,
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
  return {
    nodeCount: nodes.length,
    roleCounts,
    controls,
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
    textEntryControls,
    searchControls,
    fields: summary.fields.slice(0, MAX_FIELD_SUMMARY_ITEMS).map(compactField),
    controls: summary.controls.slice(0, MAX_CONTROL_SUMMARY_ITEMS).map(compactControl),
    labelValues: summary.labelValues.slice(0, MAX_LABEL_VALUE_ITEMS),
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
  };
}

function childOptionNames(nodes: AccessibilityNode[], controlIndex: number): string[] {
  const control = nodes[controlIndex];
  if (!control) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let index = controlIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent <= control.indent) break;
    if (!OPTION_ROLES.has(node.role.toLocaleLowerCase())) continue;
    const name = node.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_CONTROL_OPTIONS) break;
  }
  return out;
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

function extractLabelValues(nodes: AccessibilityNode[]): UiLabelValue[] {
  const out: UiLabelValue[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const label = nodes[index];
    if (!label.name || !label.name.trim().endsWith(':')) continue;
    const labelText = label.name.trim().slice(0, -1).trim();
    if (!labelText) continue;
    const value = findFollowingValue(nodes, index, label.indent);
    if (!value) continue;
    out.push({ label: labelText, value, sourceIndex: label.index });
    if (out.length >= MAX_LABEL_VALUE_ITEMS) break;
  }
  return out;
}

function findFollowingValue(nodes: AccessibilityNode[], startIndex: number, labelIndent: number): string | null {
  for (let index = startIndex + 1; index < Math.min(nodes.length, startIndex + 12); index += 1) {
    const node = nodes[index];
    if (node.indent < labelIndent) break;
    if (!node.name) continue;
    if (node.name.trim() === REQUIRED_MARKER) continue;
    if (node.name.trim().endsWith(':')) continue;
    return node.name.trim();
  }
  return null;
}

function extractTableSummaries(nodes: AccessibilityNode[]): UiTableSummary[] {
  const tableIndexes = nodes
    .filter((node) => TABLE_CONTAINER_ROLES.has(node.role.toLocaleLowerCase()))
    .map((node) => node.index);
  const rootRegions = tableIndexes.length > 0 ? tableIndexes : [0];
  const summaries: UiTableSummary[] = [];

  for (const tableIndex of rootRegions) {
    if (summaries.length >= MAX_TABLE_SUMMARY_ITEMS) break;
    const table = nodes[tableIndex];
    if (!table) continue;
    const endIndex = subtreeEndIndex(nodes, tableIndex);
    const summary = extractTableSummary(nodes, tableIndex, endIndex);
    if (!summary) continue;
    summaries.push(summary);
  }

  return summaries;
}

function extractTableSummary(
  nodes: AccessibilityNode[],
  startIndex: number,
  endIndex: number,
): UiTableSummary | null {
  const table = nodes[startIndex];
  if (!table) return null;
  const columnLabels = uniqueNamedValues(
    nodes
      .slice(startIndex + 1, endIndex)
      .filter((node) => COLUMN_HEADER_ROLES.has(node.role.toLocaleLowerCase()))
      .map((node) => nodeText(nodes, node.index)),
  ).slice(0, MAX_TABLE_COLUMNS);
  const rowRecords: Array<Record<string, string>> = [];
  const valueSamples = new Map<string, string[]>();
  let rowCount = 0;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const row = nodes[index];
    if (!ROW_ROLES.has(row.role.toLocaleLowerCase())) continue;
    rowCount += 1;
    const rowEnd = Math.min(subtreeEndIndex(nodes, index), endIndex);
    const cells = nodes
      .slice(index + 1, rowEnd)
      .filter((node) => CELL_ROLES.has(node.role.toLocaleLowerCase()))
      .map((node) => nodeText(nodes, node.index))
      .filter((value): value is string => Boolean(value));
    if (columnLabels.length === 0 || cells.length === 0) continue;
    const record: Record<string, string> = {};
    for (let cellIndex = 0; cellIndex < Math.min(columnLabels.length, cells.length); cellIndex += 1) {
      const column = columnLabels[cellIndex];
      const value = fitText(cells[cellIndex], 160);
      if (!column || !value) continue;
      record[column] = value;
      const existing = valueSamples.get(column) ?? [];
      if (!existing.includes(value) && existing.length < MAX_TABLE_VALUES_PER_COLUMN) {
        existing.push(value);
        valueSamples.set(column, existing);
      }
    }
    if (Object.keys(record).length > 0 && rowRecords.length < MAX_TABLE_ROW_SAMPLES) {
      rowRecords.push(record);
    }
  }

  const columnValueSamples = Array.from(valueSamples.entries())
    .slice(0, MAX_TABLE_COLUMNS)
    .map(([column, values]) => ({ column, values }));
  if (columnLabels.length === 0 && rowRecords.length === 0 && columnValueSamples.length === 0) {
    return null;
  }
  return {
    index: table.index,
    role: table.role,
    columnLabels,
    rowCount,
    columnValueSamples,
    rowSamples: rowRecords,
  };
}

function subtreeEndIndex(nodes: AccessibilityNode[], startIndex: number): number {
  const start = nodes[startIndex];
  if (!start) return startIndex;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].indent <= start.indent) return index;
  }
  return nodes.length;
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
