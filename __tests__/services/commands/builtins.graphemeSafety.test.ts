const mockListMemoryItems = jest.fn();
const mockSearchMemoryItems = jest.fn();
jest.mock('../../../src/services/memory/core/memoryItemsStore', () => ({
  listMemoryItems: (...args: unknown[]) => mockListMemoryItems(...args),
  searchMemoryItems: (...args: unknown[]) => mockSearchMemoryItems(...args),
}));

import { getCommand } from '../../../src/services/commands/builtins';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('/memory command — query and item text grapheme safety', () => {
  beforeEach(() => {
    mockListMemoryItems.mockReset();
    mockSearchMemoryItems.mockReset();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 200-char query budget`, async () => {
      const query = buildBoundaryStraddlingText(200, cluster, 50);
      mockListMemoryItems.mockReturnValue([{ id: 'item-1', text: 'Something remembered' }]);
      mockSearchMemoryItems.mockReturnValue([]);

      const result = await getCommand('memory')!.handler({
        conversationId: null,
        args: query,
      });

      expect(result.response).toContain('Nothing remembered matches');
      expect(mockSearchMemoryItems).toHaveBeenCalledTimes(1);
      const passedQuery = (mockSearchMemoryItems.mock.calls[0][0] as { query: string }).query;
      expectGraphemeSafe(passedQuery);
      expect(endsOnGraphemeBoundary(query, passedQuery)).toBe(true);
    });

    it(`never splits ${name} straddling the 300-char item text budget`, async () => {
      const value = buildBoundaryStraddlingText(300, cluster, 50);
      mockListMemoryItems.mockReturnValue([{ id: 'item-1', text: value }]);
      mockSearchMemoryItems.mockReturnValue([{ id: 'item-1', text: value }]);

      const result = await getCommand('memory')!.handler({
        conversationId: null,
        args: 'query',
      });

      const response = String(result.response ?? '');
      expectGraphemeSafe(response);
      // response ends with `- ${truncateGraphemesTo(value, 300)}`.
      const marker = '\n- ';
      const cutText = response.slice(response.lastIndexOf(marker) + marker.length);
      expect(endsOnGraphemeBoundary(value, cutText)).toBe(true);
    });
  }
});
