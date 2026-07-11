export function exponentialDecayMultiplier(params: {
  ageInDays: number;
  halfLifeDays: number;
}): number {
  if (!Number.isFinite(params.halfLifeDays) || params.halfLifeDays <= 0) return 1;
  const clampedAge = Math.max(0, params.ageInDays);
  if (!Number.isFinite(clampedAge)) return 1;
  return Math.exp(-(Math.LN2 / params.halfLifeDays) * clampedAge);
}
