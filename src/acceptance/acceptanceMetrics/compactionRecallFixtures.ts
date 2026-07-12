// ---------------------------------------------------------------------------
// Kavi — Compaction recall fixtures (structural)
// ---------------------------------------------------------------------------

export interface CompactionRecallFixture {
  id: string;
  goalsPromptSection: string;
  requiredGoalMarkers: ReadonlyArray<string>;
  requiredSummaryMarkers: ReadonlyArray<string>;
}

export const COMPACTION_RECALL_FIXTURES: ReadonlyArray<CompactionRecallFixture> = [
  {
    id: 'current-goals-and-compacted-summary-stay-separated',
    goalsPromptSection:
      '## Current Goals\n\n### Active\n- goal-id:ship-feature — Ship feature\n  - successCriteria: evidence.min:1',
    requiredGoalMarkers: ['## Current Goals', 'goal-id:ship-feature', 'evidence.min:1'],
    requiredSummaryMarkers: [
      '[Conversation Summary]',
      '## Task Overview',
      'Long transcript compacted.',
    ],
  },
  {
    id: 'goals-only-survive',
    goalsPromptSection:
      '## Current Goals\n\n### Active\n- goal-id:verify-artifact — Verify artifact\n  - successCriteria: evidence.artifact:artifacts/out.txt',
    requiredGoalMarkers: ['goal-id:verify-artifact', 'evidence.artifact:artifacts/out.txt'],
    requiredSummaryMarkers: ['[Conversation Summary]', 'Long transcript compacted.'],
  },
];
