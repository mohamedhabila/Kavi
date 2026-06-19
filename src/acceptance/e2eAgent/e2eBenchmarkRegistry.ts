// ---------------------------------------------------------------------------
// Kavi — E2E benchmark registry (external lineage + assessment dimensions)
// ---------------------------------------------------------------------------
// Adapted from public agent benchmarks for mobile assistant scope — not full SWE-bench
// or OSWorld runs. Each family maps to structural rubrics we can assert offline.
// ---------------------------------------------------------------------------

import type { E2EAssessmentDimension } from './e2eAssessmentDimensions';

export const E2E_BENCHMARK_FAMILIES = [
  'kavi-core',
  'gaia-adapted',
  'tau-bench-adapted',
  'agentbench-adapted',
  'memory-agent-bench-adapted',
  'state-bench-adapted',
  'tool-discovery-adapted',
  'bfcl-adapted',
  'longmem-adapted',
  'androidworld-adapted',
  'mobile-agent-bench-adapted',
  'mobileworld-adapted',
  'knowu-bench-adapted',
  'androidworld-direct',
  'mobileworld-direct',
  'spa-bench-direct',
  'bfcl-v4-direct',
  'longmemeval-v2-direct',
  'tau-bench-direct',
  'toolsandbox-direct',
  'agentdojo-direct',
  'locomo-direct',
  'beam-direct',
  'provider-prompt-cache-direct',
] as const;

export type E2EBenchmarkFamily = (typeof E2E_BENCHMARK_FAMILIES)[number];

export type E2EBenchmarkFamilyMeta = {
  label: string;
  externalReference: string;
  adaptationNotes: string;
};

export const E2E_BENCHMARK_FAMILY_META: Readonly<
  Record<E2EBenchmarkFamily, E2EBenchmarkFamilyMeta>
