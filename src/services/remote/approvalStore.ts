// Central state for remote approval workflows.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  RemoteApprovalDecisionPolicy,
  RemoteApprovalGrantCandidate,
  RemoteApprovalRequest,
} from '../../types/remote';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';
import { describeToolInvocation } from '../security/toolPrivacy';
import {
  DEFAULT_ANALYTICS,
  recordAnalyticsOutcome,
  type ApprovalAnalytics,
} from './approvalAnalytics';
import {
  DEFAULT_POLICY,
  requiresActionApproval,
  type ApprovalPolicy,
  type PersonaPolicyOverride,
} from './approvalPolicy';
import {
  buildApprovalGrantCandidate,
  createInternalAllowlistEntry,
  createUserApprovalGrant,
  hasMatchingActiveApprovalGrant,
  isApprovalGrantCandidate,
  normalizePersistedAllowlist,
  type AllowlistEntry,
} from './approvalGrants';
import {
  assessToolRisk,
  getApprovalScope,
  type ApprovalScope,
  type RiskLevel,
} from './approvalRisk';

export { analyzeCommandRisk, assessToolRisk } from './approvalRisk';
export type { ApprovalScope, CommandRiskAssessment, RiskLevel } from './approvalRisk';
export type { ApprovalAnalytics } from './approvalAnalytics';
export type { AllowlistEntry } from './approvalGrants';
export type { ApprovalPolicy, PersonaPolicyOverride } from './approvalPolicy';

const STANDARD_APPROVAL_DECISION_POLICY = Object.freeze({
  persistentApproval: 'allowed',
  expiryFallback: 'global-policy',
} as const satisfies RemoteApprovalDecisionPolicy);

export const ONE_SHOT_APPROVAL_DECISION_POLICY = Object.freeze({
  persistentApproval: 'forbidden',
  expiryFallback: 'reject',
} as const satisfies RemoteApprovalDecisionPolicy);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStandardDecisionPolicy(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.persistentApproval === 'allowed' &&
    value.expiryFallback === 'global-policy'
  );
}

function isOneShotDecisionPolicy(value: unknown): boolean {
  return (
    isRecord(value) && value.persistentApproval === 'forbidden' && value.expiryFallback === 'reject'
  );
}

function normalizeDecisionPolicy(
  value: unknown,
  invalidFallback: 'standard' | 'one-shot',
): RemoteApprovalDecisionPolicy {
  if (isStandardDecisionPolicy(value)) {
    return { ...STANDARD_APPROVAL_DECISION_POLICY };
  }
  if (isOneShotDecisionPolicy(value)) {
    return { ...ONE_SHOT_APPROVAL_DECISION_POLICY };
  }
  return invalidFallback === 'standard'
    ? { ...STANDARD_APPROVAL_DECISION_POLICY }
    : { ...ONE_SHOT_APPROVAL_DECISION_POLICY };
}

function grantCandidateMatchesRequest(
  candidate: unknown,
  request: Readonly<{
    toolName?: unknown;
    scope?: unknown;
    targetId?: unknown;
    riskLevel?: unknown;
  }>,
): candidate is RemoteApprovalGrantCandidate {
  return (
    isApprovalGrantCandidate(candidate) &&
    candidate.toolName === request.toolName &&
    (request.scope === undefined || candidate.scope === request.scope) &&
    candidate.targetId === request.targetId &&
    request.riskLevel !== 'high' &&
    request.riskLevel !== 'critical'
  );
}

