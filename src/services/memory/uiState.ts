import { compactUiSection, extractUiSectionsFromControls, type UiSectionSummary } from './uiSections';
import { type AccessibilityNode } from './accessibilityTree';
import { compactLabelValue, extractLabelValues, type UiLabelValue } from './uiLabelValues';
import {
  extractTableSummaries,
  MAX_TABLE_SUMMARY_ITEMS,
  type UiTableSummary,
} from './uiTables';
import { extractRadioGroupFields, radioControlIndexesInGroups } from './uiRadioGroups';
import { extractSurfaceLabels } from './uiSurfaceLabels';
import { isInteractiveUiNode } from './uiInteractivity';
import { extractUiSymbolMarkers, uiFieldDisplayText, type UiSymbolMarker } from './uiSymbols';
import {
  extractVisibleTextSnippets,
  type UiVisibleTextSnippet,
} from './uiVisibleText';

export { parseAccessibilityTree } from './accessibilityTree';
export type { AccessibilityNode } from './accessibilityTree';

type JsonRecord = Record<string, unknown>;

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
  displayText?: string | null;
  options: string[];
  adjacentControls: UiControl[];
  controlIndex: number;
  nodeId: string | null;
  required: boolean;
  checked: string | null;
  selected: string | null;
  disabled: boolean;
  expanded: string | null;
  attributes: string[];
  symbolMarkers?: UiSymbolMarker[];
}

export interface UiStateSummary {
  nodeCount: number;
  roleCounts: Record<string, number>;
  surfaceLabels: string[];
  controls: UiControl[];
  actionControls: UiControl[];
  roleControls: Record<string, JsonRecord[]>;
  contextRoleControls: JsonRecord[];
  popupControls: UiControl[];
  sections: UiSectionSummary[];
  visibleTextSnippets: UiVisibleTextSnippet[];
  fields: UiField[];
  labelValues: UiLabelValue[];
  tables: UiTableSummary[];
  controlCount: number;
  textEntryCount: number;
  searchControlCount: number;
}

