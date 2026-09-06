import { buildSessionStatusPayload } from '../../../src/engine/tools/builtin-session-statusSupport';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('buildSessionStatusPayload — outputPreview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 1000-char output preview budget`, () => {
      const output = buildBoundaryStraddlingText(1000, cluster, 200);
      const payload = buildSessionStatusPayload(
        {
          status: 'running',
          startedAt: Date.now() - 5000,
          output,
        },
        'session-1',
      );

      const fingerprint = JSON.parse(payload.fingerprint) as { outputPreview: string };
      expectGraphemeSafe(fingerprint.outputPreview);
    });
  }
});