function normalizePersistedRequests(
  value: unknown,
  fallbacks: {
    missingPolicy: 'standard' | 'one-shot';
    invalidPolicy: 'standard' | 'one-shot';
  },
): Record<string, RemoteApprovalRequest> {
  if (!isRecord(value)) return {};

  const requests: Record<string, RemoteApprovalRequest> = {};
  for (const [id, rawRequest] of Object.entries(value)) {
    if (!isRecord(rawRequest)) continue;
    const decisionPolicy = normalizeDecisionPolicy(
      rawRequest.decisionPolicy,
      rawRequest.decisionPolicy === undefined ? fallbacks.missingPolicy : fallbacks.invalidPolicy,
    );
    const grantCandidate =
      isStandardDecisionPolicy(decisionPolicy) &&
      grantCandidateMatchesRequest(rawRequest.grantCandidate, rawRequest)
        ? rawRequest.grantCandidate
        : undefined;
    requests[id] = {
      ...(rawRequest as unknown as RemoteApprovalRequest),
      ...(grantCandidate ? { grantCandidate } : { grantCandidate: undefined }),
      decisionPolicy,
    };
  }
  return requests;
}

interface ApprovalStoreState {
  requests: Record<string, RemoteApprovalRequest>;
  policy: ApprovalPolicy;
  allowlist: AllowlistEntry[];
  analytics: ApprovalAnalytics;

  createRequest: (params: {
    targetId?: string;
    toolName?: string;
    scope?: ApprovalScope;
    jobId?: string;
    title: string;
    description: string;
    riskLevel?: RiskLevel;
    riskReasons?: string[];
    decisionPolicy?: RemoteApprovalDecisionPolicy;
    grantCandidate?: RemoteApprovalGrantCandidate;
  }) => string;
  approveRequest: (id: string) => void;
  approveAlways: (id: string) => void;
  rejectRequest: (id: string) => void;
  expireRequest: (id: string) => void;
  clearRequest: (id: string) => void;
  clearResolved: () => void;

  setPolicy: (patch: Partial<ApprovalPolicy>) => void;
  addPersonaOverride: (override: PersonaPolicyOverride) => void;
  removePersonaOverride: (personaId: string) => void;

  addToAllowlist: (key: string, personaId?: string) => void;
  removeFromAllowlist: (key: string) => void;
  isAllowlisted: (key: string, personaId?: string) => boolean;

  getPendingRequests: () => RemoteApprovalRequest[];
  getRequest: (id: string) => RemoteApprovalRequest | undefined;
  getAnalytics: () => ApprovalAnalytics;

  sweepExpired: () => number;
}

const MAX_REQUESTS = 200;

function trimRequests(
  requests: Record<string, RemoteApprovalRequest>,
): Record<string, RemoteApprovalRequest> {
  const entries = Object.entries(requests)
    .sort(([, a], [, b]) => b.requestedAt - a.requestedAt)
    .slice(0, MAX_REQUESTS);
  return Object.fromEntries(entries);
}

