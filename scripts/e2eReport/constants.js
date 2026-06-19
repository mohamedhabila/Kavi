const ASSESSMENT_MIN_DIMENSION_PASS_RATE = 0.85;
const READINESS_MIN_PASS_RATE = 0.95;
const READINESS_MIN_AXIS_PASS_RATE = 0.95;
const READINESS_MIN_FAST_SUITE_SCENARIO_COUNT = 39;
const PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS = 4096;
const PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE = 0.25;
const SCENARIO_MANIFEST_VERSION = '2026-06-12.phase0';
const NATIVE_TOOL_FIXTURE_VERSION = 'native-tools-2026-06-12';
const READINESS_DASHBOARD_VERSION = '2026-06-12.phase8';
const BENCHMARK_MANIFEST_VERSION = '2026-06-12.phase7';
const BENCHMARK_SOURCE_REFRESH_DATE = '2026-06-12';
const READINESS_ARTIFACT_RETENTION_RUNS = 90;
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://aiplatform.googleapis.com/v1';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const CRITICAL_READINESS_DIMENSIONS = new Set([
  'tool_discovery',
  'memory',
  'control_graph',
  'mobile_native',
  'privacy_safety',
]);
const EMPTY_TOKEN_BUCKETS = {
  systemPromptTokens: 0,
  toolDeclarationTokens: 0,
  memoryContextTokens: 0,
  conversationHistoryTokens: 0,
  userTurnTokens: 0,
  toolResultTokens: 0,
};
const RUBRIC_KINDS = new Set([
  'workspace_file',
  'goals_bootstrapped',
  'goal_evidence_satisfied',
  'graph_status',
  'graph_terminal_success',
  'completion_gate_hold',
  'memory_fact',
  'token_budget',
  'cache_read_tokens',
  'min_user_turns',
  'goal_status',
  'ingestion_job_completed',
  'memory_episode_count',
  'json_field',
  'file_hash',
  'goal_criterion',
  'working_block_token',
  'graph_audit_observed',
]);
const FAILURE_CATEGORIES = [
  'discovery_miss',
  'wrong_tool',
  'wrong_args',
  'missing_clarification',
  'permission_failure',
  'goal_state_bug',
  'memory_retrieval_miss',
  'tool_poisoning_vulnerability',
  'cache_prefix_drift',
  'token_budget_overrun',
  'loop_control',
  'native_side_effect_failure',
  'external_runner_required',
  'grader_quality',
  'unknown_structural_failure',
];
const EXTERNAL_BENCHMARK_REQUIREMENTS = [
  { id: 'androidworld-device-runner', source: 'AndroidWorld' },
  { id: 'mobileagentbench-gui-runner', source: 'MobileAgentBench' },
  { id: 'ambibench-user-simulator', source: 'AmbiBench' },
  { id: 'simuwob-mobile-web', source: 'SimuWoB' },
  { id: 'bfcl-v4-live-values', source: 'Berkeley Function Calling Leaderboard V4' },
  { id: 'longmemeval-v2-long-history', source: 'LongMemEval-V2' },
  { id: 'agentdojo-prompt-injection', source: 'AgentDojo' },
  { id: 'mcptox-tool-poisoning', source: 'MCPTox / OWASP MCP Tool Poisoning' },
];
const IMPLEMENTED_BENCHMARK_REQUIREMENT_COUNT = 10;

module.exports = {
  ASSESSMENT_MIN_DIMENSION_PASS_RATE,
  READINESS_MIN_PASS_RATE,
  READINESS_MIN_AXIS_PASS_RATE,
  READINESS_MIN_FAST_SUITE_SCENARIO_COUNT,
  PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  PROMPT_CACHE_MIN_ELIGIBLE_READ_RATE,
  SCENARIO_MANIFEST_VERSION,
  NATIVE_TOOL_FIXTURE_VERSION,
  READINESS_DASHBOARD_VERSION,
  BENCHMARK_MANIFEST_VERSION,
  BENCHMARK_SOURCE_REFRESH_DATE,
  READINESS_ARTIFACT_RETENTION_RUNS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
  CRITICAL_READINESS_DIMENSIONS,
  EMPTY_TOKEN_BUCKETS,
  RUBRIC_KINDS,
  FAILURE_CATEGORIES,
  EXTERNAL_BENCHMARK_REQUIREMENTS,
  IMPLEMENTED_BENCHMARK_REQUIREMENT_COUNT,
};