const FIELD_CONTROL_ROLES = new Set([
  'checkbox',
  'combobox',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);

const TRAILING_LABEL_CONTROL_ROLES = new Set(['checkbox', 'radio', 'switch']);
const OPTION_ROLES = new Set(['option']);
const ACTION_CONTROL_ROLE_ORDER = [
  'button',
  'checkbox',
  'link',
  'menuitem',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
] as const;
const ACTION_CONTROL_ROLES = new Set<string>(ACTION_CONTROL_ROLE_ORDER);
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
const MAX_ACTION_CONTROL_SUMMARY_ITEMS = 48;
const MAX_ROLE_CONTROL_GROUP_ITEMS = 12;
const MAX_CONTEXT_ROLE_GROUPS = 16;
const MAX_CONTEXT_ROLE_GROUP_ITEMS = 8;
const MAX_FIELD_SUMMARY_ITEMS = 36;
const MAX_FIELD_ADJACENT_CONTROLS = 6;
const MAX_LABEL_VALUE_ITEMS = 36;
const MAX_NAME_SUMMARY_ITEMS = 192;
const MAX_CONTROL_OPTIONS = 48;
const MAX_DETACHED_POPUP_SCAN_NODES = 1_500;
const REQUIRED_MARKER = '*';

function isInteractiveControlNode(node: AccessibilityNode): boolean {
  return isInteractiveUiNode(node);
}

export function extractUiStateSummary(nodes: AccessibilityNode[]): UiStateSummary {
  const roleCounts = countRoles(nodes);
  const labelBlocks = extractLabelBlocks(nodes);
  const labelBlocksByIndex = new Map(labelBlocks.map((label) => [label.index, label]));
  const usedLabelIndexes = new Set<number>();
  const controls: UiControl[] = [];
  const fields: UiField[] = [];

  for (const node of nodes) {
    if (!isInteractiveControlNode(node)) continue;
    const role = node.role.toLocaleLowerCase();
    const labelBlock =
      findNearestUnusedPriorLabel(node, labelBlocks, usedLabelIndexes) ??
      (TRAILING_LABEL_CONTROL_ROLES.has(role)
        ? findNearestUnusedFollowingLabel(node, nodes, labelBlocksByIndex, usedLabelIndexes)
        : null);
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
    const fieldLabel =
      labelBlock?.text ??
      (FIELD_CONTROL_ROLES.has(role) && control.name?.trim() ? control.name.trim() : null);
    if (fieldLabel && FIELD_CONTROL_ROLES.has(role)) {
      const displayText = uiFieldDisplayText(control);
      fields.push({
        order: fields.length,
        label: fieldLabel,
        role: node.role,
        controlName: node.name,
        value: control.value,
        displayText,
        options: control.options,
        adjacentControls:
          control.options.length === 0 ? adjacentFieldControls(nodes, node.index) : [],
        controlIndex: node.index,
        nodeId: node.nodeId,
        required: Boolean(labelBlock?.required) || control.required,
        checked: control.checked,
        selected: control.selected,
        disabled: control.disabled,
        expanded: control.expanded,
        attributes: control.attributes,
        symbolMarkers: extractUiSymbolMarkers([
          { source: 'controlName', text: control.name },
          { source: 'value', text: control.value },
          { source: 'displayText', text: displayText },
          ...control.options.map((option) => ({ source: 'option', text: option })),
        ]),
      });
    }
  }
  const groupedRadioIndexes = radioControlIndexesInGroups(nodes);
  const fieldsForSummary = [
    ...extractRadioGroupFields(nodes, 0),
    ...fields.filter((field) => !groupedRadioIndexes.has(field.controlIndex)),
  ].map((field, order) => ({ ...field, order }));

  const labelValues = extractLabelValues(nodes);
  const tables = extractTableSummaries(nodes);
  const sections = extractUiSectionsFromControls(nodes, controls);
  const visibleTextSnippets = extractVisibleTextSnippets(nodes, controls);
  const surfaceLabels = extractSurfaceLabels(controls, sections);
  const actionControls = controls.filter((control) =>
    ACTION_CONTROL_ROLES.has(control.role.toLocaleLowerCase()),
  );
  const roleControls = compactControlsByRoleGroups(actionControls);
  const contextRoleControls = compactContextRoleControls(actionControls);
  const popupControls = controls.filter(
    (control) => control.options.length > 0 || control.expanded !== null,
  );
  return {
    nodeCount: nodes.length,
    roleCounts,
    surfaceLabels,
    controls,
    actionControls,
    roleControls,
    contextRoleControls,
    popupControls,
    sections,
    visibleTextSnippets,
    fields: fieldsForSummary,
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
    displayText: field.displayText,
    options: field.options.length > 0 ? field.options : undefined,
    adjacentControls:
      field.adjacentControls.length > 0 ? field.adjacentControls.map(compactControl) : undefined,
    symbolMarkers: field.symbolMarkers,
    controlIndex: field.controlIndex,
    nodeId: field.nodeId,
    required: field.required || undefined,
    checked: field.checked,
    selected: field.selected,
    disabled: field.disabled || undefined,
    expanded: field.expanded,
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
    surfaceLabels: summary.surfaceLabels,
    visibleTextSnippets: summary.visibleTextSnippets,
    fieldLabels: uniqueNamedValues(summary.fields.map((field) => field.label)),
    controlNames: uniqueNamedValues(summary.controls.map((control) => control.name)),
    sections: summary.sections.map(compactUiSection),
    actionControls: summary.actionControls
      .slice(0, MAX_ACTION_CONTROL_SUMMARY_ITEMS)
      .map(compactControl),
    roleControls: summary.roleControls,
    contextRoleControls: summary.contextRoleControls,
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

function compactContextRoleControls(controls: UiControl[]): JsonRecord[] {
  const contexts = new Map<string, Map<string, JsonRecord[]>>();
  for (const control of controls) {
    for (const contextLabel of control.contextLabels) {
      const label = contextLabel.trim();
      if (!label) continue;
      let roles = contexts.get(label);
      if (!roles) {
        if (contexts.size >= MAX_CONTEXT_ROLE_GROUPS) continue;
        roles = new Map<string, JsonRecord[]>();
        contexts.set(label, roles);
      }
      const role = control.role.toLocaleLowerCase();
      if (!ACTION_CONTROL_ROLES.has(role)) continue;
      const entries = roles.get(role) ?? [];
      if (entries.length >= MAX_CONTEXT_ROLE_GROUP_ITEMS) continue;
      entries.push(compactControl(control));
      roles.set(role, entries);
    }
  }

  return Array.from(contexts.entries()).map(([label, roles]) => ({
    label,
    roleControls: Object.fromEntries(roles.entries()),
  }));
}

function compactControlsByRoleGroups(controls: UiControl[]): Record<string, JsonRecord[]> {
  const grouped: Record<string, JsonRecord[]> = {};
  for (const role of ACTION_CONTROL_ROLE_ORDER) {
    const entries = controls
      .filter((control) => control.role.toLocaleLowerCase() === role)
      .slice(0, MAX_ROLE_CONTROL_GROUP_ITEMS)
      .map(compactControl);
    if (entries.length > 0) grouped[role] = entries;
  }
  return grouped;
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
    interactiveControlCount: table.interactiveControlCount,
    interactiveControls: table.interactiveControls,
    columnValueSamples: table.columnValueSamples,
    rowSamples: table.rowSamples,
  });
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

function findNearestUnusedFollowingLabel(
  control: AccessibilityNode,
  nodes: AccessibilityNode[],
  labelBlocksByIndex: ReadonlyMap<number, LabelBlock>,
  usedLabelIndexes: Set<number>,
): LabelBlock | null {
  for (let index = control.index + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent < control.indent) break;
    if (node.indent > control.indent + 2) continue;
    if (isInteractiveControlNode(node)) break;
    if (CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) break;
    const label = labelBlocksByIndex.get(index);
    if (!label || usedLabelIndexes.has(label.index)) continue;
    if (!isCompatibleTrailingLabel(control, label)) return null;
    return label;
  }
  return null;
}

function isCompatibleTrailingLabel(control: AccessibilityNode, label: LabelBlock): boolean {
  const controlName = normalizeLabelText(control.name ? [control.name] : []);
  if (!controlName) return true;
  return controlName === label.text;
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
    if (node.role === 'LabelText') break;
    if (!CONTEXT_LABEL_ROLES.has(node.role.toLocaleLowerCase())) continue;
    addLabel(node.name);
    break;
  }

  return labels.slice(0, 6);
}

