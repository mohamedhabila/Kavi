import { normalizeRemoteReadResult } from '../../../../src/engine/tools/resultNormalization/remoteResult';
import { expectGraphemeSafe, GRAPHEME_CLUSTER_FIXTURES } from '../../../helpers/graphemeTestFixtures';

describe('normalizeRemoteReadResult — content excerpt grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} at the head/tail excerpt seams (12,000-char budget)`, () => {
      const content = `${'H'.repeat(3000)}${'M'.repeat(15000)}${cluster}${'T'.repeat(3000)}`;
      const result = normalizeRemoteReadResult({
        kind: 'workspace',
        path: '/tmp/file.txt',
        content,
      });

      const parsed = JSON.parse(result);
      expectGraphemeSafe(String(parsed.contentExcerpt ?? ''));
    });
  }
});
