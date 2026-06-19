export interface ApprovalAnalytics {
  totalRequests: number;
  totalApproved: number;
  totalRejected: number;
  totalExpired: number;
  totalAllowAlways: number;
  averageDecisionMs: number;
  /** Counts by tool name. */
  byTool: Record<string, { approved: number; rejected: number; expired: number }>;
}

export const DEFAULT_ANALYTICS: ApprovalAnalytics = {
  totalRequests: 0,
  totalApproved: 0,
  totalRejected: 0,
  totalExpired: 0,
  totalAllowAlways: 0,
  averageDecisionMs: 0,
  byTool: {},
};

export function recordAnalyticsOutcome(
  analytics: ApprovalAnalytics,
  toolName: string,
  outcome: 'approved' | 'rejected' | 'expired' | 'allow-always',
  decisionMs?: number,
): ApprovalAnalytics {
  const next = { ...analytics };
  if (outcome === 'approved') {
    next.totalApproved++;
  } else if (outcome === 'rejected') {
    next.totalRejected++;
  } else if (outcome === 'expired') {
    next.totalExpired++;
  } else if (outcome === 'allow-always') {
    next.totalAllowAlways++;
    next.totalApproved++;
  }

  if (!next.byTool[toolName]) {
    next.byTool[toolName] = { approved: 0, rejected: 0, expired: 0 };
  }
  const entry = { ...next.byTool[toolName] };
  if (outcome === 'approved' || outcome === 'allow-always') entry.approved++;
  else if (outcome === 'rejected') entry.rejected++;
  else if (outcome === 'expired') entry.expired++;
  next.byTool = { ...next.byTool, [toolName]: entry };

  if (decisionMs !== undefined && decisionMs > 0) {
    const totalDecisions = next.totalApproved + next.totalRejected + next.totalExpired;
    next.averageDecisionMs =
      (next.averageDecisionMs * (totalDecisions - 1) + decisionMs) / totalDecisions;
  }

  return next;
}
