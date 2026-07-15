// Central state for remote approval workflows.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  RemoteApprovalDecisionPolicy,
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
  buildAllowlistKey,
  DEFAULT_POLICY,
  requiresActionApproval,
  type AllowlistEntry,
  type ApprovalPolicy,
  type PersonaPolicyOverride,
} from './approvalPolicy';
import {
  assessToolRisk,
  getApprovalScope,
  type ApprovalScope,
  type RiskLevel,
} from './approvalRisk';

export { analyzeCommandRisk, assessToolRisk } from './approvalRisk';
export type { ApprovalScope, CommandRiskAssessment, RiskLevel } from './approvalRisk';
export type { ApprovalAnalytics } from './approvalAnalytics';
export type { AllowlistEntry, ApprovalPolicy, PersonaPolicyOverride } from './approvalPolicy';

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
    isRecord(value) &&
    value.persistentApproval === 'forbidden' &&
    value.expiryFallback === 'reject'
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
    requests[id] = {
      ...(rawRequest as unknown as RemoteApprovalRequest),
      decisionPolicy: normalizeDecisionPolicy(
        rawRequest.decisionPolicy,
        rawRequest.decisionPolicy === undefined
          ? fallbacks.missingPolicy
          : fallbacks.invalidPolicy,
      ),
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
          decisionPolicy:
            params.decisionPolicy === undefined
              ? { ...STANDARD_APPROVAL_DECISION_POLICY }
              : normalizeDecisionPolicy(params.decisionPolicy, 'one-shot'),
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
          if (
            !req ||
            req.status !== 'pending' ||
            !isStandardDecisionPolicy(req.decisionPolicy)
          ) {
            return state;
          }
          const now = Date.now();
          const key = req.toolName || 'unknown';
          const entry: AllowlistEntry = { key, addedAt: now };
          const newAllowlist = state.allowlist.some((e) => e.key === key)
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
              key,
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
          if (state.allowlist.some((entry) => entry.key === key)) return state;
          return {
            allowlist: [...state.allowlist, { key, addedAt: Date.now(), personaId }],
          };
        }),

      removeFromAllowlist: (key) =>
        set((state) => ({
          allowlist: state.allowlist.filter((entry) => entry.key !== key),
        })),

      isAllowlisted: (key, personaId) => {
        const { allowlist } = get();
        return allowlist.some(
          (entry) =>
            entry.key === key && (entry.personaId === undefined || entry.personaId === personaId),
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
            analytics = recordAnalyticsOutcome(
              analytics,
              request.toolName || 'unknown',
              'expired',
            );
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
      version: 3,
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

        return migrated;
      },
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
          allowlist: Array.isArray(persistedState.allowlist)
            ? (persistedState.allowlist as AllowlistEntry[])
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

  const allowKey = buildAllowlistKey(toolName, args);
  if (
    allowlist.some(
      (entry) =>
        (entry.key === allowKey || entry.key === toolName) &&
        (entry.personaId === undefined || entry.personaId === personaId),
    )
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

export function requestToolApproval(params: {
  toolName: string;
  targetId?: string;
  jobId?: string;
  title?: string;
  scope?: ApprovalScope;
  description: string;
  args?: Record<string, unknown>;
  personaId?: string;
  decisionPolicy?: RemoteApprovalDecisionPolicy;
}): Promise<'approved' | 'rejected' | 'expired'> {
  const store = useApprovalStore.getState();
  const timeoutMs = store.policy.timeoutMs;
  const expiryFallback = store.policy.expiryFallback;
  const risk = assessToolRisk(params.toolName, params.args);
  const presentation = describeToolInvocation(params.toolName, params.args);

  const requestId = store.createRequest({
    targetId: params.targetId,
    toolName: params.toolName,
    scope: params.scope || getApprovalScope(params.toolName),
    jobId: params.jobId,
    title: params.title || presentation.title,
    description: presentation.description,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    decisionPolicy: params.decisionPolicy,
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
