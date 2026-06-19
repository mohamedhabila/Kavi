// ---------------------------------------------------------------------------
// Kavi — E2E agent eval thresholds
// ---------------------------------------------------------------------------

export const E2E_SCENARIO_MIN_PASS_RATE = 0.9;

export const E2E_READINESS_MIN_PASS_RATE = 0.95;

export const E2E_READINESS_MIN_AXIS_PASS_RATE = 0.95;

export const E2E_READINESS_MIN_FAST_SUITE_SCENARIO_COUNT = 39;

export const E2E_DEFAULT_MAX_TOKENS = 32_000;

export const E2E_DEFAULT_SCENARIO_TIMEOUT_MS = 180_000;

export const E2E_PER_USER_TURN_TIMEOUT_MS = 90_000;

export const E2E_MAX_SCENARIO_TIMEOUT_MS = 600_000;

export const E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS = 4_096;

export const E2E_PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE = 0.25;

export const E2E_SCENARIO_MANIFEST_VERSION = '2026-06-14.long-run-confidence';

export const E2E_NATIVE_TOOL_FIXTURE_VERSION = 'native-tools-2026-06-12';

/** Per-scenario total token ceilings (input + output), set from baseline runs with headroom. */
export const E2E_SCENARIO_TOKEN_BUDGETS: Readonly<Record<string, number>> = {
  'file-write-read': 120_000,
  'goal-evidence-complete': 150_000,
  'false-finalize-recovery': 150_000,
  'tool-catalog-agents': 100_000,
  'delegation-worker-finalize': 200_000,
  'delegation-worker-evidence-chain': 200_000,
  'memory-remember-recall': 100_000,
  'personal-shopping-list': 100_000,
  'workspace-inventory-manifest': 150_000,
  'multi-turn-memory-preference': 220_000,
  'multi-turn-trip-artifact': 200_000,
  'multi-turn-inventory-readback': 180_000,
  'multi-turn-catalog-memory': 150_000,
  'tool-catalog-query-memory': 150_000,
  'multi-turn-gate-followup': 200_000,
  'multi-turn-passive-chitchat-memory': 180_000,
  'multi-turn-goal-passive-recall': 220_000,
  'native-calendar-json-field': 120_000,
  'bench-gaia-file-hop-chain': 180_000,
  'bench-session-tool-cache': 200_000,
  'bench-prompt-cache-long-horizon': 500_000,
  'bench-prompt-cache-convergence-long-run': 900_000,
  'bench-tool-describe-then-use': 180_000,
  'bench-memory-state-3turn-recall': 240_000,
  'bench-goal-json-field-criterion': 150_000,
  'bench-scoped-recall-goal-switch': 240_000,
  'bench-bootstrap-first-turn-goals': 200_000,
  'bench-tau-native-json-outcome': 140_000,
  'bench-agentbench-tool-chain': 180_000,
  'bench-bfcl-parallel-file-read': 160_000,
  'bench-bfcl-sequential-memory-chain': 120_000,
  'bench-longmem-delayed-recall': 240_000,
  'bench-bfcl-multi-turn-state-carry': 220_000,
  'bench-bfcl-passive-no-tools': 200_000,
  'bench-longmem-dual-fact-recall': 260_000,
  'bench-longmem-knowledge-update-recall': 260_000,
  'bench-longmem-abstention-empty-recall': 220_000,
  'bench-tau-calendar-events-chain': 150_000,
  'bench-androidworld-calendar-mutation': 180_000,
  'bench-androidworld-permission-denial': 160_000,
  'bench-mobileagent-contact-message-draft': 180_000,
  'bench-mobileworld-discover-contact-message': 220_000,
  'bench-knowu-personalized-contact-memory': 260_000,
  'bench-androidworld-clipboard-share-notify': 200_000,
  'bench-mobileagent-media-state': 180_000,
  'direct-agentdojo-untrusted-workspace-note': 180_000,
  'direct-bfcl-v4-parallel-relevance': 200_000,
  'direct-toolsandbox-state-dependency': 180_000,
  'direct-tau-user-coordination-state': 240_000,
  'direct-androidworld-calendar-add-update': 220_000,
  'direct-mobileworld-cross-app-contact-message': 260_000,
  'direct-spabench-cross-app-device-actions': 220_000,
  'direct-longmemeval-v2-mobile-preference-update': 300_000,
  'direct-locomo-temporal-conversation-memory': 420_000,
  'direct-beam-long-dialogue-multi-probe': 520_000,
  'direct-longmemeval-v2-experience-runbook': 360_000,
  'direct-mobileworld-long-horizon-personalization': 420_000,
};

/** Program-level regression guard across all scenarios in one harness run. */
export const E2E_PROGRAM_MAX_TOTAL_TOKENS = 4_000_000;

/** Delegation scenario runs in a separate opt-in test file. */
export const E2E_DELEGATION_PROGRAM_MAX_TOTAL_TOKENS = 200_000;
