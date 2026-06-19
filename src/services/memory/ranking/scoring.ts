export interface HybridScoreInput {
  vectorScore: number;
  textScore: number;
  temporalScore: number;
  vectorWeight: number;
  textWeight: number;
  temporalWeight: number;
}

export function temporalDecay(
  entryTimestamp: number,
  nowMs: number = Date.now(),
  halfLifeDays: number = 14,
): number {
  const daysSince = (nowMs - entryTimestamp) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysSince / halfLifeDays);
}

export function combineHybridScore(input: HybridScoreInput): number {
  return (
    input.vectorWeight * input.vectorScore +
    input.textWeight * input.textScore +
    input.temporalWeight * input.temporalScore
  );
}

export function exponentialDecayMultiplier(params: {
  ageInDays: number;
  halfLifeDays: number;
}): number {
  if (!Number.isFinite(params.halfLifeDays) || params.halfLifeDays <= 0) return 1;
  const clampedAge = Math.max(0, params.ageInDays);
  if (!Number.isFinite(clampedAge)) return 1;
  return Math.exp(-(Math.LN2 / params.halfLifeDays) * clampedAge);
}
