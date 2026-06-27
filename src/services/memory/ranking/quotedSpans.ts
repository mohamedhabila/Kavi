import { tokenizeLexicalUnits } from './lexical';

const STRONG_QUOTED_SPAN_PATTERNS = [
  /`([^`\n]{1,160})`/gu,
  /"([^"\n]{1,160})"/gu,
  /“([^”\n]{1,160})”/gu,
] as const;
const WEAK_QUOTED_SPAN_PATTERNS = [
  /(^|[^\p{L}\p{M}\p{N}])'([^'\n]{1,160})'(?=$|[^\p{L}\p{M}\p{N}])/gu,
  /(^|[^\p{L}\p{M}\p{N}])‘([^’\n]{1,160})’(?=$|[^\p{L}\p{M}\p{N}])/gu,
] as const;

type DelimitedSpan = {
  start: number;
  end: number;
  text: string;
};

function normalizeSpanText(raw: string | undefined): string | null {
  const text = (raw ?? '').normalize('NFKC').trim();
  return text.length > 0 ? text : null;
}

function spansOverlap(left: DelimitedSpan, right: DelimitedSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

function collectStrongSpans(query: string): DelimitedSpan[] {
  const spans: DelimitedSpan[] = [];
  for (const pattern of STRONG_QUOTED_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of query.matchAll(pattern)) {
      const text = normalizeSpanText(match[1]);
      if (!text) continue;
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        text,
      });
    }
  }
  return spans;
}

function collectWeakSpans(query: string): DelimitedSpan[] {
  const spans: DelimitedSpan[] = [];
  for (const pattern of WEAK_QUOTED_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of query.matchAll(pattern)) {
      const text = normalizeSpanText(match[2]);
      if (!text) continue;
      const boundaryLength = match[1]?.length ?? 0;
      spans.push({
        start: match.index + boundaryLength,
        end: match.index + match[0].length,
        text,
      });
    }
  }
  return spans;
}

export function extractDelimitedQuerySpans(query: string, limit: number): string[] {
  if (limit <= 0) return [];
  const strongSpans = collectStrongSpans(query);
  const weakSpans = collectWeakSpans(query).filter((weak) =>
    strongSpans.every((strong) => !spansOverlap(weak, strong)),
  );
  const spans = [...strongSpans, ...weakSpans].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.end - right.end;
  });
  const selected: string[] = [];
  for (const span of spans) {
    if (selected.includes(span.text)) continue;
    selected.push(span.text);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function quotedSpanUnitSets(query: string, limit: number): Set<string>[] {
  return extractDelimitedQuerySpans(query, limit)
    .map((span) => tokenizeLexicalUnits(span))
    .filter((units) => units.size > 0);
}
