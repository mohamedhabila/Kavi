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
const FUNCTION_SIGNATURE_PATTERN = /[\p{L}_][\p{L}\p{N}_-]*\s*\([^)]*\)/gu;
const MACHINE_PUNCTUATION_PATTERN = /[{}()[\]<>_=|,:;]/g;
const QUOTED_SPAN_PATTERN = /`([^`]{1,160})`|"([^"]{1,160})"|'([^']{1,160})'/gu;
const WHITESPACE_PATTERN = /\s+/g;
const CONTENT_CHAR_PATTERN = /[\p{L}\p{M}\p{N}]/gu;
const MIN_REDACTED_CONTENT_CHARS = 3;

export function planRetrievalSignals(rawSignals: ReadonlyArray<string>): RetrievalQueryPlan {
  const primarySignals: string[] = [];
  const supportingSignals: string[] = [];
  const droppedSignals: string[] = [];

  for (const rawSignal of rawSignals) {
    const signal = normalizeSignal(rawSignal);
    if (!signal) continue;
    const extracted = extractQuotedSpans(signal);
    for (const span of extracted) addUniqueSignal(supportingSignals, span, MAX_SUPPORTING_SIGNALS);

    const cleanedLines: string[] = [];
    for (const rawLine of rawSignal.split(/\r?\n/)) {
      const line = normalizeSignal(rawLine);
      if (!line) continue;
      if (isMachineDenseLine(line)) {
        droppedSignals.push(line);
        continue;
      }
      cleanedLines.push(line);
    }

    const cleaned = normalizeSignal(cleanedLines.join('\n'));
    if (cleaned) {
      const redacted = normalizeSignal(redactQuotedSpans(cleaned));
      if (redacted && redacted !== cleaned && contentCharCount(redacted) >= MIN_REDACTED_CONTENT_CHARS) {
        addUniqueSignal(primarySignals, fitSignal(redacted), MAX_PRIMARY_SIGNALS);
        addUniqueSignal(supportingSignals, fitSignal(cleaned), MAX_SUPPORTING_SIGNALS);
      } else {
        addUniqueSignal(primarySignals, fitSignal(cleaned), MAX_PRIMARY_SIGNALS);
      }
    } else {
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

function redactQuotedSpans(value: string): string {
  QUOTED_SPAN_PATTERN.lastIndex = 0;
  return value.replace(QUOTED_SPAN_PATTERN, ' ');
}

function contentCharCount(value: string): number {
  return Array.from(value.matchAll(CONTENT_CHAR_PATTERN)).length;
}

function isMachineDenseLine(line: string): boolean {
  const signatures = Array.from(line.matchAll(FUNCTION_SIGNATURE_PATTERN)).length;
  if (signatures >= 2) return true;
  if (signatures === 0) return false;
  const punctuationCount = Array.from(line.matchAll(MACHINE_PUNCTUATION_PATTERN)).length;
  const punctuationRatio = punctuationCount / Math.max(1, line.length);
  return punctuationRatio >= 0.12;
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
