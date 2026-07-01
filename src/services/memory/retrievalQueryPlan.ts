// ---------------------------------------------------------------------------
// Kavi — Retrieval query planning
// ---------------------------------------------------------------------------
// Produces relevance-first query signals from the current turn. The cleanup is
// structural: it detects code-like/action-signature density and repeated
// machine tokens without matching English instructions or benchmark phrases.
// ---------------------------------------------------------------------------

export interface RetrievalQueryPlan {
  primarySignals: string[];
  supportingSignals: string[];
  droppedSignals: string[];
}

const MAX_SIGNAL_CHARS = 1_200;
const MAX_PRIMARY_SIGNALS = 4;
const MAX_SUPPORTING_SIGNALS = 8;
const MAX_EXTRACTED_SPANS = 8;
const FUNCTION_SIGNATURE_PATTERN = /[\p{L}_][\p{L}\p{N}_-]*\([^)]*\)/gu;
const MACHINE_PUNCTUATION_PATTERN = /[{}()[\]<>_=|,:;]/g;
const QUOTED_SPAN_PATTERN = /`([^`]{1,160})`|"([^"]{1,160})"|'([^']{1,160})'/gu;
const WHITESPACE_PATTERN = /\s+/g;
const WRAPPED_MARKER_PATTERN = /^(?:<[^<>]{1,80}>|\[[^\[\]]{1,80}\])$/u;
const LABEL_MARKER_PATTERN = /^[\p{L}\p{M}\p{N}\s#._/-]{1,80}:$/u;

export function planRetrievalSignals(rawSignals: ReadonlyArray<string>): RetrievalQueryPlan {
  const primarySignals: string[] = [];
  const supportingSignals: string[] = [];
  const droppedSignals: string[] = [];

  for (const rawSignal of rawSignals) {
    const signal = normalizeSignal(rawSignal);
    if (!signal) continue;

    const extracted: string[] = [];
    const keptLines: string[] = [];
    for (const rawLine of rawSignal.split(/\r?\n/)) {
      const line = normalizeSignal(rawLine);
      if (!line) continue;
      if (isMachineDenseLine(line)) {
        droppedSignals.push(line);
        continue;
      }
      if (isStructuralMarkerLine(line)) {
        droppedSignals.push(line);
        continue;
      }
      for (const span of extractQuotedSpans(line)) addUniqueSignal(extracted, span, MAX_EXTRACTED_SPANS);
      keptLines.push(line);
    }

    if (keptLines.length > 0) {
      addUniqueSignal(primarySignals, fitSignal(keptLines[0] ?? ''), MAX_PRIMARY_SIGNALS);
      if (keptLines.length > MAX_PRIMARY_SIGNALS) {
        addUniqueSignal(primarySignals, fitSignal(keptLines.join(' ')), MAX_PRIMARY_SIGNALS);
      }
      for (const line of keptLines.slice(1)) {
        addUniqueSignal(primarySignals, fitSignal(line), MAX_PRIMARY_SIGNALS);
      }
    }
    for (const span of extracted) addUniqueSignal(supportingSignals, span, MAX_SUPPORTING_SIGNALS);

    if (keptLines.length === 0) {
      for (const span of extracted) addUniqueSignal(primarySignals, span, MAX_PRIMARY_SIGNALS);
    }
  }

  return {
    primarySignals,
    supportingSignals: supportingSignals.filter((signal) => !primarySignals.includes(signal)),
    droppedSignals,
  };
}

function normalizeSignal(value: string): string {
  return value.normalize('NFKC').replace(WHITESPACE_PATTERN, ' ').trim();
}

function extractQuotedSpans(value: string): string[] {
  const spans: string[] = [];
  QUOTED_SPAN_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(QUOTED_SPAN_PATTERN)) {
    const span = normalizeSignal(match[1] ?? match[2] ?? match[3] ?? '');
    if (!span) continue;
    addUniqueSignal(spans, span, MAX_EXTRACTED_SPANS);
  }
  return spans;
}

function isMachineDenseLine(line: string): boolean {
  const signatures = Array.from(line.matchAll(FUNCTION_SIGNATURE_PATTERN)).length;
  if (signatures >= 2) return true;
  if (signatures === 0) return false;
  const punctuationCount = Array.from(line.matchAll(MACHINE_PUNCTUATION_PATTERN)).length;
  const punctuationRatio = punctuationCount / Math.max(1, line.length);
  return punctuationRatio >= 0.12;
}

function isStructuralMarkerLine(line: string): boolean {
  if (WRAPPED_MARKER_PATTERN.test(line)) return true;
  if (!LABEL_MARKER_PATTERN.test(line)) return false;
  const lexicalUnits = Array.from(line.matchAll(/[\p{L}\p{M}\p{N}]+/gu)).length;
  return lexicalUnits <= 6;
}

function fitSignal(value: string): string {
  if (value.length <= MAX_SIGNAL_CHARS) return value;
  return value.slice(0, MAX_SIGNAL_CHARS).trimEnd();
}

function addUniqueSignal(signals: string[], signal: string, limit: number): void {
  if (signals.length >= limit) return;
  const normalized = normalizeSignal(signal);
  if (!normalized || signals.includes(normalized)) return;
  signals.push(normalized);
}
