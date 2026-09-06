import { buildCompactionOpenThreads } from '../../../src/engine/graph/compactionContext';
import type { AgentGoal } from '../../../src/types/agentRun';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('buildCompactionOpenThreads — goal title/criteria grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 160-char thread-text budget`, () => {
      const title = buildBoundaryStraddlingText(160, cluster, 100);
      const goal: AgentGoal = {
        id: 'goal-1',
        title,
        status: 'active',
        successCriteria: [],
      } as unknown as AgentGoal;

      const threads = buildCompactionOpenThreads({ goals: [goal] });
      expect(threads.length).toBe(1);
      expectGraphemeSafe(threads[0]);
    });
  }
});
