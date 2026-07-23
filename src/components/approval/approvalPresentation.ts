import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import type { RemoteApprovalRequest, RemoteApprovalScope } from '../../types/remote';

export type ApprovalRiskLevel = NonNullable<RemoteApprovalRequest['riskLevel']>;
export type ApprovalReviewReason =
  | 'destructive'
  | 'sensitiveData'
  | 'systemAccess'
  | 'compoundAction'
  | 'unverified';

export interface ApprovalPresentation {
  action: string;
  description: string;
  target?: string;
  scope: RemoteApprovalScope;
  riskLevel: ApprovalRiskLevel;
  reviewReason?: ApprovalReviewReason;
}

const APPROVAL_SCOPES = new Set<RemoteApprovalScope>([
  'ssh',
  'workspace',
  'browser',
  'expo',
  'native',
  'other',
]);
const RISK_LEVELS = new Set<ApprovalRiskLevel>(['low', 'medium', 'high', 'critical']);

function safeSingleLine(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || !value) return '';
  return redactSensitiveText(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximumLength);
}

function classifyReviewReason(reasons: unknown): ApprovalReviewReason | undefined {
  if (!Array.isArray(reasons)) return undefined;
  const summary = reasons
    .filter((reason): reason is string => typeof reason === 'string')
    .join(' ')
    .toLowerCase();
  if (!summary) return undefined;

  if (/destructive|critical|delete|remove|purge/u.test(summary)) return 'destructive';
  if (/sensitive|credential|private|personal/u.test(summary)) return 'sensitiveData';
  if (/operator|pipe|compound/u.test(summary)) return 'compoundAction';
  if (/executable|command|host-reviewed|system/u.test(summary)) return 'systemAccess';
  return 'unverified';
}

export function buildApprovalPresentation(request: RemoteApprovalRequest): ApprovalPresentation {
  const requestedScope = request.scope ?? request.grantCandidate?.scope;
  const scope = APPROVAL_SCOPES.has(requestedScope as RemoteApprovalScope)
    ? (requestedScope as RemoteApprovalScope)
    : 'other';
  const riskLevel = RISK_LEVELS.has(request.riskLevel as ApprovalRiskLevel)
    ? (request.riskLevel as ApprovalRiskLevel)
    : 'low';
  const target = safeSingleLine(
    request.targetId ?? request.grantCandidate?.targetId,
    160,
  );

  return {
    action: safeSingleLine(request.title, 120),
    description: safeSingleLine(request.description, 500),
    ...(target ? { target } : {}),
    scope,
    riskLevel,
    reviewReason: classifyReviewReason(request.riskReasons),
  };
}

export function sortPendingApprovals(
  requests: Readonly<Record<string, RemoteApprovalRequest>>,
): RemoteApprovalRequest[] {
  return Object.values(requests)
    .filter((request) => request.status === 'pending')
    .sort((left, right) => {
      const leftRequestedAt = Number.isFinite(left.requestedAt) ? left.requestedAt : 0;
      const rightRequestedAt = Number.isFinite(right.requestedAt) ? right.requestedAt : 0;
      const leftDeadline = Number.isFinite(left.expiresAt) ? left.expiresAt! : leftRequestedAt;
      const rightDeadline = Number.isFinite(right.expiresAt) ? right.expiresAt! : rightRequestedAt;
      return leftDeadline - rightDeadline || leftRequestedAt - rightRequestedAt;
    });
}

export function secondsUntilExpiry(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function formatApprovalCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
