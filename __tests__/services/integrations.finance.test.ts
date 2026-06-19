import {
  installServiceIntegrationsReset,
  createFinanceSkill,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createFinanceSkill', () => {
    it('should create finance skill with 3 tools', () => {
      const skill = createFinanceSkill();
      expect(skill.id).toBe('finance');
      expect(skill.tools).toHaveLength(3);
      expect(skill.tools.map((t) => t.name)).toEqual([
        'stock_quote',
        'crypto_price',
        'exchange_rate',
      ]);
    });

    it('stock_quote should return data', async () => {
      mockGetSecure.mockResolvedValue('av-key');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          'Global Quote': {
            '01. symbol': 'AAPL',
            '05. price': '150.00',
            '09. change': '2.00',
            '10. change percent': '1.35%',
            '06. volume': '50000000',
          },
        }),
      });

      const skill = createFinanceSkill();
      const result = await skill.tools[0].handler!({ symbol: 'AAPL' });
      const data = JSON.parse(result);
      expect(data).toBeDefined();
    });

    it('stock_quote should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createFinanceSkill();
      await expect(skill.tools[0].handler!({ symbol: 'AAPL' })).rejects.toThrow('not configured');
    });

    it('crypto_price should return data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 50000 } }),
      });

      const skill = createFinanceSkill();
      const result = await skill.tools[1].handler!({ coinId: 'bitcoin' });
      const data = JSON.parse(result);
      expect(data).toBeDefined();
      expect(data.coinId).toBe('bitcoin');
    });

    it('crypto_price should handle API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });
      const skill = createFinanceSkill();
      await expect(skill.tools[1].handler!({ coinId: 'bitcoin' })).rejects.toThrow();
    });

    it('exchange_rate should return data', async () => {
      mockGetSecure.mockResolvedValue('av-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'Realtime Currency Exchange Rate': {
            '1. From_Currency Code': 'USD',
            '3. To_Currency Code': 'JPY',
            '5. Exchange Rate': '157.42000000',
            '6. Last Refreshed': '2026-06-03 10:15:00',
            '7. Time Zone': 'UTC',
          },
        }),
      });

      const skill = createFinanceSkill();
      const result = await skill.tools[2].handler!({
        fromCurrency: 'USD',
        toCurrency: 'JPY',
      });
      const data = JSON.parse(result);
      expect(data.fromCurrency).toBe('USD');
      expect(data.toCurrency).toBe('JPY');
      expect(data.exchangeRate).toBe('157.42000000');
    });
  });
});
