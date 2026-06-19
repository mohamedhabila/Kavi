// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeMemorySearch
// ---------------------------------------------------------------------------

import { executeMemorySearch } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeMemorySearch', () => {
    it('searches memory for a query', async () => {
      const result = await executeMemorySearch({ query: 'test search' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.method).toBe('text');
    });

    it('handles missing query gracefully', async () => {
      const result = await executeMemorySearch({ query: '' });
      expect(typeof result).toBe('string');
    });

    it('uses hybrid search when embedding config provided', async () => {
      const { sqliteHybridSearch } = require('../../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockResolvedValueOnce([
        { source: 'MEMORY.md', snippet: 'result', score: 0.9 },
      ]);
      const result = await executeMemorySearch(
        { query: 'search test', maxResults: 5 },
        { provider: 'openai', apiKey: 'k' },
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('hybrid');
    });

    it('returns a degraded sqlite result on hybrid error', async () => {
      const { sqliteHybridSearch } = require('../../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockRejectedValueOnce(new Error('embed fail'));
      const result = await executeMemorySearch(
        { query: 'fallback', maxResults: 5 },
        { provider: 'openai', apiKey: 'k' },
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('hybrid');
      expect(parsed.index).toBe('sqlite');
      expect(parsed.degraded).toBe(true);
    });
  });
});
