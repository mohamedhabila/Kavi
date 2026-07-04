export interface AgentRunStep {
  stateIndex?: string | number;
  action?: string;
  thought?: string;
  url?: string;
  observation?: string;
  observedControlSequence?: AgentRunObservedControl[];
  observedAffordances?: AgentRunObservedAffordance[];
  inputControlsPresent?: boolean;
  outcome?: string;
  status?: string;
  toolName?: string;
  toolResult?: string;
}

export interface AgentRunObservedAffordance {
  role: string;
  label?: string;
  attributes?: string;
  section?: string;
}

export type AgentRunObservedControl = AgentRunObservedAffordance;

type IndexedAgentRunObservedAffordance = AgentRunObservedAffordance & { index: number };

type JsonRecord = Record<string, unknown>;

const MAX_TEXT_CHARS = 900;
const MAX_COMPACT_STEPS_PER_RUN = 8;
const DEFAULT_AFFORDANCE_LIMIT = 36;
const DEFAULT_CONTROL_SEQUENCE_LIMIT = 72;
const MAX_AFFORDANCES_PER_ROLE = 18;
const MAX_SOURCE_EVIDENCE_STEP_INDEXES = 6;
const MAX_AFFORDANCE_LABEL_CHARS = 180;
const MAX_AFFORDANCE_ATTRIBUTES_CHARS = 160;
const MAX_LABEL_ANNOTATION_LOOKAHEAD_LINES = 8;
const MAX_SECTION_CONTEXT_DISTANCE_LINES = 18;
export const STEP_TEXT_LIMITS: Partial<Record<keyof AgentRunStep, number>> = {
  url: 220,
  action: 260,
  thought: 260,
  observation: 1_600,
  outcome: 360,
  status: 160,
  toolName: 160,
  toolResult: 360,
};
const MULTILINE_SAMPLE_WINDOW_COUNT = 7;
const MULTILINE_SAMPLE_MIN_WINDOW_CHARS = 32;
const MULTILINE_SAMPLE_CONTEXT_LINES_BEFORE = 2;
const MULTILINE_SAMPLE_CONTEXT_LINES_AFTER = 2;
const AFFORDANCE_LINE_PATTERN = /(?:\[[^\]]+\]\s*)?([A-Za-z][\w-]*)\s+(['"])(.*?)\2([^\n]*)/;
const AFFORDANCE_ROLE_PRIORITY = new Map<string, number>([
  ['menuitem', -1],
  ['option', 0],
  ['textbox', 0],
  ['combobox', 0],
  ['checkbox', 0],
  ['radio', 0],
  ['tab', 0],
  ['search', 1],
  ['button', 1],
  ['link', 2],
  ['listbox', 2],
  ['heading', 3],
  ['rowheader', 4],
  ['columnheader', 4],
  ['grid', 5],
  ['main', 5],
  ['menu', 5],
]);
const HIGH_VALUE_AFFORDANCE_ROLES = new Set([
  'menuitem',
  'option',
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'tab',
  'search',
]);
const CONTROL_SEQUENCE_ROLES = new Set([
  'menuitem',
  'option',
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'tab',
  'search',
  'button',
  'link',
  'listbox',
  'columnheader',
  'rowheader',
]);
const INPUT_AFFORDANCE_ROLES = new Set(['textbox', 'combobox', 'search']);
const LABEL_TEXT_HAS_CONTENT_PATTERN = /[\p{L}\p{M}\p{N}]/u;

interface ParsedAffordanceLine {
  index: number;
  role: string;
  label?: string;
  attributes?: string;
}

interface LabelAnnotation {
  index: number;
  label: string;
  annotation: string;
}

function fitLine(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\u2026`;
}

interface MultilineSampleLine {
  start: number;
  end: number;
  text: string;
}

function multilineSampleLines(value: string): MultilineSampleLine[] {
  const lines: MultilineSampleLine[] = [];
  let offset = 0;
  for (const rawLine of value.split(/(\r?\n)/)) {
    if (rawLine === '\n' || rawLine === '\r\n') {
      offset += rawLine.length;
      continue;
    }
    const line = rawLine.trim();
    if (line.length > 0) lines.push({ start: offset, end: offset + rawLine.length, text: line });
    offset += rawLine.length;
  }
  return lines;
}

function lineIndexForCenter(lines: ReadonlyArray<MultilineSampleLine>, center: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (line.start <= center && center <= line.end) return index;
    if (line.start > center) return Math.max(0, index - 1);
  }
  return Math.max(0, lines.length - 1);
}

function sampleWindow(
  lines: ReadonlyArray<MultilineSampleLine>,
  center: number,
  maxChars: number,
): string {
  const windowChars = Math.max(MULTILINE_SAMPLE_MIN_WINDOW_CHARS, maxChars);
  const centerIndex = lineIndexForCenter(lines, center);
  let startIndex = Math.max(0, centerIndex - MULTILINE_SAMPLE_CONTEXT_LINES_BEFORE);
  const missingPriorContext = MULTILINE_SAMPLE_CONTEXT_LINES_BEFORE - (centerIndex - startIndex);
  let endIndex = Math.min(
    lines.length,
    centerIndex + 1 + MULTILINE_SAMPLE_CONTEXT_LINES_AFTER + Math.max(0, missingPriorContext),
  );
  const missingFollowingContext =
    MULTILINE_SAMPLE_CONTEXT_LINES_AFTER - Math.max(0, endIndex - centerIndex - 1);
  if (missingFollowingContext > 0) {
    startIndex = Math.max(0, startIndex - missingFollowingContext);
  }

  while (startIndex < centerIndex || endIndex > centerIndex + 1) {
    const rendered = lines
      .slice(startIndex, endIndex)
      .map((line) => line.text)
      .join('\n');
    if (rendered.length <= windowChars) return rendered;
    const linesAfter = Math.max(0, endIndex - centerIndex - 1);
    const linesBefore = Math.max(0, centerIndex - startIndex);
    if (endIndex > centerIndex + 1 && linesAfter >= linesBefore) {
      endIndex -= 1;
    } else if (startIndex < centerIndex) {
      startIndex += 1;
    } else {
      endIndex -= 1;
    }
  }

  return fitLine(lines[centerIndex]?.text ?? '', windowChars);
}

function fitMultilineText(value: string, maxChars: number): string | null {
  const lines = multilineSampleLines(value);
  if (lines.length < 4) return null;

  const separator = '\n\u2026\n';
  const text = value.trim();
  const maxWindowCount = Math.min(MULTILINE_SAMPLE_WINDOW_COUNT, lines.length);
  for (let windowCount = maxWindowCount; windowCount >= 2; windowCount -= 1) {
    const windowBudget = Math.max(
      MULTILINE_SAMPLE_MIN_WINDOW_CHARS,
      Math.floor((maxChars - 1 - (windowCount - 1) * separator.length) / windowCount),
    );
    const lastIndex = Math.max(0, text.length - 1);
    const sampled = Array.from({ length: windowCount }, (_, slot) => {
      const center = windowCount === 1 ? 0 : Math.round((slot * lastIndex) / (windowCount - 1));
      return sampleWindow(lines, center, windowBudget);
    });
    const rendered = sampled.join(separator);
    if (rendered.length <= maxChars - 1) return `${rendered}\u2026`;
  }

  return null;
}

export function fitAgentRunText(value: string, maxChars = MAX_TEXT_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const multiline = fitMultilineText(trimmed, maxChars);
  if (multiline) return multiline;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

export function observedAgentRunText(record: JsonRecord): string | undefined {
  return (
    stringField(record, 'observation') ??
    stringField(record, 'accessibility_tree') ??
    stringField(record, 'toolResult') ??
    stringField(record, 'tool_result')
  );
}

export function observedAgentRunOutput(
  observed: string | undefined,
  representedValues: ReadonlyArray<string | undefined>,
): string | undefined {
  if (!observed) return undefined;
  const observationLimit = STEP_TEXT_LIMITS.observation ?? MAX_TEXT_CHARS;
  const fitted = fitAgentRunText(observed, observationLimit);
  return representedValues.some(
    (value) => value && fitAgentRunText(value, observationLimit) === fitted,
  )
    ? undefined
    : fitted;
}

function compactAffordanceText(value: string, maxChars: number): string | undefined {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return fitAgentRunText(compacted, maxChars);
}

function parseAffordanceLine(line: string, index: number): ParsedAffordanceLine | null {
  const match = AFFORDANCE_LINE_PATTERN.exec(line.trim());
  if (!match) return null;
  const role = match[1]?.toLocaleLowerCase();
  if (!role) return null;
  const label = compactAffordanceText(match[3] ?? '', MAX_AFFORDANCE_LABEL_CHARS);
  const attributes = compactAffordanceText(match[4] ?? '', MAX_AFFORDANCE_ATTRIBUTES_CHARS);
  return {
    index,
    role,
    ...(label ? { label } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

function hasVisibleLabelText(value: string | undefined): value is string {
  return typeof value === 'string' && LABEL_TEXT_HAS_CONTENT_PATTERN.test(value);
}

function extractLabelAnnotations(
  lines: ReadonlyArray<string>,
  parsedLines: ReadonlyArray<ParsedAffordanceLine | null>,
): LabelAnnotation[] {
  const annotations: LabelAnnotation[] = [];
  let pending: { annotation: string; index: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed) continue;
    if (pending && index - pending.index > MAX_LABEL_ANNOTATION_LOOKAHEAD_LINES) {
      pending = null;
    }
    if (parsed.role === 'note' && hasVisibleLabelText(parsed.label)) {
      pending = { annotation: parsed.label, index };
      continue;
    }
    if (parsed.role !== 'statictext' || !pending || !hasVisibleLabelText(parsed.label)) {
      continue;
    }
    annotations.push({
      index,
      label: parsed.label,
      annotation: pending.annotation,
    });
    pending = null;
  }

  return annotations;
}

function nearestPriorLabelAnnotation(
  annotations: ReadonlyArray<LabelAnnotation>,
  label: string | undefined,
  controlIndex: number,
): string | undefined {
  if (!label) return undefined;
  let nearest: LabelAnnotation | undefined;
  for (const annotation of annotations) {
    if (annotation.label !== label) continue;
    if (annotation.index >= controlIndex) continue;
    if (controlIndex - annotation.index > MAX_LABEL_ANNOTATION_LOOKAHEAD_LINES) continue;
    if (!nearest || annotation.index > nearest.index) nearest = annotation;
  }
  return nearest?.annotation;
}

function attributesWithAnnotation(
  attributes: string | undefined,
  annotation: string | undefined,
): string | undefined {
  if (!annotation) return attributes;
  const annotationText = `note='${annotation}'`;
  return attributes ? `${attributes}; ${annotationText}` : annotationText;
}

function nearestPriorSectionLabel(
  parsedLines: ReadonlyArray<ParsedAffordanceLine | null>,
  controlIndex: number,
): string | undefined {
  for (let index = controlIndex - 1; index >= 0; index -= 1) {
    if (controlIndex - index > MAX_SECTION_CONTEXT_DISTANCE_LINES) break;
    const parsed = parsedLines[index];
    if (parsed?.role === 'heading' && hasVisibleLabelText(parsed.label)) return parsed.label;
  }
  return undefined;
}

function indexedObservedAffordances(
  observed: string | undefined,
): IndexedAgentRunObservedAffordance[] {
  if (!observed) return [];
  const lines = observed.split(/\r?\n/);
  const parsedLines = lines.map((line, index) => parseAffordanceLine(line, index));
  const annotations = extractLabelAnnotations(lines, parsedLines);
  return parsedLines
    .map((entry): IndexedAgentRunObservedAffordance | null => {
      if (!entry || !AFFORDANCE_ROLE_PRIORITY.has(entry.role)) return null;
      const annotation = nearestPriorLabelAnnotation(annotations, entry.label, entry.index);
      const section =
        entry.role === 'heading' ? undefined : nearestPriorSectionLabel(parsedLines, entry.index);
      const attributes = attributesWithAnnotation(entry.attributes, annotation);
      if (
        !entry.label &&
        entry.role !== 'textbox' &&
        entry.role !== 'search' &&
        entry.role !== 'main' &&
        entry.role !== 'grid'
      ) {
        return null;
      }
      return {
        index: entry.index,
        role: entry.role,
        ...(entry.label ? { label: entry.label } : {}),
        ...(attributes ? { attributes } : {}),
        ...(section ? { section } : {}),
      };
    })
    .filter((entry): entry is IndexedAgentRunObservedAffordance => entry !== null);
}

export function observedAgentRunAffordances(
  observed: string | undefined,
  limit = DEFAULT_AFFORDANCE_LIMIT,
): AgentRunObservedAffordance[] | undefined {
  const parsed = indexedObservedAffordances(observed);
  if (parsed.length === 0) return undefined;

  const seen = new Set<string>();
  const unique = parsed.filter((entry) => {
    const key = `${entry.role}\u0000${entry.label ?? ''}\u0000${entry.attributes ?? ''}\u0000${
      entry.section ?? ''
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const roleCapped = Array.from(groupAffordancesByRole(unique).values()).flatMap((entries) =>
    selectSpreadEntries(entries, MAX_AFFORDANCES_PER_ROLE),
  );
  roleCapped.sort((left, right) => {
    const priorityDelta =
      (AFFORDANCE_ROLE_PRIORITY.get(left.role) ?? 9) -
      (AFFORDANCE_ROLE_PRIORITY.get(right.role) ?? 9);
    return priorityDelta !== 0 ? priorityDelta : left.index - right.index;
  });

  return selectSpreadEntries(roleCapped, Math.max(1, limit)).map(
    ({ index: _index, ...entry }) => entry,
  );
}

export function observedAgentRunControlSequence(
  observed: string | undefined,
  limit = DEFAULT_CONTROL_SEQUENCE_LIMIT,
): AgentRunObservedControl[] | undefined {
  const parsed = indexedObservedAffordances(observed).filter((entry) =>
    CONTROL_SEQUENCE_ROLES.has(entry.role),
  );
  if (parsed.length === 0) return undefined;

  let previousKey: string | undefined;
  const compacted = parsed.filter((entry) => {
    const key = `${entry.role}\u0000${entry.label ?? ''}\u0000${entry.attributes ?? ''}\u0000${
      entry.section ?? ''
    }`;
    if (key === previousKey) return false;
    previousKey = key;
    return true;
  });

  return selectSpreadEntries(compacted, Math.max(1, limit)).map(
    ({ index: _index, ...entry }) => entry,
  );
}

export function observedInputControlsPresent(
  affordances: ReadonlyArray<AgentRunObservedAffordance> | undefined,
): boolean | undefined {
  if (!affordances || affordances.length === 0) return undefined;
  return affordances.some((affordance) => INPUT_AFFORDANCE_ROLES.has(affordance.role));
}

function groupAffordancesByRole<T extends { role: string }>(
  entries: ReadonlyArray<T>,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const group = groups.get(entry.role) ?? [];
    group.push(entry);
    groups.set(entry.role, group);
  }
  return groups;
}

function selectSpreadEntries<T>(entries: ReadonlyArray<T>, limit: number): T[] {
  if (entries.length <= limit) return [...entries];
  return spreadIndexes(
    Array.from({ length: entries.length }, (_, index) => index),
    Math.max(1, limit),
  )
    .map((index) => entries[index])
    .filter((entry): entry is T => entry !== undefined);
}

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function spreadIndexes(indexes: ReadonlyArray<number>, limit: number): number[] {
  if (indexes.length <= limit) return [...indexes];
  if (limit <= 1) return indexes[0] === undefined ? [] : [indexes[0]];
  const lastIndex = indexes.length - 1;
  const selected: number[] = [];
  const seen = new Set<number>();
  for (let slot = 0; slot < limit; slot += 1) {
    const sourceIndex = Math.round((slot * lastIndex) / (limit - 1));
    const index = indexes[sourceIndex];
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
    selected.push(index);
  }
  return selected;
}

function transitionStepIndexes(steps: ReadonlyArray<AgentRunStep>): number[] {
  const indexes: number[] = [];
  let previousUrl: string | undefined;
  let previousTransitionIndex = Number.NEGATIVE_INFINITY;
  steps.forEach((step, index) => {
    if (!step.url || step.url === previousUrl) return;
    if (index !== previousTransitionIndex + 1) {
      indexes.push(index);
    }
    previousTransitionIndex = index;
    previousUrl = step.url;
  });
  return indexes;
}

function sourceEvidenceStepIndexes(steps: ReadonlyArray<AgentRunStep>): number[] {
  return steps
    .map((step, index) => ({ index, score: sourceEvidenceStepScore(step) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, MAX_SOURCE_EVIDENCE_STEP_INDEXES)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
}

function sourceEvidenceStepScore(step: AgentRunStep): number {
  let score = 0;
  for (const affordance of step.observedAffordances ?? []) {
    if (!HIGH_VALUE_AFFORDANCE_ROLES.has(affordance.role)) continue;
    if (affordance.role === 'menuitem' || affordance.role === 'option') {
      score += 5;
    } else if (affordance.role === 'textbox' || affordance.role === 'combobox') {
      score += 2;
    } else {
      score += 1;
    }
  }
  for (const control of step.observedControlSequence ?? []) {
    if (!control.label && control.role !== 'textbox' && control.role !== 'search') continue;
    score += HIGH_VALUE_AFFORDANCE_ROLES.has(control.role) ? 2 : 1;
  }
  return score;
}

export function boundedSteps(
  steps: ReadonlyArray<AgentRunStep>,
  maxSteps = MAX_COMPACT_STEPS_PER_RUN,
): AgentRunStep[] {
  const limit = Math.max(1, maxSteps);
  if (steps.length <= limit) return [...steps];
  const candidateIndexes = Array.from(
    new Set([
      0,
      ...transitionStepIndexes(steps),
      ...sourceEvidenceStepIndexes(steps),
      steps.length - 1,
    ]),
  ).sort((a, b) => a - b);
  const selectedIndexes = new Set(spreadIndexes(candidateIndexes, limit));
  if (selectedIndexes.size < limit) {
    for (const index of spreadIndexes(
      Array.from({ length: steps.length }, (_, index) => index),
      limit,
    )) {
      selectedIndexes.add(index);
      if (selectedIndexes.size >= limit) break;
    }
  }
  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .map((index) => steps[index])
    .filter((step): step is AgentRunStep => step !== undefined);
}
