// ---------------------------------------------------------------------------
// Kavi — Cron Types
// ---------------------------------------------------------------------------

export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    definitionRevision: number;
    name: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: TSchedule;
    sessionTarget: TSessionTarget;
    wakeMode: TWakeMode;
    payload: TPayload;
    delivery?: TDelivery;
    failureAlert?: TFailureAlert;
  };

export type CronSchedule =
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'at'; at?: string; atMs?: number | string }
  | { kind: 'every'; everyMs: number | string; anchorMs?: number | string };

export type SessionTarget = 'main' | 'isolated';
export type WakeMode = 'continue' | 'new';
export type DeliveryMode = 'conversation' | 'notification' | 'both';
export type SchedulerWakePolicy = 'notify_only' | 'active_only';
export type SchedulerTrigger =
  | 'scheduled'
  | 'manual'
  | 'missed-recovery'
  | 'foreground-reconcile'
  | 'notification-tap';

export type SchedulerTerminalReport = {
  id: string;
  jobId: string;
  jobName: string;
  status: 'success' | 'error' | 'retrying';
  notification: 'success' | 'failure' | 'none';
  startedAtMs: number;
  completedAtMs: number;
  attempt: number;
  trigger: SchedulerTrigger;
  output?: string;
  error?: string;
  warnings?: string[];
  deliveryWarnings?: string[];
  conversationId?: string;
  conversationDurable?: boolean;
};

export type CronPayload = {
  prompt: string;
  mode: ConversationMode;
  model?: string;
  providerId?: string;
};

export type CronDelivery = {
  mode: DeliveryMode;
  conversationId?: string;
};

export type CronFailureAlert = {
  enabled: boolean;
  maxRetries?: number;
};

export type SchedulerRunningCompletion = {
  completedAtMs: number;
  output: string;
  conversationId?: string;
  conversationDurable?: boolean;
  warnings?: string[];
};

export type CronJobRuntimeState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastAttemptAtMs?: number;
  lastSuccessAtMs?: number;
  lastFailureAtMs?: number;
  lastError?: string;
  retryAttempts?: number;
  nextRetryAtMs?: number;
  retryConversationId?: string;
  retryOccurrenceId?: string;
  runningAttemptId?: string;
  runningStartedAtMs?: number;
  runningDefinitionRevision?: number;
  runningAttemptNumber?: number;
  runningConversationId?: string;
  runningEffectRisk?: 'safe' | 'unsafe';
  runningOccurrenceId?: string;
  runningCompletion?: SchedulerRunningCompletion;
  lastAmbiguousAttemptId?: string;
  lastAmbiguousAtMs?: number;
  lastAmbiguousStartedAtMs?: number;
  lastAmbiguousAttemptNumber?: number;
  lastDeliveryError?: string;
  lastDeliveryFailureAtMs?: number;
  lastSettledAttemptId?: string;
  pendingWakeNotificationId?: string;
  pendingWakeNotificationRunAtMs?: number;
  pendingWakeNotificationTitle?: string;
  lastWakeAtMs?: number;
  lastWakeSource?: SchedulerTrigger;
  lastWakeError?: string;
  lastWakeFailureAtMs?: number;
  wakePolicy?: SchedulerWakePolicy;
};

export type CronJob = CronJobBase<
  CronSchedule,
  SessionTarget,
  WakeMode,
  CronPayload,
  CronDelivery,
  CronFailureAlert
> &
  CronJobRuntimeState;
import type { ConversationMode } from '../../types/conversation';
