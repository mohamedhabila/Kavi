import type { MemoryFact } from './facts/types';
import { extractDelimitedQuerySpans } from './ranking/quotedSpans';
import { lexicalOverlap, tokenizeLexicalUnits } from './ranking/lexical';

const MAX_TARGETS = 4;
const MAX_SNAPSHOTS_PER_TARGET = 8;
const MAX_VISIBLE_CONTROLS = 40;
const MAX_SECTION_CONTROLS = 32;
const MAX_DISTINCT_SECTION_SETS = 6;
const MAX_SECTION_SET_OBSERVATIONS = 3;
const RELATED_CONTROL_COVERAGE_THRESHOLD = 0.5;

type UiSectionSnapshot = {
  label: string;
  controlNames: string[];
  index: number;
};

type UiInventorySnapshot = {
  url?: unknown;
  routeContext?: RouteContext;
  sourceGoal?: unknown;
  sourceRunId?: unknown;
  stateIndex?: unknown;
  visibleControls: string[];
  sections: UiSectionSnapshot[];
};

type RouteContext = {
  routePrefix: string;
  routeSuffix?: string;
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
  return extractDelimitedQuerySpans(query, MAX_TARGETS * 3);
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

function sectionSnapshotsFromPayload(payload: Record<string, unknown>): UiSectionSnapshot[] {
  if (!Array.isArray(payload.sections)) return [];
  const sections: UiSectionSnapshot[] = [];
  for (const entry of payload.sections) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.label !== 'string' || !record.label.trim()) continue;
    const controlNames = Array.isArray(record.controlNames)
      ? record.controlNames.filter(
          (control): control is string => typeof control === 'string' && control.trim().length > 0,
        )
      : [];
    sections.push({
      label: record.label,
      controlNames,
      index: sections.length,
    });
  }
  return sections;
}

function snapshotFromFact(fact: MemoryFact): UiInventorySnapshot | null {
  if (fact.memoryKind !== 'ui_inventory') return null;
  const payload = parseJsonRecord(fact.objectText);
  if (!payload) return null;
  const visibleControls = visibleControlsFromPayload(payload);
  const sections = sectionSnapshotsFromPayload(payload);
  if (visibleControls.length === 0 && sections.length === 0) return null;
  return {
    url: payload.url ?? fact.attributes.url,
    routeContext: routeContextFromUrl(payload.url ?? fact.attributes.url),
    sourceGoal: payload.sourceGoal ?? payload.goal ?? fact.attributes.goal,
    sourceRunId: payload.sourceRunId ?? fact.sourceRunId,
    stateIndex: payload.stateIndex ?? fact.attributes.stateIndex,
    visibleControls,
    sections,
  };
}

function routeContextFromUrl(rawUrl: unknown): RouteContext | undefined {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return undefined;
  let path = rawUrl;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    path = rawUrl;
  }
  const segments = path.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return undefined;
  const prefixSegments = segments.slice(0, Math.min(2, segments.length));
  const routePrefix = `/${prefixSegments.join('/')}`;
  const suffix = segments.slice(prefixSegments.length).join('/');
  return suffix ? { routePrefix, routeSuffix: suffix } : { routePrefix };
}

