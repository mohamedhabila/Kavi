import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
import type {
  ApprovalRiskReasonCode,
  RemoteApprovalRequest,
  RemoteApprovalScope,
} from '../../types/remote';

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

/**
 * Closed, exhaustive mapping from each structured risk-reason code
 * (`ApprovalRiskReasonCode` in `types/remote.ts`) to the user-facing
 * review-reason category; adding a code without a row here fails typecheck. Never derived from the human-readable
 * `riskReasons` sentences, which may be reworded independently of this list.
 */
const REASON_CODE_CATEGORY: Record<ApprovalRiskReasonCode, ApprovalReviewReason> = {
  destructive_executable: 'destructive',
  destructive_operation: 'destructive',
  sensitive_path: 'sensitiveData',
  compound_operators: 'compoundAction',
  system_executable: 'systemAccess',
  unparseable_command: 'systemAccess',
  host_reviewed_action: 'systemAccess',
  code_execution: 'unverified',
  network_access: 'unverified',
  custom_package_index: 'unverified',
  url_shaped_package: 'unverified',
};

// Priority order when multiple reason codes apply to one request — matches the
// severity ordering the UI previously derived from prose pattern precedence.
const REVIEW_REASON_PRIORITY: ApprovalReviewReason[] = [
  'destructive',
  'sensitiveData',
  'compoundAction',
  'systemAccess',
  'unverified',
];

function classifyReviewReason(reasonCodes: unknown): ApprovalReviewReason | undefined {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) return undefined;
  const categories = new Set(
    reasonCodes
      .filter(
        (code): code is ApprovalRiskReasonCode =>
          typeof code === 'string' && code in REASON_CODE_CATEGORY,
      )
      .map((code) => REASON_CODE_CATEGORY[code]),
  );
  if (categories.size === 0) return undefined;
  return REVIEW_REASON_PRIORITY.find((category) => categories.has(category));
}

export function buildApprovalPresentation(request: RemoteApprovalRequest): ApprovalPresentation {
  const requestedScope = request.scope ?? request.grantCandidate?.scope;
  const scope = APPROVAL_SCOPES.has(requestedScope as RemoteApprovalScope)
    ? (requestedScope as RemoteApprovalScope)
    : 'other';
  const riskLevel = RISK_LEVELS.has(request.riskLevel as ApprovalRiskLevel)
    ? (request.riskLevel as ApprovalRiskLevel)
    : 'low';
  const target = safeSingleLine(request.targetId ?? request.grantCandidate?.targetId, 160);

  return {
    action: safeSingleLine(request.title, 120),
    description: safeSingleLine(request.description, 500),
    ...(target ? { target } : {}),
    scope,
    riskLevel,
    reviewReason: classifyReviewReason(request.riskReasonCodes),
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
