import { buildCompactionOpenThreads } from '../../../src/engine/graph/compactionContext';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('buildCompactionOpenThreads — plan step grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 160-char thread-text budget`, () => {
      const title = buildBoundaryStraddlingText(160, cluster, 100);

      const threads = buildCompactionOpenThreads({
        plan: [{ step: title, status: 'in_progress' }],
      });
      expect(threads.length).toBe(1);
      expectGraphemeSafe(threads[0]);
      // threads[0] is `[in_progress] ${truncateGraphemesWithSuffix(title, 160, '…')}`.
      const prefix = '[in_progress] ';
      const cutText = threads[0].slice(prefix.length, -'…'.length);
      expect(endsOnGraphemeBoundary(title, cutText)).toBe(true);
    });
  }
});

describe('buildCompactionOpenThreads — what a summary carries forward', () => {
  it('keeps the unfinished plan steps and drops the finished ones', () => {
    expect(
      buildCompactionOpenThreads({
        plan: [
          { step: 'Find flights', status: 'completed' },
          { step: 'Book the hotel', status: 'in_progress' },
          { step: 'Send the itinerary', status: 'pending' },
        ],
      }),
    ).toEqual(['[in_progress] Book the hotel', '[pending] Send the itinerary']);
  });

  it('carries nothing for a run without a plan or pending work', () => {
    expect(buildCompactionOpenThreads({})).toEqual([]);
  });
});