export const useApprovalStore = create<ApprovalStoreState>()(
  persist(
    (set, get) => ({
      requests: {},
      policy: DEFAULT_POLICY,
      allowlist: [],
      analytics: DEFAULT_ANALYTICS,

      createRequest: (params) => {
        const id = `approval-${generateId()}`;
        const now = Date.now();
        const timeoutMs = get().policy.timeoutMs;
        const decisionPolicy =
          params.decisionPolicy === undefined
            ? { ...STANDARD_APPROVAL_DECISION_POLICY }
            : normalizeDecisionPolicy(params.decisionPolicy, 'one-shot');
        const grantCandidate =
          isStandardDecisionPolicy(decisionPolicy) &&
          grantCandidateMatchesRequest(params.grantCandidate, params)
            ? params.grantCandidate
            : undefined;
        const request: RemoteApprovalRequest = {
          id,
          targetId: params.targetId,
          toolName: params.toolName,
          scope: params.scope,
          jobId: params.jobId,
          title: params.title,
          description: params.description,
          status: 'pending',
          requestedAt: now,
          expiresAt: now + timeoutMs,
          riskLevel: params.riskLevel,
          riskReasons: params.riskReasons,
          decisionPolicy,
          grantCandidate,
        };
        set((state) => ({
          requests: trimRequests({ ...state.requests, [id]: request }),
          analytics: { ...state.analytics, totalRequests: state.analytics.totalRequests + 1 },
        }));
        return id;
      },

      approveRequest: (id) =>
        set((state) => {
          const req = state.requests[id];
          if (!req || req.status !== 'pending') return state;
          const now = Date.now();
          return {
            requests: {
              ...state.requests,
              [id]: { ...req, status: 'approved', resolvedAt: now },
            },
            analytics: recordAnalyticsOutcome(
              state.analytics,
              req.toolName || 'unknown',
              'approved',
              now - req.requestedAt,
            ),
          };
        }),

      approveAlways: (id) =>
        set((state) => {
          const req = state.requests[id];
          if (!req || req.status !== 'pending' || !isStandardDecisionPolicy(req.decisionPolicy)) {
            return state;
          }
          const now = Date.now();
          const entry = req.grantCandidate
            ? createUserApprovalGrant(req.grantCandidate, now, req.id)
            : undefined;
          if (!entry) return state;
          const newAllowlist = state.allowlist.some(
            (candidate) =>
              candidate.status === 'active' &&
              candidate.key === entry.key &&
              candidate.personaId === entry.personaId,
          )
            ? state.allowlist
            : [...state.allowlist, entry];
          return {
            requests: {
              ...state.requests,
              [id]: { ...req, status: 'approved', resolvedAt: now },
            },
            allowlist: newAllowlist,
            analytics: recordAnalyticsOutcome(
              state.analytics,
              req.toolName || 'unknown',
              'allow-always',
              now - req.requestedAt,
            ),
          };
        }),

      rejectRequest: (id) =>
        set((state) => {
          const req = state.requests[id];
          if (!req || req.status !== 'pending') return state;
          const now = Date.now();
          return {
            requests: {
              ...state.requests,
              [id]: { ...req, status: 'rejected', resolvedAt: now },
            },
            analytics: recordAnalyticsOutcome(
              state.analytics,
              req.toolName || 'unknown',
              'rejected',
              now - req.requestedAt,
            ),
          };
        }),

      expireRequest: (id) =>
        set((state) => {
          const req = state.requests[id];
          if (!req || req.status !== 'pending') return state;
          const now = Date.now();
          return {
            requests: {
              ...state.requests,
              [id]: { ...req, status: 'expired', resolvedAt: now },
            },
            analytics: recordAnalyticsOutcome(
              state.analytics,
              req.toolName || 'unknown',
              'expired',
              now - req.requestedAt,
            ),
          };
        }),

      clearRequest: (id) =>
        set((state) => {
          const next = { ...state.requests };
          delete next[id];
          return { requests: next };
        }),

      clearResolved: () =>
        set((state) => {
          const next: Record<string, RemoteApprovalRequest> = {};
          for (const [key, request] of Object.entries(state.requests)) {
            if (request.status === 'pending') next[key] = request;
          }
          return { requests: next };
        }),

      setPolicy: (patch) =>
        set((state) => ({
          policy: { ...state.policy, ...patch },
        })),

      addPersonaOverride: (override) =>
        set((state) => {
          const existing = state.policy.personaOverrides.filter(
            (entry) => entry.personaId !== override.personaId,
          );
          return {
            policy: {
              ...state.policy,
              personaOverrides: [...existing, override],
            },
          };
        }),

      removePersonaOverride: (personaId) =>
        set((state) => ({
          policy: {
            ...state.policy,
            personaOverrides: state.policy.personaOverrides.filter(
              (entry) => entry.personaId !== personaId,
            ),
          },
        })),

      addToAllowlist: (key, personaId) =>
        set((state) => {
          if (
            state.allowlist.some(
              (entry) =>
                entry.status === 'active' && entry.key === key && entry.personaId === personaId,
            )
          ) {
            return state;
          }
          const entry = createInternalAllowlistEntry(key, personaId, Date.now());
          if (!entry) return state;
          return {
            allowlist: [...state.allowlist, entry],
          };
        }),

      removeFromAllowlist: (key) =>
        set((state) => {
          const hasInternalEntry = state.allowlist.some(
            (entry) => entry.key === key && entry.source === 'internal',
          );
          return {
            allowlist: state.allowlist.filter(
              (entry) => entry.key !== key || (hasInternalEntry && entry.source !== 'internal'),
            ),
          };
        }),

      isAllowlisted: (key, personaId) => {
        const { allowlist } = get();
        return allowlist.some(
          (entry) =>
            entry.status === 'active' &&
            entry.key === key &&
            (entry.personaId === undefined || entry.personaId === personaId),
        );
      },

      getPendingRequests: () =>
        Object.values(get().requests)
          .filter((request) => request.status === 'pending')
          .sort((left, right) => right.requestedAt - left.requestedAt),

      getRequest: (id) => get().requests[id],

      getAnalytics: () => get().analytics,

      sweepExpired: () => {
        const state = get();
        const now = Date.now();
        const timeoutMs = state.policy.timeoutMs;
        let count = 0;
        const nextRequests = { ...state.requests };
        let analytics = { ...state.analytics };

        for (const [id, request] of Object.entries(nextRequests)) {
          if (request.status === 'pending' && now - request.requestedAt > timeoutMs) {
            nextRequests[id] = { ...request, status: 'expired', resolvedAt: now };
            analytics = recordAnalyticsOutcome(analytics, request.toolName || 'unknown', 'expired');
            count++;
          }
        }

        if (count > 0) {
          set({ requests: nextRequests, analytics });
        }
        return count;
      },
    }),
    {
      name: 'kavi-approvals',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      migrate: (persistedState: unknown, version: number) => {
        const persisted = isRecord(persistedState) ? persistedState : {};
        let migrated: Record<string, unknown> = { ...persisted };

        if (version < 2) {
          const persistedPolicy = isRecord(migrated.policy) ? migrated.policy : {};
          migrated = {
            ...migrated,
            allowlist: Array.isArray(migrated.allowlist) ? migrated.allowlist : [],
            analytics: isRecord(migrated.analytics) ? migrated.analytics : DEFAULT_ANALYTICS,
            policy: {
              ...DEFAULT_POLICY,
              ...persistedPolicy,
              expiryFallback: persistedPolicy.expiryFallback || 'reject',
              personaOverrides: Array.isArray(persistedPolicy.personaOverrides)
                ? persistedPolicy.personaOverrides
                : [],
            },
          };
        }

        if (version < 3) {
          migrated = {
            ...migrated,
            requests: normalizePersistedRequests(migrated.requests, {
              missingPolicy: 'standard',
              invalidPolicy: 'one-shot',
            }),
          };
        }

        if (version < 4) {
          migrated = {
            ...migrated,
            allowlist: normalizePersistedAllowlist(migrated.allowlist),
          };
        }

        return migrated;
      },
      partialize: (state) => ({
        ...state,
        allowlist: state.allowlist.filter((entry) => entry.source !== 'internal'),
      }),
      merge: (persistedState, currentState) => {
        if (!isRecord(persistedState)) return currentState;

        return {
          ...currentState,
          requests: Object.prototype.hasOwnProperty.call(persistedState, 'requests')
            ? normalizePersistedRequests(persistedState.requests, {
                missingPolicy: 'one-shot',
                invalidPolicy: 'one-shot',
              })
            : currentState.requests,
          policy: isRecord(persistedState.policy)
            ? (persistedState.policy as unknown as ApprovalPolicy)
            : currentState.policy,
          allowlist: Object.prototype.hasOwnProperty.call(persistedState, 'allowlist')
            ? normalizePersistedAllowlist(persistedState.allowlist)
            : currentState.allowlist,
          analytics: isRecord(persistedState.analytics)
            ? (persistedState.analytics as unknown as ApprovalAnalytics)
            : currentState.analytics,
        };
      },
    },
  ),
);

