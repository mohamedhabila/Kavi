// ---------------------------------------------------------------------------
// Kavi — Compaction recall fixtures (structural)
// ---------------------------------------------------------------------------

export interface CompactionRecallFixture {
  id: string;
  goalsPromptSection: string;
  profileSections: ReadonlyArray<string>;
  requiredGoalMarkers: ReadonlyArray<string>;
  requiredProfileMarkers: ReadonlyArray<string>;
}

export const COMPACTION_RECALL_FIXTURES: ReadonlyArray<CompactionRecallFixture> = [
  {
    id: 'goals-and-profile-survive-aggressive',
    goalsPromptSection:
      '## Current Goals\n\n### Active\n- goal-id:ship-feature — Ship feature\n  - successCriteria: evidence.min:1',
    profileSections: [
      '<block label="persona">Everyday assistant</block>',
      '<block label="pinned_fact">entity:e2e-token subject:artifact_token predicate:value object:E2E-RECALL-42</block>',
    ],
    requiredGoalMarkers: ['## Current Goals', 'goal-id:ship-feature', 'evidence.min:1'],
    requiredProfileMarkers: ['## Persistent Context', 'persona', 'pinned_fact', 'E2E-RECALL-42'],
  },
  {
    id: 'goals-only-survive',
    goalsPromptSection:
      '## Current Goals\n\n### Active\n- goal-id:verify-artifact — Verify artifact\n  - successCriteria: evidence.artifact:artifacts/out.txt',
    profileSections: [],
    requiredGoalMarkers: ['goal-id:verify-artifact', 'evidence.artifact:artifacts/out.txt'],
    requiredProfileMarkers: [],
  },
];