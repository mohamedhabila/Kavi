import type { MemoryFact } from './facts/types';
import { tokenizeLexicalUnits } from './ranking/lexical';

const QUOTED_SPAN_PATTERN = /`([^`]{1,160})`|"([^"]{1,160})"|'([^']{1,160})'/gu;
const MAX_TARGETS = 4;
const MAX_SNAPSHOTS_PER_TARGET = 8;
const MAX_VISIBLE_CONTROLS = 40;
const RELATED_CONTROL_COVERAGE_THRESHOLD = 0.5;

type UiInventorySnapshot = {
  url?: unknown;
  sourceGoal?: unknown;
  sourceRunId?: unknown;
  stateIndex?: unknown;
  visibleControls: string[];
};

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractQuotedSpans(query: string): string[] {
  const spans: string[] = [];
  QUOTED_SPAN_PATTERN.lastIndex = 0;
  for (const match of query.matchAll(QUOTED_SPAN_PATTERN)) {
    const span = (match[1] ?? match[2] ?? match[3] ?? '').normalize('NFKC').trim();
    if (!span || spans.includes(span)) continue;
    spans.push(span);
    if (spans.length >= MAX_TARGETS * 3) break;
  }
  return spans;
}

function visibleControlsFromPayload(payload: Record<string, unknown>): string[] {
  const direct = payload.visibleControls ?? payload.controlNames;
  if (Array.isArray(direct)) {
    return direct.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
  }
  const controls = payload.controls;
  if (!Array.isArray(controls)) return [];
  return controls
    .map((control) =>
      control && typeof control === 'object' && !Array.isArray(control)
        ? (control as Record<string, unknown>).name
        : null,
    )
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function snapshotFromFact(fact: MemoryFact): UiInventorySnapshot | null {
  if (fact.memoryKind !== 'ui_inventory') return null;
  const payload = parseJsonRecord(fact.objectText);
  if (!payload) return null;
  const visibleControls = visibleControlsFromPayload(payload);
  if (visibleControls.length === 0) return null;
  return {
    url: payload.url ?? fact.attributes.url,
    sourceGoal: payload.sourceGoal ?? payload.goal ?? fact.attributes.goal,
    sourceRunId: payload.sourceRunId ?? fact.sourceRunId,
    stateIndex: payload.stateIndex ?? fact.attributes.stateIndex,
    visibleControls,
  };
}

function overlapCoverage(targetUnits: ReadonlySet<string>, control: string): number {
  if (targetUnits.size === 0) return 0;
  const controlUnits = tokenizeLexicalUnits(control);
  if (controlUnits.size === 0) return 0;
  let hits = 0;
  for (const unit of targetUnits) {
    if (controlUnits.has(unit)) hits += 1;
  }
  return hits / targetUnits.size;
}

function targetIsRelevantToControls(target: string, snapshots: UiInventorySnapshot[]): boolean {
  for (const snapshot of snapshots) {
    if (snapshotIsRelevantToTarget(target, snapshot)) return true;
  }
  return false;
}

function snapshotIsRelevantToTarget(target: string, snapshot: UiInventorySnapshot): boolean {
  const normalizedTarget = normalizeLabel(target);
  const targetUnits = tokenizeLexicalUnits(target);
  for (const control of snapshot.visibleControls) {
    if (normalizeLabel(control) === normalizedTarget) return true;
    if (
      targetUnits.size > 1 &&
      overlapCoverage(targetUnits, control) > RELATED_CONTROL_COVERAGE_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
}

function snapshotRow(target: string, snapshot: UiInventorySnapshot): string {
  const normalizedTarget = normalizeLabel(target);
  const visible = snapshot.visibleControls.some(
    (control) => normalizeLabel(control) === normalizedTarget,
  );
  return `  - observedSnapshot: ${JSON.stringify({
    url: snapshot.url,
    sourceGoal: snapshot.sourceGoal,
    sourceRunId: snapshot.sourceRunId,
    stateIndex: snapshot.stateIndex,
    namedControlVisible: visible,
    visibleControls: snapshot.visibleControls.slice(0, MAX_VISIBLE_CONTROLS),
  })}`;
}

export function buildUiAvailabilitySummary(
  query: string,
  facts: ReadonlyArray<MemoryFact>,
): string | null {
  const snapshots = facts
    .map(snapshotFromFact)
    .filter((snapshot): snapshot is UiInventorySnapshot => snapshot !== null);
  if (snapshots.length === 0) return null;

  const targets = extractQuotedSpans(query)
    .filter((target) => targetIsRelevantToControls(target, snapshots))
    .slice(0, MAX_TARGETS);
  if (targets.length === 0) return null;

  const lines = [
    '### UI Availability Summary',
    'Generated from recalled UI inventories. Each row compares one explicit query label with one observed snapshot visibleControls list.',
  ];
  for (const target of targets) {
    lines.push(`- namedControl: ${JSON.stringify(target)}`);
    const relatedSnapshots = snapshots
      .filter((snapshot) => snapshotIsRelevantToTarget(target, snapshot))
      .slice(0, MAX_SNAPSHOTS_PER_TARGET);
    for (const snapshot of relatedSnapshots) {
      lines.push(snapshotRow(target, snapshot));
    }
  }
  return lines.join('\n');
}
