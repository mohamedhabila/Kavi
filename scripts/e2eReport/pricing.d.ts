export interface E2EPricingSnapshot {
  currency: 'USD';
  unitTokens: 1_000_000;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  snapshotDate: string;
  sourceSha256: string;
}

export type E2EPricingResolution =
  | { status: 'missing'; snapshot: null }
  | { status: 'configured'; snapshot: E2EPricingSnapshot };

export const PRICING_ENV: Readonly<{
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  snapshotDate: string;
  sourceSha256: string;
}>;

export function resolveE2EPricing(
  env?: Readonly<Record<string, string | undefined>>,
): E2EPricingResolution;

export function estimateE2ETokenCostUsd(
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  pricing: E2EPricingResolution,
): number | null;
