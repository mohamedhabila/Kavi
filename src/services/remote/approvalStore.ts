// Central state for remote approval workflows.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { RemoteApprovalRequest } from '../../types/remote';
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
          if (!req || req.status !== 'pending') return state;
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
      version: 2,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          return {
            ...persisted,
            allowlist: persisted.allowlist || [],
            analytics: persisted.analytics || DEFAULT_ANALYTICS,
            policy: {
              ...DEFAULT_POLICY,
              ...(persisted.policy || {}),
              expiryFallback: persisted.policy?.expiryFallback || 'reject',
              personaOverrides: persisted.policy?.personaOverrides || [],
            },
          };
        }
        return persisted;
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
        entry.key === allowKey && (entry.personaId === undefined || entry.personaId === personaId),
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
        if (expiryFallback === 'approve') {
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
