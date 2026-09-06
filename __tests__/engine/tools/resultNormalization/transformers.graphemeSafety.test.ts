import { truncateText } from '../../../../src/engine/tools/resultNormalization/transformers';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../helpers/graphemeTestFixtures';

describe('resultNormalization/transformers truncateText — grapheme safety', () => {
  it('returns text unchanged when within budget', () => {
    expect(truncateText('short', 100)).toBe('short');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the truncation budget`, () => {
      const boundary = 100;
      const text = buildBoundaryStraddlingText(boundary, cluster, 100);
      const result = truncateText(text, boundary);

      expect(result).toContain('chars omitted');
      expectGraphemeSafe(result);
    });
  }

  // Regression test — this function reimplemented the same "cut and mark
  // with an ellipsis" shape as `truncateGraphemesWithSuffix` by hand, and
  // inherited the same bug: it reserved room for the suffix but then cut
  // with `truncateGraphemesTo`'s default sentence/whitespace boundary
  // search, which could drop far more than intended whenever a sentence
  // terminator fell inside the search window before the hard limit (see
  // `src/engine/tools/builtin-expoCompaction.ts`'s equivalent regression).
  it('cuts exactly at the reserved budget even when a sentence boundary falls inside the search window', () => {
    const text =
      'Push a commit to main or another branch matched by the workflow on.push trigger. ' +
      'Monitor the automatically triggered run with expo_eas_workflow_runs, expo_eas_workflow_status, expo_eas_workflow_wait.';
    const result = truncateText(text, 145);

    expect(result).toContain('Monitor the automatically triggered run');
  });
});
