// ---------------------------------------------------------------------------
// Kavi — Acceptance metric thresholds (from mobile-agent-implementation-plan)
// ---------------------------------------------------------------------------

export const MEMORY_RECALL_MIN_PASS_RATE = 0.9;

export const MEMORY_CHITCHAT_INGESTION_MIN_PASS_RATE = 1;

export const GOAL_TASK_UNIFICATION_MIN_PASS_RATE = 1;

export const AGENT_BOOTSTRAP_MIN_PASS_RATE = 0.99;

export const FALSE_FINALIZE_MAX_RATE = 0.05;

export const TOOL_SURFACE_BUDGET_MIN_PASS_RATE = 1;

export const COMPACTION_RECALL_MIN_PASS_RATE = 1;

/** Median tool-definition tokens reduced vs legacy two-sentence compression. */
export const TOOL_DEFINITION_TOKEN_REDUCTION_MIN_RATE = 0.2;

export const GOAL_CAPABILITY_DISCOVERY_MIN_PASS_RATE = 1;

export const TOOL_CATALOG_DISCOVERY_MIN_PASS_RATE = 1;

export const SESSION_TOOL_ACTIVATION_MIN_PASS_RATE = 1;

export const DELEGATION_SUCCESS_MIN_PASS_RATE = 1;
