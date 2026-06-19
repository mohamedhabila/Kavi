// ---------------------------------------------------------------------------
// Kavi — Acceptance metric evaluation types
// ---------------------------------------------------------------------------

export type AcceptanceFixtureOutcome = {
  fixtureId: string;
  passed: boolean;
  detail?: string;
};

export type AcceptanceMetricSummary = {
  metricId: string;
  label: string;
  passed: number;
  total: number;
  passRate: number;
  targetRate: number;
  comparator: 'min' | 'max';
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>;
};

export type AcceptanceMetricEvaluation = {
  passed: boolean;
  summaries: AcceptanceMetricSummary[];
};