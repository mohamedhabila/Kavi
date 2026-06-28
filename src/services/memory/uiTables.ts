import type { AccessibilityNode } from './uiState';

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

const TABLE_CONTAINER_ROLES = new Set(['grid', 'table', 'treegrid']);
const ROW_ROLES = new Set(['row']);
const COLUMN_HEADER_ROLES = new Set(['columnheader']);
const CELL_ROLES = new Set(['cell', 'gridcell', 'rowheader']);

export const MAX_TABLE_SUMMARY_ITEMS = 6;
const MAX_TABLE_COLUMNS = 18;
const MAX_TABLE_VALUES_PER_COLUMN = 12;
const MAX_TABLE_ROW_SAMPLES = 3;

export function extractTableSummaries(nodes: AccessibilityNode[]): UiTableSummary[] {
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
      .map((node) => cellText(nodes, node.index));
    if (columnLabels.length === 0 || cells.length === 0) continue;
    const record = summarizeTableRow(columnLabels, cells, valueSamples);
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

function summarizeTableRow(
  columnLabels: string[],
  cells: string[],
  valueSamples: Map<string, string[]>,
): Record<string, string> {
  const summaryPair = leadingBlankSummaryPair(cells);
  if (summaryPair) {
    const [label, value] = summaryPair;
    addTableValueSample(valueSamples, label, value);
    return { [label]: value };
  }

  const record: Record<string, string> = {};
  for (let cellIndex = 0; cellIndex < Math.min(columnLabels.length, cells.length); cellIndex += 1) {
    const column = columnLabels[cellIndex];
    const value = compactCellText(cells[cellIndex]);
    if (!column || !value) continue;
    record[column] = value;
    addTableValueSample(valueSamples, column, value);
  }
  return record;
}

function leadingBlankSummaryPair(cells: string[]): [string, string] | null {
  const nonEmptyCells = cells
    .map((value, index) => ({ index, value: compactCellText(value) }))
    .filter((entry): entry is { index: number; value: string } => Boolean(entry.value));
  if (nonEmptyCells.length !== 2) return null;
  const [label, value] = nonEmptyCells;
  if (label.index === 0 || value.index !== label.index + 1) return null;
  return [label.value, value.value];
}

function addTableValueSample(
  valueSamples: Map<string, string[]>,
  column: string,
  value: string,
): void {
  const existing = valueSamples.get(column) ?? [];
  if (!existing.includes(value) && existing.length < MAX_TABLE_VALUES_PER_COLUMN) {
    existing.push(value);
    valueSamples.set(column, existing);
  }
}

function subtreeEndIndex(nodes: AccessibilityNode[], startIndex: number): number {
  const start = nodes[startIndex];
  if (!start) return startIndex;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].indent <= start.indent) return index;
  }
  return nodes.length;
}

function cellText(nodes: AccessibilityNode[], index: number): string {
  return nodeText(nodes, index) ?? '';
}

function compactCellText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? fitText(trimmed, 160) : null;
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
  const text = normalizeText(parts);
  return text ? fitText(text, 220) : null;
}

function uniqueNamedValues(values: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_TABLE_COLUMNS) break;
  }
  return out;
}

function normalizeText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
