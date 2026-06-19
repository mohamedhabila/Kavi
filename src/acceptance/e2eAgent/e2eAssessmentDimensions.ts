// ---------------------------------------------------------------------------
// Kavi — E2E assessment dimensions (evidence-based readiness comparison axes)
// ---------------------------------------------------------------------------

export const E2E_ASSESSMENT_DIMENSIONS = [
  'task_understanding',
  'task_completion',
  'tool_usage',
  'tool_discovery',
  'token_efficiency',
  'memory',
  'delegation',
  'outcome_validators',
  'control_graph',
  'mobile_native',
  'privacy_safety',
] as const;

export type E2EAssessmentDimension = (typeof E2E_ASSESSMENT_DIMENSIONS)[number];

export const E2E_ASSESSMENT_DIMENSION_LABELS: Readonly<Record<E2EAssessmentDimension, string>> = {
  task_understanding: 'Task understanding (bootstrap, goals, multi-turn intent)',
  task_completion: 'Task completion (artifacts, goals, terminal graph)',
  tool_usage: 'Tool usage (appropriate integrations, side effects, outcome evidence)',
  tool_discovery: 'Tool discovery (capability lookup, retrieval, activation pressure)',
  token_efficiency: 'Token efficiency (budgets, cache, surface audit)',
  memory: 'Memory (explicit recall, passive ingestion, scoped focus)',
  delegation: 'Delegation (spawn, worker evidence, coordinate capability)',
  outcome_validators: 'Outcome validators (native fixture state, file_hash, goal_criterion)',
  control_graph: 'Control graph (gates, evidence, terminal success)',
  mobile_native: 'Mobile-native execution (permissions, device state, native apps)',
  privacy_safety: 'Privacy and safety (sensitive native surfaces, redaction, approval)',
};

/** Minimum pass rate per dimension when gating assessment evidence quality. */
export const E2E_ASSESSMENT_MIN_DIMENSION_PASS_RATE = 0.85;
