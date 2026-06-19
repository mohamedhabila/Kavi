import { fetchJson } from '../shared/http';
import { requireSecret } from '../shared/secrets';

type AlphaVantageResponse = {
  Note?: string;
  Information?: string;
  'Error Message'?: string;
  [key: string]: any;
};

function unwrapAlphaVantageResponse<T extends AlphaVantageResponse>(data: T): T {
  const note = String(data.Note || '').trim();
  const information = String(data.Information || '').trim();
  const errorMessage = String(data['Error Message'] || '').trim();

  if (errorMessage) {
    throw new Error(`Alpha Vantage error: ${errorMessage}`);
  }
  if (note) {
    throw new Error(`Alpha Vantage rate limit: ${note}`);
  }
  if (information) {
    throw new Error(`Alpha Vantage info: ${information}`);
  }

  return data;
}

function buildAlphaVantageUrl(params: Record<string, string>): Promise<string> {
  return requireSecret('ALPHA_VANTAGE_API_KEY').then((apiKey) => {
    const query = new URLSearchParams({
      ...params,
      apikey: apiKey,
    });
    return `https://www.alphavantage.co/query?${query.toString()}`;
  });
}

export async function fetchLatestStockQuote(args: Record<string, unknown>): Promise<string> {
  const symbol = String(args.symbol || '').trim();
  if (!symbol) {
    throw new Error('Stock quote requires a symbol');
  }

  const entitlement = String(args.entitlement || '').trim().toLowerCase();
  const url = await buildAlphaVantageUrl({
    function: 'GLOBAL_QUOTE',
    symbol,
    ...(entitlement === 'realtime' || entitlement === 'delayed' ? { entitlement } : {}),
  });
  const data = unwrapAlphaVantageResponse(await fetchJson<AlphaVantageResponse>({ url }));
  const quote = data['Global Quote'] || {};

  return JSON.stringify({
    symbol: quote['01. symbol'],
    price: quote['05. price'],
    open: quote['02. open'],
    high: quote['03. high'],
    low: quote['04. low'],
    previousClose: quote['08. previous close'],
    change: quote['09. change'],
    changePercent: quote['10. change percent'],
    volume: quote['06. volume'],
    latestTradingDay: quote['07. latest trading day'],
    entitlement: entitlement || 'default',
  });
}

export async function fetchExchangeRate(args: Record<string, unknown>): Promise<string> {
  const fromCurrency = String(args.fromCurrency || '').trim().toUpperCase();
  const toCurrency = String(args.toCurrency || '').trim().toUpperCase();
  if (!fromCurrency || !toCurrency) {
    throw new Error('Exchange rate requires both fromCurrency and toCurrency');
  }

  const url = await buildAlphaVantageUrl({
    function: 'CURRENCY_EXCHANGE_RATE',
    from_currency: fromCurrency,
    to_currency: toCurrency,
  });
  const data = unwrapAlphaVantageResponse(await fetchJson<AlphaVantageResponse>({ url }));
  const rate = data['Realtime Currency Exchange Rate'] || {};

  return JSON.stringify({
    fromCurrency: rate['1. From_Currency Code'] || fromCurrency,
    fromCurrencyName: rate['2. From_Currency Name'] || null,
    toCurrency: rate['3. To_Currency Code'] || toCurrency,
    toCurrencyName: rate['4. To_Currency Name'] || null,
    exchangeRate: rate['5. Exchange Rate'] || null,
    lastRefreshed: rate['6. Last Refreshed'] || null,
    timezone: rate['7. Time Zone'] || null,
    bidPrice: rate['8. Bid Price'] || null,
    askPrice: rate['9. Ask Price'] || null,
  });
}