function overlapCoverage(targetUnits: ReadonlySet<string>, value: string): number {
  if (targetUnits.size === 0) return 0;
  const valueUnits = tokenizeLexicalUnits(value);
  if (valueUnits.size === 0) return 0;
  let hits = 0;
  for (const unit of targetUnits) {
    if (valueUnits.has(unit)) hits += 1;
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
  if (snapshot.sections.some((section) => sectionMatchesTarget(target, section))) return true;
  if (snapshot.visibleControls.some((control) => controlMatchesTarget(target, control))) return true;
  return false;
}

function controlMatchesTarget(target: string, control: string): boolean {
  const normalizedTarget = normalizeLabel(target);
  const targetUnits = tokenizeLexicalUnits(target);
  if (normalizeLabel(control) === normalizedTarget) return true;
  return (
    targetUnits.size > 1 &&
    overlapCoverage(targetUnits, control) > RELATED_CONTROL_COVERAGE_THRESHOLD
  );
}

function sectionMatchesTarget(target: string, section: UiSectionSnapshot): boolean {
  const normalizedTarget = normalizeLabel(target);
  const targetUnits = tokenizeLexicalUnits(target);
  if (normalizeLabel(section.label) === normalizedTarget) return true;
  return (
    targetUnits.size > 1 &&
    overlapCoverage(targetUnits, section.label) > RELATED_CONTROL_COVERAGE_THRESHOLD
  );
}

function targetControlIsVisible(target: string, snapshot: UiInventorySnapshot): boolean {
  const normalizedTarget = normalizeLabel(target);
  return snapshot.visibleControls.some((control) => normalizeLabel(control) === normalizedTarget);
}

function matchingSectionsForTarget(
  target: string,
  snapshot: UiInventorySnapshot,
): Array<{ label: string; controlNames: string[]; nearbySectionLabels: string[] }> {
  return snapshot.sections
    .filter((section) => sectionMatchesTarget(target, section))
    .map((section) => ({
      label: section.label,
      controlNames: section.controlNames.slice(0, MAX_SECTION_CONTROLS),
      nearbySectionLabels: snapshot.sections
        .filter((candidate) => candidate.index !== section.index)
        .filter((candidate) => Math.abs(candidate.index - section.index) <= 2)
        .map((candidate) => candidate.label)
        .slice(0, 4),
    }));
}

function signatureText(value: string): string {
  const units = Array.from(tokenizeLexicalUnits(value)).sort();
  return units.length > 0 ? units.join(' ') : normalizeLabel(value);
}

function matchingSectionsSignature(
  target: string,
  snapshot: UiInventorySnapshot,
): string {
  return matchingSectionsForTarget(target, snapshot)
    .map((section) => {
      const controls = section.controlNames.map(signatureText).sort().join('|');
      return `${signatureText(section.label)}:${controls}`;
    })
    .join('||');
}

function snapshotDescriptor(snapshot: UiInventorySnapshot): string {
  return [
    snapshot.url,
    snapshot.routeContext?.routePrefix,
    snapshot.routeContext?.routeSuffix,
    snapshot.sourceGoal,
    snapshot.sourceRunId,
    snapshot.visibleControls.slice(0, MAX_VISIBLE_CONTROLS).join(' '),
    snapshot.sections.map((section) => section.label).join(' '),
  ]
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .join(' ');
}

function longLexicalUnits(units: Set<string>): Set<string> {
  const longUnits = new Set<string>();
  for (const unit of units) {
    if (Array.from(unit).length >= 4) longUnits.add(unit);
  }
  return longUnits.size > 0 ? longUnits : units;
}

function routeOverlapScore(queryUnits: Set<string>, rawUrl: unknown): number {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || queryUnits.size === 0) return 0;
  let pathText = rawUrl;
  try {
    pathText = new URL(rawUrl).pathname;
  } catch {
    pathText = rawUrl;
  }
  const routeUnits = tokenizeLexicalUnits(pathText);
  if (routeUnits.size === 0) return 0;
  let hits = 0;
  for (const unit of queryUnits) {
    if (routeUnits.has(unit)) hits += 1;
  }
  return hits / queryUnits.size;
}