export function needsApproval(toolName: string): boolean {
  return needsApprovalWithContext(toolName);
}

export function needsApprovalWithContext(
  toolName: string,
  args?: Record<string, unknown>,
  personaId?: string,
): boolean {
  const { policy, allowlist } = useApprovalStore.getState();
  const risk = assessToolRisk(toolName, args);

  if (
    hasMatchingActiveApprovalGrant({
      allowlist,
      toolName,
      args,
      personaId,
      riskLevel: risk.level,
      destructive: risk.destructive,
    })
  ) {
    return false;
  }

  if (personaId) {
    const override = policy.personaOverrides.find((entry) => entry.personaId === personaId);
    if (override) {
      if (override.requireApproval) return true;
      if (override.autoApproveTools?.includes(toolName)) return false;
      if (override.alwaysApproveTools?.includes(toolName)) return true;
    }
  }

  const sensitiveAction = requiresActionApproval(toolName, args);
  if (!policy.requireApproval) {
    return sensitiveAction || policy.alwaysApproveTools.includes(toolName);
  }
  if (policy.autoApproveTools.includes(toolName) && !sensitiveAction) return false;
  return true;
}

function isBoundedReviewPresentation(
  value: Readonly<{ title: string; description: string }>,
): boolean {
  const fields = [
    [value.title, 120],
    [value.description, 500],
  ] as const;
  return fields.every(
    ([field, maximumLength]) =>
      field === field.normalize('NFC').trim() &&
      field.length > 0 &&
      Array.from(field).length <= maximumLength &&
      !/\p{C}/u.test(field),
  );
}

