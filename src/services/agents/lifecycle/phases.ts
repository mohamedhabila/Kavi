import type { SubAgentActivityEntry, SubAgentResult, SubAgentSnapshot } from '../../../types/subAgent';

export type SubAgentAbortReason = 'cancelled' | 'timeout' | 'max-iterations';

export interface ActiveSubAgentRunControl {
  abortController: AbortController;
  cancelReason?: string;
  abortReason?: SubAgentAbortReason;
}

export type ProgressChanges<TAgent extends SubAgentSnapshot> = Partial<
  Pick<
    TAgent,
    | 'currentActivity'
    | 'activeToolName'
    | 'activeToolStartedAt'
    | 'lastToolResultPreview'
    | 'launchState'
    | 'modelResponsePendingSince'
    | 'taskLedger'
  >
>;

export type ProgressOptions = {
  activityKind?: SubAgentActivityEntry['kind'];
  activityText?: string;
  announce?: boolean;
  markProgress?: boolean;
};

export type PreparedSubAgentSession<TAgent extends SubAgentSnapshot> = {
  sessionId: string;
  depth: number;
  maxIterations: number;
  timeoutMs?: number;
  sandboxPolicy: 'full' | 'safe-only' | 'inherit';
  subAgent: TAgent;
};

export type TerminalAnnouncement = 'completed' | 'cancelled' | 'timeout' | 'error';

export interface LaunchPhase<TAgent extends SubAgentSnapshot> {
  cancelSubAgent(sessionId: string, reason?: string): TAgent | undefined;
}

export interface RunPhase {
  waitForSubAgentCompletion(
    sessionId: string,
    waitTimeoutMs?: number,
  ): Promise<SubAgentResult | null>;
}

export interface TerminalizePhase {
  observeBackgroundSubAgentResult(
    started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
    options?: { announce?: boolean },
  ): void;
}

export interface FinalizePhase {
  cleanupSubAgents(): void;
}

export interface PresentPhase {
  initSubAgentRegistry(conversations?: unknown[]): Promise<void>;
  detectOrphans(conversations?: unknown[]): Promise<number>;
}
