import type { ConversationMode } from '../../types/conversation';
import type {
  CronFailureAlert,
  CronJob,
  CronJobRuntimeState,
  CronSchedule,
  SchedulerRunningCompletion,
  SchedulerTerminalReport,
  SessionTarget,
  WakeMode,
} from '../cron/types';
import type { RunFailureUpdate } from './storeAttemptSettlement';

type RuntimeStateUpdate = Partial<
  Omit<
    CronJobRuntimeState,
    | 'runningAttemptId'
    | 'runningStartedAtMs'
    | 'runningDefinitionRevision'
    | 'runningAttemptNumber'
    | 'runningConversationId'
    | 'runningEffectRisk'
    | 'runningOccurrenceId'
    | 'runningCompletion'
    | 'lastSettledAttemptId'
  >
>;

export interface SchedulerState {
  jobs: CronJob[];
  terminalReports: SchedulerTerminalReport[];
  addJob: (params: {
    name: string;
    schedule: CronSchedule;
    prompt: string;
    mode?: ConversationMode;
    model?: string;
    providerId?: string;
    sessionTarget?: SessionTarget;
    wakeMode?: WakeMode;
    deliveryMode?: 'conversation' | 'notification' | 'both';
    failureAlert?: CronFailureAlert;
  }) => string;
  updateJob: (
    id: string,
    updates: Partial<
      Pick<CronJob, 'name' | 'schedule' | 'payload' | 'enabled' | 'delivery' | 'failureAlert'>
    >,
  ) => void;
  removeJob: (id: string) => boolean;
  enableJob: (id: string) => void;
  disableJob: (id: string) => void;
  tryClaimJobAttempt: (params: {
    id: string;
    attemptId: string;
    timestamp: number;
    force: boolean;
  }) => { job: CronJob; attempt: number } | undefined;
  recordRunningAttemptConversation: (params: {
    id: string;
    attemptId: string;
    conversationId: string;
  }) => boolean;
  markRunningAttemptEffectUnsafe: (id: string, attemptId: string) => boolean;
  restoreRunningAttemptEffectRisk: (
    id: string,
    attemptId: string,
    effectRisk: 'safe' | 'unsafe',
  ) => boolean;
  recordRunningAttemptCompletion: (params: {
    id: string;
    attemptId: string;
    completion: SchedulerRunningCompletion;
  }) => boolean;
  reconcileStrandedAttempts: (timestamp: number) => CronJob[];
  reconcileStrandedAttempt: (
    id: string,
    attemptId: string,
    timestamp: number,
  ) => CronJob | undefined;
  requestPersistence: () => void;
  releaseJobAttemptClaim: (params: {
    id: string;
    attemptId: string;
    timestamp: number;
    error: string;
    report: SchedulerTerminalReport;
  }) => boolean;
  recordRun: (
    id: string,
    attemptId: string,
    definitionRevision: number,
    timestamp: number,
    report: SchedulerTerminalReport,
  ) => boolean;
  recordRunFailure: (
    id: string,
    attemptId: string,
    definitionRevision: number,
    update: RunFailureUpdate,
    report: SchedulerTerminalReport,
  ) => boolean;
  recordRunDeferral: (
    id: string,
    attemptId: string,
    definitionRevision: number,
    timestamp: number,
    error: string,
    report: SchedulerTerminalReport,
  ) => boolean;
  acknowledgeTerminalReport: (params: {
    reportId: string;
    clearDeliveryFailure: boolean;
  }) => boolean;
  restoreTerminalReport: (report: SchedulerTerminalReport) => void;
  recordTerminalReportDeliveryFailure: (params: {
    id: string;
    attemptId: string;
    timestamp: number;
    error: string;
  }) => { jobRecorded: boolean; reportRecorded: boolean };
  restoreJobAttemptClaim: (params: {
    id: string;
    attemptId: string;
    startedAtMs: number;
    definitionRevision: number;
    attempt: number;
    error?: string;
    conversationId?: string;
    effectRisk?: 'safe' | 'unsafe';
    occurrenceId?: string;
    completion?: SchedulerRunningCompletion;
    claimSnapshot?: CronJob;
  }) => void;
  resetJobRetry: (id: string) => void;
  updateJobRuntimeState: (id: string, updates: RuntimeStateUpdate) => void;
  getJob: (id: string) => CronJob | undefined;
  getEnabledJobs: () => CronJob[];
}
