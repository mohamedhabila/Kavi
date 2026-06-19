// ---------------------------------------------------------------------------
// Kavi — Acceptance task fixtures
// ---------------------------------------------------------------------------
// Deterministic mobile task traces for token/tool-call ceiling validation.
// ---------------------------------------------------------------------------

export type AcceptanceTurnTrace = {
  tools: string[];
  estimatedTokens: number;
};

export type AcceptanceFixture = {
  id: string;
  title: string;
  maxToolCalls: number;
  maxTotalTokens: number;
  turns: AcceptanceTurnTrace[];
  /** Research-only: max web_search turns before first web_fetch. */
  maxWebSearchBeforeFetch?: number;
};

export const RESEARCH_ACCEPTANCE_FIXTURE: AcceptanceFixture = {
  id: 'research',
  title: 'Three-source official docs comparison',
  maxToolCalls: 5,
  maxTotalTokens: 35_000,
  maxWebSearchBeforeFetch: 2,
  turns: [
    { tools: ['web_search'], estimatedTokens: 4_200 },
    { tools: ['web_fetch', 'web_fetch', 'web_fetch'], estimatedTokens: 9_800 },
    { tools: [], estimatedTokens: 2_800 },
  ],
};

export const SCHEDULING_ACCEPTANCE_FIXTURE: AcceptanceFixture = {
  id: 'scheduling',
  title: 'Review upcoming calendar events',
  maxToolCalls: 4,
  maxTotalTokens: 18_000,
  turns: [
    { tools: ['calendar_events'], estimatedTokens: 3_100 },
    { tools: ['calendar_events'], estimatedTokens: 2_400 },
    { tools: [], estimatedTokens: 1_900 },
  ],
};

export const COMMUNICATION_ACCEPTANCE_FIXTURE: AcceptanceFixture = {
  id: 'communication',
  title: 'Check source and draft a short reply',
  maxToolCalls: 5,
  maxTotalTokens: 22_000,
  turns: [
    { tools: ['web_fetch'], estimatedTokens: 3_600 },
    { tools: ['write_file'], estimatedTokens: 2_200 },
    { tools: [], estimatedTokens: 2_000 },
  ],
};

export const FILE_TASK_ACCEPTANCE_FIXTURE: AcceptanceFixture = {
  id: 'file_task',
  title: 'Save notes to workspace',
  maxToolCalls: 4,
  maxTotalTokens: 16_000,
  turns: [
    { tools: ['list_files'], estimatedTokens: 2_100 },
    { tools: ['write_file'], estimatedTokens: 2_800 },
    { tools: ['read_file'], estimatedTokens: 1_700 },
    { tools: [], estimatedTokens: 1_500 },
  ],
};

export const MULTI_STEP_ERRAND_ACCEPTANCE_FIXTURE: AcceptanceFixture = {
  id: 'multi_step_errand',
  title: 'Plan and confirm a multi-step errand',
  maxToolCalls: 6,
  maxTotalTokens: 28_000,
  turns: [
    { tools: ['web_search'], estimatedTokens: 3_800 },
    { tools: ['maps_open'], estimatedTokens: 2_100 },
    { tools: ['calendar_events'], estimatedTokens: 2_400 },
    { tools: ['write_file'], estimatedTokens: 2_000 },
    { tools: [], estimatedTokens: 2_200 },
  ],
};

export const ACCEPTANCE_TASK_FIXTURES: AcceptanceFixture[] = [
  RESEARCH_ACCEPTANCE_FIXTURE,
  SCHEDULING_ACCEPTANCE_FIXTURE,
  COMMUNICATION_ACCEPTANCE_FIXTURE,
  FILE_TASK_ACCEPTANCE_FIXTURE,
  MULTI_STEP_ERRAND_ACCEPTANCE_FIXTURE,
];