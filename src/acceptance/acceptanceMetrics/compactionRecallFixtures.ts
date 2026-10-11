// ---------------------------------------------------------------------------
// Kavi — Compaction recall fixtures (structural)
// ---------------------------------------------------------------------------

import type { AgentPlanStep } from '../../types/agentRun';

export interface CompactionRecallFixture {
  id: string;
  plan: ReadonlyArray<AgentPlanStep>;
  requiredPlanMarkers: ReadonlyArray<string>;
  requiredSummaryMarkers: ReadonlyArray<string>;
}

export const COMPACTION_RECALL_FIXTURES: ReadonlyArray<CompactionRecallFixture> = [
  {
    id: 'current-plan-and-compacted-summary-stay-separated',
    plan: [
      { step: 'Draft the release notes', status: 'completed' },
      { step: 'Ship the feature', status: 'in_progress' },
    ],
    requiredPlanMarkers: ['## Plan', 'Draft the release notes', 'Ship the feature'],
    requiredSummaryMarkers: [
      '[Conversation Summary]',
      '## Task Overview',
      'Long transcript compacted.',
    ],
  },
  {
    id: 'plan-only-survives',
    plan: [{ step: 'Verify artifacts/out.txt', status: 'pending' }],
    requiredPlanMarkers: ['Verify artifacts/out.txt'],
    requiredSummaryMarkers: ['[Conversation Summary]', 'Long transcript compacted.'],
  },
];