function sortedSnapshotsForTarget(
  queryUnits: Set<string>,
  target: string,
  snapshots: UiInventorySnapshot[],
): UiInventorySnapshot[] {
  const routeQueryUnits = longLexicalUnits(queryUnits);
  const ranked = snapshots
    .filter((snapshot) => snapshotIsRelevantToTarget(target, snapshot))
    .map((snapshot) => ({
      snapshot,
      score:
        routeOverlapScore(routeQueryUnits, snapshot.url) * 8 +
        lexicalOverlap(queryUnits, snapshotDescriptor(snapshot)),
      signature: matchingSectionsSignature(target, snapshot),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftState = Number(left.snapshot.stateIndex);
      const rightState = Number(right.snapshot.stateIndex);
      if (Number.isFinite(leftState) && Number.isFinite(rightState) && rightState !== leftState) {
        return rightState - leftState;
      }
      return String(left.snapshot.sourceRunId ?? '').localeCompare(String(right.snapshot.sourceRunId ?? ''));
    });
  const primary: UiInventorySnapshot[] = [];
  const duplicates: UiInventorySnapshot[] = [];
  const seenSignatures = new Set<string>();
  for (const entry of ranked) {
    if (entry.signature && !seenSignatures.has(entry.signature)) {
      primary.push(entry.snapshot);
      seenSignatures.add(entry.signature);
    } else {
      duplicates.push(entry.snapshot);
    }
  }
  return [...primary, ...duplicates].slice(0, MAX_SNAPSHOTS_PER_TARGET);
}

function snapshotRow(target: string, snapshot: UiInventorySnapshot): string {
  const visible = targetControlIsVisible(target, snapshot);
  const matchingSections = matchingSectionsForTarget(target, snapshot);
  return `  - observedSnapshot: ${JSON.stringify({
    url: snapshot.url,
    routeContext: snapshot.routeContext,
    sourceGoal: snapshot.sourceGoal,
    sourceRunId: snapshot.sourceRunId,
    stateIndex: snapshot.stateIndex,
    namedControlVisible: visible,
    namedSectionPresent: matchingSections.length > 0,
    matchingSections: matchingSections.length > 0 ? matchingSections : undefined,
    visibleControls: snapshot.visibleControls.slice(0, MAX_VISIBLE_CONTROLS),
  })}`;
}

function distinctSectionControlSetRows(
  target: string,
  snapshots: UiInventorySnapshot[],
  routeQueryUnits: Set<string>,
): string[] {
  const bySignature = new Map<
    string,
    {
      label: string;
      controlNames: string[];
      routeScore: number;
      observations: Array<{
        url?: unknown;
        routeContext?: RouteContext;
        sourceGoal?: unknown;
        sourceRunId?: unknown;
        stateIndex?: unknown;
        nearbySectionLabels: string[];
      }>;
    }
  >();
  for (const snapshot of snapshots) {
    for (const section of matchingSectionsForTarget(target, snapshot)) {
      const signature = `${signatureText(section.label)}:${section.controlNames
        .map(signatureText)
        .sort()
        .join('|')}`;
      const existing = bySignature.get(signature) ?? {
        label: section.label,
        controlNames: section.controlNames,
        routeScore: 0,
        observations: [],
      };
      existing.routeScore = Math.max(
        existing.routeScore,
        routeOverlapScore(routeQueryUnits, snapshot.url),
      );
      if (existing.observations.length < MAX_SECTION_SET_OBSERVATIONS) {
        existing.observations.push({
          url: snapshot.url,
          routeContext: snapshot.routeContext,
          sourceGoal: snapshot.sourceGoal,
          sourceRunId: snapshot.sourceRunId,
          stateIndex: snapshot.stateIndex,
          nearbySectionLabels: section.nearbySectionLabels,
        });
      }
      bySignature.set(signature, existing);
    }
    if (bySignature.size >= MAX_DISTINCT_SECTION_SETS) break;
  }
  if (bySignature.size === 0) return [];
  const entries = Array.from(bySignature.values()).sort((left, right) => {
    if (right.routeScore !== left.routeScore) return right.routeScore - left.routeScore;
    return 0;
  });
  return [
    '  - distinctObservedSectionControlSets:',
    ...entries.map(({ routeScore: _routeScore, ...entry }) => `    - ${JSON.stringify(entry)}`),
  ];
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
  const queryUnits = tokenizeLexicalUnits(query);
  const routeQueryUnits = longLexicalUnits(queryUnits);

  const lines = [
    '### UI Availability Summary',
    'Generated from recalled UI inventories. matchingSections.controlNames is direct evidence for controls observed under the queried UI label; nearbySectionLabels provide adjacent UI context.',
  ];
  for (const target of targets) {
    lines.push(`- namedControl: ${JSON.stringify(target)}`);
    const relatedSnapshots = sortedSnapshotsForTarget(queryUnits, target, snapshots);
    lines.push(...distinctSectionControlSetRows(target, relatedSnapshots, routeQueryUnits));
    for (const snapshot of relatedSnapshots) {
      lines.push(snapshotRow(target, snapshot));
    }
  }
  return lines.join('\n');
}
