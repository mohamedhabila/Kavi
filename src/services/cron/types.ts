// ---------------------------------------------------------------------------
// Kavi — Cron Types
// ---------------------------------------------------------------------------

export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
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

export type CronPayload = {
  prompt: string;
  model?: string;
  providerId?: string;
  maxTokens?: number;
  timeout?: number;
};

export type CronDelivery = {
  mode: DeliveryMode;
  conversationId?: string;
};

export type CronFailureAlert = {
  enabled: boolean;
  maxRetries?: number;
};

export type CronJob = CronJobBase<
  CronSchedule,
  SessionTarget,
  WakeMode,
  CronPayload,
  CronDelivery,
  CronFailureAlert
>;
