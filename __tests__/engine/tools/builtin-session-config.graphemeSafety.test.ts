import { sanitizeWorkerName } from '../../../src/engine/tools/builtin-session-config';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('sanitizeWorkerName — grapheme safety', () => {
  it('returns short names unchanged', () => {
    expect(sanitizeWorkerName('worker-1')).toBe('worker-1');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 256-char budget`, () => {
      const value = buildBoundaryStraddlingText(256, cluster, 50);
      const result = sanitizeWorkerName(value);
      expectGraphemeSafe(String(result ?? ''));
    });
  }
});
