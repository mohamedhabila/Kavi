const mockSearchMemoryFacts = jest.fn();
jest.mock('../../../src/services/memory/facts/managementSearch', () => ({
  searchMemoryFactsForManagement: (...args: unknown[]) => mockSearchMemoryFacts(...args),
}));

jest.mock('../../../src/services/memory/memoryFactSerialization', () => ({
  serializeMemoryFact: (fact: unknown) => fact,
}));

import { getCommand } from '../../../src/services/commands/builtins';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('/memory command — query and fact-value grapheme safety', () => {
  beforeEach(() => {
    mockSearchMemoryFacts.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 200-char query budget`, async () => {
      const query = buildBoundaryStraddlingText(200, cluster, 50);
      mockSearchMemoryFacts.mockReturnValue({
        totalCurrentFacts: 0,
        totalMatches: 0,
        facts: [],
      });

      const result = await getCommand('memory')!.handler({
        conversationId: null,
        args: query,
      });

      expect(result.response).toContain('Memory is empty');
      expect(mockSearchMemoryFacts).toHaveBeenCalledTimes(1);
      const passedQuery = mockSearchMemoryFacts.mock.calls[0][0] as string;
      expectGraphemeSafe(passedQuery);
      expect(endsOnGraphemeBoundary(query, passedQuery)).toBe(true);
    });

    it(`never splits ${name} straddling the 300-char fact-value budget`, async () => {
      const value = buildBoundaryStraddlingText(300, cluster, 50);
      mockSearchMemoryFacts.mockReturnValue({
        totalCurrentFacts: 1,
        totalMatches: 1,
        facts: [{ subject: 'user', predicate: 'likes', value }],
      });

      const result = await getCommand('memory')!.handler({
        conversationId: null,
        args: 'query',
      });

      const response = String(result.response ?? '');
      expectGraphemeSafe(response);
      // response ends with `- **user · likes**: ${truncateGraphemesTo(value, 300)}`.
      const marker = '- **user · likes**: ';
      const cutText = response.slice(response.lastIndexOf(marker) + marker.length);
      expect(endsOnGraphemeBoundary(value, cutText)).toBe(true);
    });
  }
});
