export interface AgentRunStep {
  stateIndex?: string | number;
  action?: string;
  thought?: string;
  url?: string;
  observation?: string;
  outcome?: string;
  status?: string;
  toolName?: string;
  toolResult?: string;
}

type JsonRecord = Record<string, unknown>;

const MAX_TEXT_CHARS = 900;
const MAX_COMPACT_STEPS_PER_RUN = 14;
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
const MULTILINE_SAMPLE_CONTEXT_LINES_BEFORE = 4;

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
  let endIndex = Math.min(lines.length, centerIndex + 1 + Math.max(0, missingPriorContext));

  while (startIndex < centerIndex || endIndex > centerIndex + 1) {
    const rendered = lines
      .slice(startIndex, endIndex)
      .map((line) => line.text)
      .join('\n');
    if (rendered.length <= windowChars) return rendered;
    if (endIndex > centerIndex + 1) {
      endIndex -= 1;
    } else {
      startIndex += 1;
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

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function spreadIndexes(indexes: ReadonlyArray<number>, limit: number): number[] {
  if (indexes.length <= limit) return [...indexes];
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

export function boundedSteps(steps: ReadonlyArray<AgentRunStep>): AgentRunStep[] {
  if (steps.length <= MAX_COMPACT_STEPS_PER_RUN) return [...steps];
  const candidateIndexes = Array.from(
    new Set([0, ...transitionStepIndexes(steps), steps.length - 1]),
  ).sort((a, b) => a - b);
  const selectedIndexes = new Set(spreadIndexes(candidateIndexes, MAX_COMPACT_STEPS_PER_RUN));
  if (selectedIndexes.size < MAX_COMPACT_STEPS_PER_RUN) {
    for (const index of spreadIndexes(
      Array.from({ length: steps.length }, (_, index) => index),
      MAX_COMPACT_STEPS_PER_RUN,
    )) {
      selectedIndexes.add(index);
      if (selectedIndexes.size >= MAX_COMPACT_STEPS_PER_RUN) break;
    }
  }
  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .map((index) => steps[index])
    .filter((step): step is AgentRunStep => step !== undefined);
}
