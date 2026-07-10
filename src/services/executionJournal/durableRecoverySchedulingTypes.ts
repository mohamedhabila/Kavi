export type DurableRecoveryScheduleOutcome =
  | { kind: 'scheduled' | 'already_scheduled'; runId: string }
  | { kind: 'not_candidate'; runId: string }
  | { kind: 'not_supported'; runId: string; reason: 'unsupported_platform' }
  | { kind: 'deferred' | 'blocked'; runId: string; reason: string };