function adjacentFieldControls(nodes: AccessibilityNode[], controlIndex: number): UiControl[] {
  const control = nodes[controlIndex];
  if (!control) return [];
  const out: UiControl[] = [];
  const startIndex = subtreeEndIndex(nodes, controlIndex);
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent < control.indent) break;
    if (node.role === 'LabelText' && node.indent <= control.indent) break;
    if (!isInteractiveControlNode(node)) continue;
    const role = node.role.toLocaleLowerCase();
    if (FIELD_CONTROL_ROLES.has(role) && node.indent <= control.indent) break;
    if (!ACTION_CONTROL_ROLES.has(role)) continue;
    out.push(
      controlFromNode(
        node,
        null,
        false,
        childPopupItemNames(nodes, node.index),
        findContextLabels(nodes, node.index),
      ),
    );
    if (out.length >= MAX_FIELD_ADJACENT_CONTROLS) break;
  }
  return out;
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
    if (node.indent <= control.indent && node.role === 'LabelText') break;
    if (node.indent <= control.indent && FIELD_CONTROL_ROLES.has(node.role.toLocaleLowerCase())) {
      break;
    }
    if (node.indent !== control.indent) continue;
    const siblingEnd = subtreeEndIndex(nodes, index);
    const before = out.length;
    collectPopupNames(nodes, index, siblingEnd, hasPopup, seen, out, false);
    if (out.length > before || out.length >= MAX_CONTROL_OPTIONS) break;
    index = siblingEnd - 1;
  }
  if (out.length === 0) {
    collectDetachedListboxNames(nodes, controlIndex, seen, out);
  }
  return out;
}

function collectDetachedListboxNames(
  nodes: AccessibilityNode[],
  controlIndex: number,
  seen: Set<string>,
  out: string[],
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
  out: string[],
  includeInteractiveStartNode = true,
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const node = nodes[index];
    const role = node.role.toLocaleLowerCase();
    const isStartNode = index === startIndex;
    const includeInteractiveNode = includeInteractiveStartNode || !isStartNode;
    if (
      !OPTION_ROLES.has(role) &&
      !(hasPopup && includeInteractiveNode && isInteractiveControlNode(node))
    ) {
      continue;
    }
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
