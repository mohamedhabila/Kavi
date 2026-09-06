import {
  findGraphemeSafeOverlapLength,
  snapIndexDownToGraphemeBoundary,
  snapIndexUpToGraphemeBoundary,
  truncateGraphemesWithSuffix,
} from '../../src/utils/graphemeBoundary';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
  startsOnGraphemeBoundary,
  SURROGATE_PAIR_EMOJI,
} from '../helpers/graphemeTestFixtures';

describe('snapIndexDownToGraphemeBoundary / snapIndexUpToGraphemeBoundary', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`snaps an index inside ${name} down to before it, and up to after it`, () => {
      const prefix = 'a'.repeat(20);
      const text = `${prefix}${cluster}z`;
      const insideIndex = prefix.length + 1; // one code unit into the cluster

      const down = snapIndexDownToGraphemeBoundary(text, insideIndex);
      const up = snapIndexUpToGraphemeBoundary(text, insideIndex);

      expect(down).toBe(prefix.length);
      expect(up).toBe(prefix.length + cluster.length);
      expectGraphemeSafe(text.slice(0, down));
      expectGraphemeSafe(text.slice(up));
      expect(endsOnGraphemeBoundary(text, text.slice(0, down))).toBe(true);
      expect(startsOnGraphemeBoundary(text, text.slice(up))).toBe(true);
    });
  }

  it('clamps to [0, text.length]', () => {
    expect(snapIndexDownToGraphemeBoundary('abc', -5)).toBe(0);
    expect(snapIndexDownToGraphemeBoundary('abc', 999)).toBe(3);
    expect(snapIndexUpToGraphemeBoundary('abc', -5)).toBe(0);
    expect(snapIndexUpToGraphemeBoundary('abc', 999)).toBe(3);
  });

  it('leaves an already-boundary-aligned index untouched', () => {
    const text = `ab${SURROGATE_PAIR_EMOJI}cd`;
    expect(snapIndexDownToGraphemeBoundary(text, 2)).toBe(2);
    expect(snapIndexUpToGraphemeBoundary(text, 2)).toBe(2);
  });
});

describe('truncateGraphemesWithSuffix', () => {
  it('returns text unchanged when within budget, without appending the suffix', () => {
    expect(truncateGraphemesWithSuffix('hello', 10, '...')).toBe('hello');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`keeps ${name} intact when it straddles the truncation budget`, () => {
      const boundary = 50;
      const text = buildBoundaryStraddlingText(boundary, cluster, 40);
      const result = truncateGraphemesWithSuffix(text, boundary, '...');

      expect(result.endsWith('...')).toBe(true);
      expectGraphemeSafe(result);
      const cutText = result.slice(0, -'...'.length);
      expect(endsOnGraphemeBoundary(text, cutText)).toBe(true);
    });
  }

  it('reserves room for the suffix so the total never exceeds maxLength graphemes', () => {
    const text = 'x'.repeat(100);
    const result = truncateGraphemesWithSuffix(text, 20, '...');
    expect(Array.from(result).length).toBeLessThanOrEqual(20);
    expect(result.endsWith('...')).toBe(true);
  });

  // Regression test — src/engine/tools/builtin-expoCompaction.ts, migrated
  // onto a duplicate `truncateGraphemesWithSuffix` that delegated to
  // `truncateGraphemesTo`'s DEFAULT sentence/whitespace boundary search. That
  // search is meant for readability-oriented previews without a suffix; here
  // it silently cut a whole extra sentence (66+ chars) before the hard limit
  // whenever a sentence terminator fell within the 80-grapheme search window,
  // because the ellipsis suffix already signals truncation and a caller
  // reserving exact room for it expects the rest of the budget to be used.
  it('cuts exactly at the reserved budget even when a sentence boundary falls inside the search window', () => {
    const text =
      'Push a commit to main or another branch matched by the workflow on.push trigger. ' +
      'Monitor the automatically triggered run with expo_eas_workflow_runs, expo_eas_workflow_status, expo_eas_workflow_wait.';
    const maxLength = 128;
    const result = truncateGraphemesWithSuffix(text, maxLength, '...');

    expect(Array.from(result).length).toBeLessThanOrEqual(maxLength);
    // The sentence terminator ("trigger.") sits well inside the default
    // 80-grapheme search window before the hard cut; a boundary-preferring
    // cut would stop there and never reach "Monitor". The suffix-aware cut
    // must still reach into the second sentence.
    expect(result).toContain('Monitor the automatically triggered run');
  });
});

describe('findGraphemeSafeOverlapLength', () => {
  it('finds the full overlap for plain ASCII text', () => {
    const existing = 'The quick brown fox';
    const incoming = 'brown fox jumps over';
    const overlap = findGraphemeSafeOverlapLength(existing, incoming);
    expect(overlap).toBe('brown fox'.length);
  });

  it('returns 0 when there is no overlap', () => {
    expect(findGraphemeSafeOverlapLength('hello', 'world')).toBe(0);
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never returns an overlap length that splits ${name} in the incoming text`, () => {
      // The overlapping region straddles a cluster boundary in `incoming`: the
      // seam falls right after "shared" + partial cluster, which is exactly
      // the split point a naive code-unit scan could return.
      const shared = `shared context ${cluster} tail`;
      const existing = `preamble ${shared}`;
      const incoming = `${shared} continues`;

      const overlap = findGraphemeSafeOverlapLength(existing, incoming);
      const merged = `${existing}${incoming.slice(overlap)}`;

      expectGraphemeSafe(incoming.slice(overlap));
      expectGraphemeSafe(merged);
      expect(startsOnGraphemeBoundary(incoming, incoming.slice(overlap))).toBe(true);
    });
  }
});
