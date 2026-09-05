import type { Skill } from '../../skills/types';
import { secretRuntimeRequirement } from '../../../types/tool';
import { createApiTool } from '../shared/toolFactory';
import { fetchCryptoPrice } from './coinGecko';
import { fetchExchangeRate, fetchLatestStockQuote } from './alphaVantage';

// stock_quote and exchange_rate call Alpha Vantage directly and fail without an API
// key. crypto_price calls the keyless CoinGecko API and stays unconditional.
const ALPHA_VANTAGE_CONTRACT = {
  runtimeRequirements: [secretRuntimeRequirement('ALPHA_VANTAGE_API_KEY')],
};

export function createFinanceSkill(): Skill {
  return {
    id: 'finance',
    name: 'Finance',
    description: 'Latest stock quotes, crypto prices, and FX exchange rates',
    version: '2.0.0',
    tools: [
      createApiTool(
        'stock_quote',
        'Get the latest Alpha Vantage quote for a ticker. Free-tier results are end-of-day by default.',
        {
          symbol: { type: 'string', description: 'Stock ticker (for example AAPL or MSFT).' },
          entitlement: {
            type: 'string',
            enum: ['realtime', 'delayed'],
            description:
              'Optional premium freshness mode for US market data when your Alpha Vantage plan supports it.',
          },
        },
        ['symbol'],
        fetchLatestStockQuote,
        { contract: ALPHA_VANTAGE_CONTRACT },
      ),
      createApiTool(
        'crypto_price',
        'Get a cryptocurrency price from CoinGecko using the canonical coinId.',
        {
          coinId: {
            type: 'string',
            description: 'CoinGecko coin identifier such as bitcoin, ethereum, or solana.',
          },
          vsCurrency: {
            type: 'string',
            description: 'Quote currency code such as USD, EUR, or GBP. Defaults to USD.',
          },
        },
        ['coinId'],
        fetchCryptoPrice,
      ),
      createApiTool(
        'exchange_rate',
        'Get a realtime FX exchange rate from Alpha Vantage.',
        {
          fromCurrency: {
            type: 'string',
            description: 'Source currency code such as USD, EUR, or BTC.',
          },
          toCurrency: {
            type: 'string',
            description: 'Destination currency code such as JPY, GBP, or ETH.',
          },
        },
        ['fromCurrency', 'toCurrency'],
        fetchExchangeRate,
        { contract: ALPHA_VANTAGE_CONTRACT },
      ),
    ],
  };
}