> = {
  'kavi-core': {
    label: 'Kavi core scenarios',
    externalReference: 'Kavi core mobile-assistant scenario suite',
    adaptationNotes: 'Core personal-assistant flows shipped with the product.',
  },
  'gaia-adapted': {
    label: 'GAIA-adapted',
    externalReference: 'GAIA (Mialon et al., 2023) — multi-hop tool + file reasoning',
    adaptationNotes:
      'Workspace file hops and derived artifacts; no web browsing or arbitrary attachments.',
  },
  'tau-bench-adapted': {
    label: 'τ-bench-adapted',
    externalReference: 'τ-bench (Yao et al., 2024) — structured tool JSON outcomes',
    adaptationNotes: 'Native calendar mocks with final fixture-state validators.',
  },
  'agentbench-adapted': {
    label: 'AgentBench-adapted',
    externalReference: 'AgentBench (Liu et al., 2023) — multi-tool execution chains',
    adaptationNotes: 'Ordered list → read → write chains on conversation workspace.',
  },
  'memory-agent-bench-adapted': {
    label: 'MemoryAgentBench-adapted',
    externalReference: 'MemoryAgentBench — long-horizon memory recall',
    adaptationNotes: 'Multi-turn remember/recall and passive ingestion episode counts.',
  },
  'state-bench-adapted': {
    label: 'STATE-Bench-adapted',
    externalReference: 'STATE-Bench — stateful multi-turn task tracking',
    adaptationNotes: 'Goal switches with scoped working-memory focus tokens.',
  },
  'tool-discovery-adapted': {
    label: 'Tool discovery adapted',
    externalReference: 'MCP / tool-search literature + session activation cache',
    adaptationNotes:
      'Catalog → use, describe → use, and session cache without re-catalog on later turns.',
  },
  'bfcl-adapted': {
    label: 'BFCL-adapted',
    externalReference:
      'Berkeley Function Calling Leaderboard (BFCL v4) — parallel and sequential tool invocation',
    adaptationNotes:
      'Structural multi-tool same-turn and ordered tool chains on workspace + memory tools.',
  },
  'longmem-adapted': {
    label: 'LongMemEval-adapted',
    externalReference: 'LongMemEval — delayed recall after intervening passive turns',
    adaptationNotes:
      'Remember → passive ingestion turn → recall; no English heuristics on middle-turn prose.',
  },
  'androidworld-adapted': {
    label: 'AndroidWorld-adapted',
    externalReference:
      'AndroidWorld — dynamic Android task initialization, app-state rewards, and teardown',
    adaptationNotes:
      'Permission matrices, denied-action evidence, and native side-effect state validators.',
  },
  'mobile-agent-bench-adapted': {
    label: 'MobileAgentBench-adapted',
    externalReference: 'MobileAgentBench — mobile GUI assistant planning and execution',
    adaptationNotes:
      'Mobile-native contact, communication, media, camera, and screen evidence chains.',
  },
  'mobileworld-adapted': {
    label: 'MobileWorld-adapted',
    externalReference: 'MobileWorld — GUI-only, user-interaction, and MCP-augmented mobile tasks',
    adaptationNotes:
      'Deterministic native fixture for discovery-to-mobile-action; real GUI/MCP runner remains external.',
  },
  'knowu-bench-adapted': {
    label: 'KnowU-Bench-adapted',
    externalReference:
      'KnowU-Bench — personalized and proactive mobile agents with hidden user profiles',
    adaptationNotes:
      'Memory-driven native contact action from remembered user preference; online personalization runner remains external.',
  },
  'androidworld-direct': {
    label: 'AndroidWorld direct shard',
    externalReference:
      'AndroidWorld — live Android emulator with dynamic tasks, app-state rewards, and teardown',
    adaptationNotes:
      'Direct local shard of AndroidWorld-style calendar/device state rewards; full emulator runner remains external.',
  },
  'mobileworld-direct': {
    label: 'MobileWorld direct shard',
    externalReference: 'MobileWorld — agent-user interactive and MCP-augmented mobile benchmark',
    adaptationNotes:
      'Direct local shard for cross-app mobile action and clarification pressure; GUI/MCP runner remains external.',
  },
  'spa-bench-direct': {
    label: 'SPA-Bench direct shard',
    externalReference:
      'SPA-Bench — smartphone agent benchmark with cross-app tasks and resource metrics',
    adaptationNotes:
      'Direct local shard over deterministic device side effects; real Android action/resource runner remains external.',
  },
  'bfcl-v4-direct': {
    label: 'BFCL V4 direct shard',
    externalReference:
      'Berkeley Function Calling Leaderboard V4 — live, serial, parallel, and agentic tool evaluation',
    adaptationNotes:
      'Direct result-driven shard for parallel/relevance/state correctness without tool-call path scoring.',
  },
  'longmemeval-v2-direct': {
    label: 'LongMemEval-V2 direct shard',
    externalReference:
      'LongMemEval-V2 — long histories, dynamic state, workflow knowledge, gotchas, and premise awareness',
    adaptationNotes:
      'Direct compact mobile-memory shard; full 451-question long-history benchmark remains external.',
  },
  'tau-bench-direct': {
    label: 'τ-bench direct shard',
    externalReference:
      'τ-bench / τ² / τ³ — stateful tool-agent-user interaction in real-world domains',
    adaptationNotes:
      'Direct stateful mobile shard with user-coordination and final state validation.',
  },
  'toolsandbox-direct': {
    label: 'ToolSandbox direct shard',
    externalReference: 'ToolSandbox — stateful, conversational, interactive tool-use benchmark',
    adaptationNotes:
      'Direct local shard for implicit tool-state dependencies and final milestone validation.',
  },
  'agentdojo-direct': {
    label: 'AgentDojo direct shard',
    externalReference: 'AgentDojo — dynamic prompt-injection and utility benchmark for tool agents',
    adaptationNotes:
      'Direct local shard with seeded untrusted workspace content and structural absence checks.',
  },
  'locomo-direct': {
    label: 'LoCoMo direct shard',
    externalReference:
      'LoCoMo — long-term conversational memory with multi-session temporal and personalized QA',
    adaptationNotes:
      'Direct local shard for one-conversation temporal memory updates, distractors, and summary artifact validation.',
  },
  'beam-direct': {
    label: 'BEAM direct shard',
    externalReference:
      'BEAM — benchmark for evaluating agent memory over long coherent interactions',
    adaptationNotes:
      'Direct local shard for longer coherent dialogue, fragmented probes, distractors, updates, and structural recall.',
  },
  'provider-prompt-cache-direct': {
    label: 'Provider prompt-cache direct shard',
    externalReference:
      'OpenAI, Anthropic, Gemini, and OpenRouter prompt-caching guidance — stable prefixes and cached-token accounting',
    adaptationNotes:
      'Long single-conversation prompt-cache probe with stable prior history, volatile current-turn context at the tail, and real cached-token read-rate scoring.',
  },
};

