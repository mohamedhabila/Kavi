import { fetchJson } from '../shared/http';

export async function fetchCryptoPrice(args: Record<string, unknown>): Promise<string> {
  const coinId = String(args.coinId || '').trim().toLowerCase();
  if (!coinId) {
    throw new Error('Crypto price requires a CoinGecko coinId such as bitcoin or ethereum');
  }

  const vsCurrency = String(args.vsCurrency || 'USD')
    .trim()
    .toLowerCase();
  const query = new URLSearchParams({
    ids: coinId,
    vs_currencies: vsCurrency,
    include_24hr_change: 'true',
    include_24hr_vol: 'true',
    include_market_cap: 'true',
    include_last_updated_at: 'true',
  });
  const data = await fetchJson<Record<string, Record<string, number | null>>>({
    url: `https://api.coingecko.com/api/v3/simple/price?${query.toString()}`,
    errorPrefix: 'CoinGecko API',
  });
  const price = data[coinId];
  if (!price) {
    throw new Error(`CoinGecko coin "${coinId}" was not found`);
  }

  return JSON.stringify({
    coinId,
    vsCurrency: vsCurrency.toUpperCase(),
    price: price[vsCurrency] ?? null,
    marketCap: price[`${vsCurrency}_market_cap`] ?? null,
    volume24h: price[`${vsCurrency}_24h_vol`] ?? null,
    change24h: price[`${vsCurrency}_24h_change`] ?? null,
    lastUpdatedAt: price.last_updated_at ?? null,
  });
}
