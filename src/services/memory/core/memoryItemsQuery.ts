// ---------------------------------------------------------------------------
// Kavi — Memory search query
// ---------------------------------------------------------------------------
// Turns free text in any language into an FTS5 trigram query. Terms are Unicode word
// sequences (letters, marks, numbers); a run of a script written without spaces (Han,
// Hiragana, Katakana, Thai, Lao, Khmer, Myanmar) is cut into the trigrams the index
// stores, so no word segmenter is needed. The trigram index cannot match a term shorter
// than three characters, so such terms are dropped. Terms are OR-ed and ranked by BM25:
// an item matching more and rarer terms ranks first.
// ---------------------------------------------------------------------------

const WORD_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const CONTINUOUS_SCRIPT_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{M}]+$/u;
const TRIGRAM_LENGTH = 3;
const MAX_QUERY_TERMS = 32;

function trigramsOf(codePoints: string[]): string[] {
  const grams: string[] = [];
  for (let index = 0; index + TRIGRAM_LENGTH <= codePoints.length; index += 1) {
    grams.push(codePoints.slice(index, index + TRIGRAM_LENGTH).join(''));
  }
  return grams;
}

/** Distinct search terms for `text`, longest first, capped at MAX_QUERY_TERMS. */
export function memorySearchTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.normalize('NFKC').toLocaleLowerCase().matchAll(WORD_SEQUENCE_PATTERN)) {
    const codePoints = Array.from(match[0]);
    if (codePoints.length < TRIGRAM_LENGTH) continue;
    if (CONTINUOUS_SCRIPT_PATTERN.test(match[0])) {
      for (const gram of trigramsOf(codePoints)) terms.add(gram);
    } else {
      terms.add(match[0]);
    }
  }
  return [...terms]
    .sort((left, right) => Array.from(right).length - Array.from(left).length)
    .slice(0, MAX_QUERY_TERMS);
}

/** An FTS5 MATCH expression for `text`, or null when it holds no searchable term. */
export function buildMemoryMatchExpression(text: string): string | null {
  const terms = memorySearchTerms(text);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}
