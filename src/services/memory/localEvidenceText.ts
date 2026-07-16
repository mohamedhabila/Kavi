import { selectOrderedEvidenceIndexes } from './controlSequenceCompaction';
import { parseJsonRecord } from './factJson';
import type { MemoryFactKind } from './facts/types';

export interface BoundedLocalEvidenceText {
  value: string | null;
  truncated: boolean;
}

export function boundLocalEvidenceText(
  value: string | null,
  maxChars: number,
): BoundedLocalEvidenceText {
  const normalized = value?.trim() ?? '';
  if (!normalized) return { value: null, truncated: false };
  if (normalized.length <= maxChars) return { value: normalized, truncated: false };
  return {
    value: `${normalized.slice(0, maxChars - 1).trimEnd()}\u2026`,
    truncated: true,
  };
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function controlMarker(value: unknown, maxChars: number): string | null {
  if (typeof value === 'string') return boundLocalEvidenceText(value, maxChars).value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const marker = [
    stringField(record, 'role'),
    stringField(record, 'section'),
    stringField(record, 'label'),
    stringField(record, 'attributes'),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join('|');
  return boundLocalEvidenceText(marker, maxChars).value;
}

function compactControls(value: unknown, maxItemChars: number): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const indexes = selectOrderedEvidenceIndexes({ itemCount: value.length, maxItems: 2 });
  const controls = indexes
    .map((index) => controlMarker(value[index], maxItemChars))
    .filter((entry): entry is string => Boolean(entry));
  return controls.length > 0 ? controls : undefined;
}

function compactEvidenceSpanVariant(
  record: Record<string, unknown>,
  directTextChars: number,
  controlChars: number,
): string {
  const observation = boundLocalEvidenceText(
    stringField(record, 'observation'),
    directTextChars,
  ).value;
  const toolResult = boundLocalEvidenceText(
    stringField(record, 'toolResult') ?? stringField(record, 'tool_result'),
    directTextChars,
  ).value;
  const outcome = boundLocalEvidenceText(stringField(record, 'outcome'), directTextChars).value;
  const controls = compactControls(
    record.observedControlSequence ?? record.observedAffordances,
    controlChars,
  );
  const compact = Object.fromEntries(
    Object.entries({
      goal: boundLocalEvidenceText(stringField(record, 'goal'), 80).value,
      domain: boundLocalEvidenceText(stringField(record, 'domain'), 48).value,
      environment: boundLocalEvidenceText(stringField(record, 'environment'), 64).value,
      stateIndex: numberField(record, 'stateIndex') ?? numberField(record, 'state_index'),
      sequence: numberField(record, 'sequence'),
      url: boundLocalEvidenceText(stringField(record, 'url'), 96).value,
      toolName: boundLocalEvidenceText(
        stringField(record, 'toolName') ?? stringField(record, 'tool_name'),
        40,
      ).value,
      observation,
      toolResult,
      ...(!observation && !toolResult ? { outcome } : {}),
      controls,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  return JSON.stringify(compact);
}

function compactEvidenceSpan(value: string, maxChars: number): BoundedLocalEvidenceText | null {
  const parsed = parseJsonRecord(value);
  if (!parsed) return null;
  for (const [directTextChars, controlChars] of [
    [72, 60],
    [48, 44],
    [32, 28],
  ] as const) {
    const compact = compactEvidenceSpanVariant(parsed, directTextChars, controlChars);
    if (compact !== '{}' && compact.length <= maxChars) {
      return { value: compact, truncated: compact !== value.trim() };
    }
  }
  return null;
}

export function compactLocalEvidenceStatement(
  memoryKind: MemoryFactKind,
  value: string,
  maxChars: number,
): BoundedLocalEvidenceText {
  if (memoryKind === 'evidence_span') {
    const compact = compactEvidenceSpan(value, maxChars);
    if (compact) return compact;
  }
  return boundLocalEvidenceText(value, maxChars);
}