export function requestToolApproval(params: {
  toolName: string;
  targetId?: string;
  jobId?: string;
  title?: string;
  scope?: ApprovalScope;
  description: string;
  /** Bounded code-owned copy for a host-reviewed action; never provider-authored text. */
  reviewPresentation?: Readonly<{ title: string; description: string }>;
  args?: Record<string, unknown>;
  personaId?: string;
  decisionPolicy?: RemoteApprovalDecisionPolicy;
}): Promise<'approved' | 'rejected' | 'expired'> {
  if (params.reviewPresentation && !isBoundedReviewPresentation(params.reviewPresentation)) {
    throw new Error('approval_review_presentation_invalid');
  }
  const store = useApprovalStore.getState();
  const timeoutMs = store.policy.timeoutMs;
  const expiryFallback = store.policy.expiryFallback;
  const risk = assessToolRisk(params.toolName, params.args);
  const presentation = describeToolInvocation(params.toolName, params.args);
  const resolvedPresentation = params.reviewPresentation ?? presentation;
  const scope = params.scope || getApprovalScope(params.toolName);
  const decisionPolicy =
    params.decisionPolicy === undefined
      ? { ...STANDARD_APPROVAL_DECISION_POLICY }
      : normalizeDecisionPolicy(params.decisionPolicy, 'one-shot');
  const grantCandidate = isStandardDecisionPolicy(decisionPolicy)
    ? buildApprovalGrantCandidate({
        toolName: params.toolName,
        args: params.args,
        targetId: params.targetId,
        personaId: params.personaId,
        riskLevel: risk.level,
        destructive: risk.destructive,
      })
    : undefined;

  const requestId = store.createRequest({
    targetId: params.targetId ?? grantCandidate?.targetId,
    toolName: params.toolName,
    scope,
    jobId: params.jobId,
    title: params.title || resolvedPresentation.title,
    description: resolvedPresentation.description,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    decisionPolicy,
    grantCandidate,
  });

  return new Promise((resolve) => {
    const finish = (status: 'approved' | 'rejected' | 'expired') => {
      clearInterval(interval);
      clearTimeout(expiryTimer);
      resolve(status);
    };

    const check = () => {
      const request = useApprovalStore.getState().getRequest(requestId);
      if (!request || request.status === 'pending') return;
      finish(request.status as 'approved' | 'rejected' | 'expired');
    };

    const interval = setInterval(check, 250);
    unrefTimerIfSupported(interval);
    const expiryTimer = setTimeout(() => {
      const request = useApprovalStore.getState().getRequest(requestId);
      if (request?.status === 'pending') {
        if (isStandardDecisionPolicy(request.decisionPolicy) && expiryFallback === 'approve') {
          useApprovalStore.getState().approveRequest(requestId);
        } else {
          useApprovalStore.getState().expireRequest(requestId);
        }
      }
    }, timeoutMs);
    unrefTimerIfSupported(expiryTimer);

    check();
  });
}