export type E2EScenarioBenchmarkRegistration = {
  benchmarkFamilies: ReadonlyArray<E2EBenchmarkFamily>;
  assessmentDimensions: ReadonlyArray<E2EAssessmentDimension>;
};

export const E2E_SCENARIO_BENCHMARK_REGISTRY: Readonly<
  Record<string, E2EScenarioBenchmarkRegistration>
> = {
  'file-write-read': {
    benchmarkFamilies: ['kavi-core', 'agentbench-adapted'],
    assessmentDimensions: ['tool_usage', 'task_completion', 'token_efficiency'],
  },
  'goal-evidence-complete': {
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: [
      'task_understanding',
      'task_completion',
      'control_graph',
      'outcome_validators',
    ],
  },
  'false-finalize-recovery': {
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['control_graph', 'task_completion', 'outcome_validators'],
  },
  'tool-catalog-agents': {
    benchmarkFamilies: ['kavi-core', 'tool-discovery-adapted'],
    assessmentDimensions: ['tool_discovery', 'tool_usage', 'control_graph'],
  },
  'memory-remember-recall': {
    benchmarkFamilies: ['kavi-core', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'tool_usage', 'task_completion'],
  },
  'personal-shopping-list': {
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['task_completion', 'tool_usage'],
  },
  'workspace-inventory-manifest': {
    benchmarkFamilies: ['kavi-core', 'gaia-adapted'],
    assessmentDimensions: ['task_completion', 'tool_usage'],
  },
  'multi-turn-memory-preference': {
    benchmarkFamilies: ['kavi-core', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'token_efficiency'],
  },
  'multi-turn-trip-artifact': {
    benchmarkFamilies: ['kavi-core', 'state-bench-adapted'],
    assessmentDimensions: ['task_understanding', 'task_completion', 'control_graph'],
  },
  'multi-turn-inventory-readback': {
    benchmarkFamilies: ['kavi-core', 'agentbench-adapted'],
    assessmentDimensions: ['tool_usage', 'task_completion'],
  },
  'multi-turn-catalog-memory': {
    benchmarkFamilies: ['kavi-core', 'tool-discovery-adapted'],
    assessmentDimensions: ['tool_discovery', 'memory'],
  },
  'tool-catalog-query-memory': {
    benchmarkFamilies: ['kavi-core', 'tool-discovery-adapted'],
    assessmentDimensions: ['tool_discovery', 'tool_usage'],
  },
  'multi-turn-passive-chitchat-memory': {
    benchmarkFamilies: ['kavi-core', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding'],
  },
  'multi-turn-goal-passive-recall': {
    benchmarkFamilies: ['kavi-core', 'state-bench-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'control_graph'],
  },
  'native-calendar-json-field': {
    benchmarkFamilies: ['kavi-core', 'tau-bench-adapted'],
    assessmentDimensions: ['outcome_validators', 'tool_usage'],
  },
  'multi-turn-gate-followup': {
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['control_graph', 'outcome_validators', 'task_completion'],
  },
  'bench-gaia-file-hop-chain': {
    benchmarkFamilies: ['gaia-adapted'],
    assessmentDimensions: ['task_completion', 'tool_usage', 'outcome_validators'],
  },
  'bench-session-tool-cache': {
    benchmarkFamilies: ['tool-discovery-adapted', 'tau-bench-adapted'],
    assessmentDimensions: ['tool_discovery', 'token_efficiency', 'memory'],
  },
  'bench-prompt-cache-long-horizon': {
    benchmarkFamilies: ['provider-prompt-cache-direct'],
    assessmentDimensions: ['token_efficiency', 'task_understanding', 'control_graph'],
  },
  'bench-prompt-cache-convergence-long-run': {
    benchmarkFamilies: ['provider-prompt-cache-direct'],
    assessmentDimensions: ['token_efficiency', 'task_understanding', 'control_graph'],
  },
  'bench-tool-describe-then-use': {
    benchmarkFamilies: ['tool-discovery-adapted'],
    assessmentDimensions: ['tool_discovery', 'tool_usage', 'memory'],
  },
  'bench-memory-state-3turn-recall': {
    benchmarkFamilies: ['memory-agent-bench-adapted', 'state-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding'],
  },
  'bench-goal-json-field-criterion': {
    benchmarkFamilies: ['tau-bench-adapted'],
    assessmentDimensions: ['outcome_validators', 'control_graph', 'task_completion'],
  },
  'bench-scoped-recall-goal-switch': {
    benchmarkFamilies: ['state-bench-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'control_graph'],
  },
  'bench-bootstrap-first-turn-goals': {
    benchmarkFamilies: ['agentbench-adapted', 'kavi-core'],
    assessmentDimensions: ['task_understanding', 'control_graph', 'task_completion'],
  },
  'bench-tau-native-json-outcome': {
    benchmarkFamilies: ['tau-bench-adapted'],
    assessmentDimensions: ['outcome_validators', 'tool_usage'],
  },
  'bench-tau-calendar-events-chain': {
    benchmarkFamilies: ['tau-bench-adapted'],
    assessmentDimensions: ['outcome_validators', 'tool_usage', 'task_completion'],
  },
  'bench-bfcl-multi-turn-state-carry': {
    benchmarkFamilies: ['bfcl-adapted', 'state-bench-adapted'],
    assessmentDimensions: ['task_understanding', 'tool_usage', 'memory', 'task_completion'],
  },
  'bench-bfcl-passive-no-tools': {
    benchmarkFamilies: ['bfcl-adapted', 'longmem-adapted'],
    assessmentDimensions: ['task_understanding', 'token_efficiency', 'control_graph'],
  },
  'bench-longmem-dual-fact-recall': {
    benchmarkFamilies: ['longmem-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'outcome_validators'],
  },
  'bench-longmem-knowledge-update-recall': {
    benchmarkFamilies: ['longmem-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'outcome_validators'],
  },
  'bench-longmem-abstention-empty-recall': {
    benchmarkFamilies: ['longmem-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'outcome_validators'],
  },
  'bench-agentbench-tool-chain': {
    benchmarkFamilies: ['agentbench-adapted'],
    assessmentDimensions: ['tool_usage', 'task_completion'],
  },
  'bench-bfcl-parallel-file-read': {
    benchmarkFamilies: ['bfcl-adapted', 'agentbench-adapted'],
    assessmentDimensions: ['tool_usage', 'task_completion', 'token_efficiency'],
  },
  'bench-bfcl-sequential-memory-chain': {
    benchmarkFamilies: ['bfcl-adapted', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['tool_usage', 'memory', 'task_completion'],
  },
  'bench-longmem-delayed-recall': {
    benchmarkFamilies: ['longmem-adapted', 'memory-agent-bench-adapted', 'state-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'control_graph'],
  },
  'bench-androidworld-calendar-mutation': {
    benchmarkFamilies: ['androidworld-adapted', 'tau-bench-adapted'],
    assessmentDimensions: ['mobile_native', 'tool_usage', 'outcome_validators', 'task_completion'],
  },
  'bench-androidworld-permission-denial': {
    benchmarkFamilies: ['androidworld-adapted'],
    assessmentDimensions: ['mobile_native', 'privacy_safety', 'outcome_validators'],
  },
  'bench-mobileagent-contact-message-draft': {
    benchmarkFamilies: ['mobile-agent-bench-adapted', 'bfcl-adapted'],
    assessmentDimensions: ['mobile_native', 'tool_usage', 'task_completion'],
  },
  'bench-mobileworld-discover-contact-message': {
    benchmarkFamilies: [
      'mobileworld-adapted',
      'mobile-agent-bench-adapted',
      'tool-discovery-adapted',
    ],
    assessmentDimensions: ['mobile_native', 'tool_discovery', 'tool_usage', 'task_completion'],
  },
  'bench-knowu-personalized-contact-memory': {
    benchmarkFamilies: [
      'knowu-bench-adapted',
      'mobile-agent-bench-adapted',
      'memory-agent-bench-adapted',
    ],
    assessmentDimensions: ['memory', 'mobile_native', 'task_understanding', 'task_completion'],
  },
  'bench-androidworld-clipboard-share-notify': {
    benchmarkFamilies: ['androidworld-adapted', 'mobile-agent-bench-adapted'],
    assessmentDimensions: ['mobile_native', 'privacy_safety', 'tool_usage', 'task_completion'],
  },
  'bench-mobileagent-media-state': {
    benchmarkFamilies: ['mobile-agent-bench-adapted', 'androidworld-adapted'],
    assessmentDimensions: ['mobile_native', 'privacy_safety', 'outcome_validators'],
  },
  'direct-agentdojo-untrusted-workspace-note': {
    benchmarkFamilies: ['agentdojo-direct'],
    assessmentDimensions: ['privacy_safety', 'task_completion', 'tool_usage', 'outcome_validators'],
  },
  'direct-bfcl-v4-parallel-relevance': {
    benchmarkFamilies: ['bfcl-v4-direct'],
    assessmentDimensions: ['tool_usage', 'task_completion', 'memory', 'token_efficiency'],
  },
  'direct-toolsandbox-state-dependency': {
    benchmarkFamilies: ['toolsandbox-direct'],
    assessmentDimensions: ['tool_usage', 'task_completion', 'outcome_validators', 'mobile_native'],
  },
  'direct-tau-user-coordination-state': {
    benchmarkFamilies: ['tau-bench-direct'],
    assessmentDimensions: [
      'task_understanding',
      'task_completion',
      'control_graph',
      'mobile_native',
    ],
  },
  'direct-androidworld-calendar-add-update': {
    benchmarkFamilies: ['androidworld-direct'],
    assessmentDimensions: ['mobile_native', 'task_completion', 'outcome_validators'],
  },
  'direct-mobileworld-cross-app-contact-message': {
    benchmarkFamilies: ['mobileworld-direct'],
    assessmentDimensions: [
      'mobile_native',
      'tool_discovery',
      'task_understanding',
      'task_completion',
    ],
  },
  'direct-spabench-cross-app-device-actions': {
    benchmarkFamilies: ['spa-bench-direct'],
    assessmentDimensions: [
      'mobile_native',
      'privacy_safety',
      'task_completion',
      'outcome_validators',
    ],
  },
  'direct-longmemeval-v2-mobile-preference-update': {
    benchmarkFamilies: ['longmemeval-v2-direct'],
    assessmentDimensions: ['memory', 'task_understanding', 'mobile_native', 'task_completion'],
  },
  'direct-locomo-temporal-conversation-memory': {
    benchmarkFamilies: ['locomo-direct', 'longmemeval-v2-direct'],
    assessmentDimensions: [
      'memory',
      'task_understanding',
      'task_completion',
      'token_efficiency',
      'outcome_validators',
    ],
  },
  'direct-beam-long-dialogue-multi-probe': {
    benchmarkFamilies: ['beam-direct', 'memory-agent-bench-adapted'],
    assessmentDimensions: [
      'memory',
      'task_understanding',
      'task_completion',
      'token_efficiency',
      'outcome_validators',
    ],
  },
  'direct-longmemeval-v2-experience-runbook': {
    benchmarkFamilies: ['longmemeval-v2-direct', 'memory-agent-bench-adapted'],
    assessmentDimensions: ['memory', 'task_understanding', 'task_completion', 'outcome_validators'],
  },
  'direct-mobileworld-long-horizon-personalization': {
    benchmarkFamilies: ['mobileworld-direct', 'longmemeval-v2-direct', 'locomo-direct'],
    assessmentDimensions: [
      'memory',
      'task_understanding',
      'mobile_native',
      'task_completion',
      'token_efficiency',
    ],
  },
  'delegation-worker-finalize': {
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['delegation', 'control_graph', 'task_completion'],
  },
  'delegation-worker-evidence-chain': {
    benchmarkFamilies: ['kavi-core', 'agentbench-adapted'],
    assessmentDimensions: ['delegation', 'control_graph', 'task_completion', 'outcome_validators'],
  },
};

const DEFAULT_REGISTRATION: E2EScenarioBenchmarkRegistration = {
  benchmarkFamilies: ['kavi-core'],
  assessmentDimensions: ['task_completion'],
};

export function lookupE2EScenarioBenchmarkMeta(
  scenarioId: string,
): E2EScenarioBenchmarkRegistration {
  return E2E_SCENARIO_BENCHMARK_REGISTRY[scenarioId] ?? DEFAULT_REGISTRATION;
}

export function listRegisteredE2EScenarioIds(): string[] {
  return Object.keys(E2E_SCENARIO_BENCHMARK_REGISTRY);
}
