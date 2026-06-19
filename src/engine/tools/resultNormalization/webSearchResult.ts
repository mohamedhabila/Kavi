import { limitArray } from './resultNormalizer';
import { MAX_LIST_ENTRIES, MAX_SEARCH_MATCHES, truncateText } from './transformers';

export type TextSearchMatch = {
  path: string;
  line: number;
  text: string;
};

export function normalizeGlobSearchResult(result: {
  pattern: string;
  path: string;
  matches: string[];
}): string {
  const normalizedMatches = result.matches.map((match) => truncateText(match, 240));
  const { items, omitted } = limitArray(normalizedMatches, MAX_LIST_ENTRIES);
  return JSON.stringify({
    summary:
      normalizedMatches.length > 0
        ? `Found ${normalizedMatches.length} files matching "${result.pattern}" under ${result.path}.`
        : `No files matched "${result.pattern}" under ${result.path}.`,
    pattern: result.pattern,
    path: result.path,
    count: normalizedMatches.length,
    matches: items,
    ...(omitted > 0 ? { omittedMatches: omitted } : {}),
  });
}

export function normalizeTextSearchResult(result: {
  query: string;
  path: string;
  isRegex: boolean;
  matches: TextSearchMatch[];
  truncated: boolean;
}): string {
  const normalizedMatches = result.matches.map((match) => ({
    path: match.path,
    line: match.line,
    text: truncateText(match.text.trim(), 240),
  }));
  const { items, omitted } = limitArray(normalizedMatches, MAX_SEARCH_MATCHES);
  return JSON.stringify({
    summary:
      normalizedMatches.length > 0
        ? `Found ${normalizedMatches.length} ${result.isRegex ? 'regex' : 'text'} matches for "${result.query}" under ${result.path}.${result.truncated ? ' Results were truncated.' : ''}`
        : `No ${result.isRegex ? 'regex' : 'text'} matches for "${result.query}" under ${result.path}.`,
    query: result.query,
    path: result.path,
    isRegex: result.isRegex,
    count: normalizedMatches.length,
    matches: items,
    truncated: result.truncated,
    ...(omitted > 0 ? { omittedMatches: omitted } : {}),
  });
}
