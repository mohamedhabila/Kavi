import type { E2EEstimatedCostSummary } from './types';

export type E2EPairedEstimatedCostSummary =
  | Readonly<{
      status: 'available';
      referenceUsd: number;
      candidateUsd: number;
      pairUsd: number;
      deltaUsd: number;
    }>
  | Readonly<{
      status: 'unavailable';
      referenceUsd: null;
      candidateUsd: null;
      pairUsd: null;
      deltaUsd: null;
    }>;

export function validateE2EEstimatedCostSummary(
  value: E2EEstimatedCostSummary,
  label: string,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an estimated-cost summary.`);
  }
  if (Object.keys(value).sort().join(',') !== 'status,usd') {
    throw new Error(`${label} has an unsupported schema.`);
  }
  if (value.status === 'available') {
    if (!Number.isFinite(value.usd) || value.usd < 0) {
      throw new Error(`${label}.usd must be a non-negative finite number.`);
    }
    return;
  }
  if (value.status !== 'unavailable' || value.usd !== null) {
    throw new Error(`${label} has an inconsistent availability state.`);
  }
}

export function buildE2EPairedEstimatedCost(input: {
  reference?: E2EEstimatedCostSummary;
  candidate?: E2EEstimatedCostSummary;
}): E2EPairedEstimatedCostSummary {
  if (input.reference?.status !== 'available' || input.candidate?.status !== 'available') {
    return {
      status: 'unavailable',
      referenceUsd: null,
      candidateUsd: null,
      pairUsd: null,
      deltaUsd: null,
    };
  }
  const referenceUsd = input.reference.usd;
  const candidateUsd = input.candidate.usd;
  const pairUsd = referenceUsd + candidateUsd;
  const deltaUsd = candidateUsd - referenceUsd;
  if (!Number.isFinite(pairUsd) || !Number.isFinite(deltaUsd)) {
    throw new Error('Paired estimated cost exceeds the finite number range.');
  }
  return { status: 'available', referenceUsd, candidateUsd, pairUsd, deltaUsd };
}
