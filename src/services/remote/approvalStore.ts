// ---------------------------------------------------------------------------
// Kavi — Remote Approval Store (Zustand)
// ---------------------------------------------------------------------------
// Central store for approval workflows. Manages pending, approved, rejected,
// and expired approval requests. Feeds approved actions back into tool executors.
// Features: command-level risk analysis, allow-always decisions, persistent
// allowlists, per-persona policy overrides, approval analytics.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parse as shellParse } from 'shell-quote';
import { generateId } from '../../utils/id';
import { describeToolInvocation } from '../security/toolPrivacy';
import type { RemoteApprovalRequest } from '../../types';
import { unrefTimerIfSupported } from '../../utils/timers';

type ApprovalScope = NonNullable<RemoteApprovalRequest['scope']>;

// ── Risk analysis ────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CommandRiskAssessment {
  level: RiskLevel;
  reasons: string[];
  /** The parsed executable name (first token) */
  executable: string;
  /** Whether any destructive flags/patterns were detected */
  destructive: boolean;
}

/**
 * Dangerous executables that carry inherent risk, grouped by severity.
 */
const CRITICAL_EXECUTABLES = new Set([
  'rm',
  'rmdir',
  'mkfs',
  'dd',
  'fdisk',
  'parted',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
]);

const HIGH_RISK_EXECUTABLES = new Set([
  'sudo',
  'su',
  'chmod',
  'chown',
  'chgrp',
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'iptables',
  'ip6tables',
  'nft',
  'ufw',
  'systemctl',
  'service',
  'launchctl',
  'kill',
  'killall',
  'pkill',
  'mount',
  'umount',
  'docker',
  'podman',
  'npm',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'gem',
  'cargo',
]);

const MEDIUM_RISK_EXECUTABLES = new Set([
  'mv',
  'cp',
  'ln',
  'install',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'gunzip',
  'curl',
  'wget',
  'scp',
  'rsync',
  'ssh',
  'git',
  'svn',
  'hg',
  'sed',
  'awk',
  'perl',
  'python',
  'python3',
  'node',
  'ruby',
  'bash',
  'sh',
  'zsh',
  'crontab',
  'at',
  'psql',
  'mysql',
  'sqlite3',
  'mongosh',
]);

/**
 * Destructive flag/argument patterns that elevate risk.
 */
const DESTRUCTIVE_PATTERNS = [
  /^-rf$/i,
  /^-fr$/i,
  /^--force$/i,
  /^--no-preserve-root$/i,
  /^--delete$/i,
  /^--remove$/i,
  /^--purge$/i,
  /^--hard$/i,
  /^>$/,
  /^>>$/, // redirections (shell-quote returns these as operators)
  /^\|$/, // pipes can chain dangerous commands
];

const SENSITIVE_PATH_PATTERNS = [
  /^\/$/, // root
  /^\/etc\b/, // system config
  /^\/boot\b/, // bootloader
  /^\/sys\b/, // kernel interface
  /^\/proc\b/, // process info
  /^\/dev\b/, // devices
  /^~\/?$/, // home directory root
  /^\$HOME\/?$/,
];

/**
 * Analyze a shell command string for risk.
 * Uses shell-quote for safe parsing (no eval).
 */
export function analyzeCommandRisk(command: string): CommandRiskAssessment {
  const reasons: string[] = [];
  let level: RiskLevel = 'low';
  let destructive = false;

  let tokens: ReturnType<typeof shellParse>;
  try {
    tokens = shellParse(command);
  } catch {
    return { level: 'high', reasons: ['Unparseable command'], executable: '', destructive: true };
  }

  // Extract the executable (first string token)
  const stringTokens = tokens.filter((t): t is string => typeof t === 'string');
  const executable = stringTokens[0] || '';

  // Check executable risk
  if (CRITICAL_EXECUTABLES.has(executable)) {
    level = 'critical';
    reasons.push(`Critical executable: ${executable}`);
    destructive = true;
  } else if (HIGH_RISK_EXECUTABLES.has(executable)) {
    level = 'high';
    reasons.push(`High-risk executable: ${executable}`);
  } else if (MEDIUM_RISK_EXECUTABLES.has(executable)) {
    level = level === 'low' ? 'medium' : level;
    reasons.push(`Medium-risk executable: ${executable}`);
  }

  // Check for destructive flags
  for (const token of tokens) {
    const str =
      typeof token === 'string'
        ? token
        : token && typeof token === 'object' && 'op' in token
          ? String(token.op)
          : '';
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(str)) {
        destructive = true;
        if (level === 'low') level = 'medium';
        if (level === 'medium' && CRITICAL_EXECUTABLES.has(executable)) level = 'critical';
        reasons.push(`Destructive flag/operator: ${str}`);
        break;
      }
    }
  }

  // Check for sensitive paths
  for (const token of stringTokens) {
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(token)) {
        if (level === 'low') level = 'medium';
        if (executable === 'rm' || executable === 'chmod') level = 'critical';
        reasons.push(`Sensitive path: ${token}`);
        break;
      }
    }
  }

  // Elevate if chained with pipes/operators to a dangerous command
  const opTokens = tokens.filter(
    (t): t is { op: string } => typeof t !== 'string' && !!t && typeof t === 'object' && 'op' in t,
  );
  if (opTokens.length > 0 && level === 'low') {
    level = 'medium';
    reasons.push('Command contains operators/pipes');
  }

  return { level, reasons, executable, destructive };
}

// ── Types ────────────────────────────────────────────────────────────────

/** A single entry in the persistent "always allow" list */
export interface AllowlistEntry {
  /** Tool name or `ssh_exec:<executable>` for command-level granularity */
  key: string;
  addedAt: number;
  /** Optional persona that scoped this entry */
  personaId?: string;
}

/** Per-persona policy overrides */
export interface PersonaPolicyOverride {
  personaId: string;
  /** Additional tools that always require approval for this persona */
  alwaysApproveTools?: string[];
  /** Additional auto-approve tools for this persona */
  autoApproveTools?: string[];
  /** Whether to require approval for all tools */
  requireApproval?: boolean;
}

/** Analytics counters */
export interface ApprovalAnalytics {
  totalRequests: number;
  totalApproved: number;
  totalRejected: number;
  totalExpired: number;
  totalAllowAlways: number;
  averageDecisionMs: number;
  /** Counts by tool name */
  byTool: Record<string, { approved: number; rejected: number; expired: number }>;
}

export interface ApprovalPolicy {
  /** If true, all remote tool calls require approval */
  requireApproval: boolean;
  /** Tool names that always require approval regardless of policy */
  alwaysApproveTools: string[];
  /** Tool names that never require approval (auto-approved) */
  autoApproveTools: string[];
  /** Approval timeout in ms (default: 5 minutes) */
  timeoutMs: number;
  /** Fallback decision when approval times out: 'reject' (default) or 'approve' */
  expiryFallback: 'reject' | 'approve';
  /** Per-persona overrides */
  personaOverrides: PersonaPolicyOverride[];
}

interface ApprovalStoreState {
  requests: Record<string, RemoteApprovalRequest>;
  policy: ApprovalPolicy;
  allowlist: AllowlistEntry[];
  analytics: ApprovalAnalytics;

  // Request lifecycle
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

  // Policy management
  setPolicy: (patch: Partial<ApprovalPolicy>) => void;
  addPersonaOverride: (override: PersonaPolicyOverride) => void;
  removePersonaOverride: (personaId: string) => void;

  // Allowlist management
  addToAllowlist: (key: string, personaId?: string) => void;
  removeFromAllowlist: (key: string) => void;
  isAllowlisted: (key: string, personaId?: string) => boolean;

  // Queries
  getPendingRequests: () => RemoteApprovalRequest[];
  getRequest: (id: string) => RemoteApprovalRequest | undefined;
  getAnalytics: () => ApprovalAnalytics;

  // Expiry sweep
  sweepExpired: () => number;
}

const DEFAULT_POLICY: ApprovalPolicy = {
  requireApproval: false,
  alwaysApproveTools: [
    'ssh_exec',
    'ssh_write_file',
    'ssh_rename_path',
    'ssh_delete_path',
    'ssh_make_directory',
    'workspace_write_file',
    'workspace_rename',
    'workspace_delete',
    'workspace_mkdir',
    'workspace_launch_browser',
    'workspace_delegate_task',
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_press_key',
    'browser_hover',
    'browser_select',
    'browser_drag',
    'browser_evaluate',
    'browser_upload',
    'browser_download',
    'browser_fill_form',
    'browser_dialog',
    'expo_eas_build',
    'expo_eas_update',
    'expo_eas_submit',
    'expo_eas_deploy_web',
    'calendar_create_event',
    'email_compose',
    'sms_compose',
    'phone_call',
    'contacts_pick',
    'contacts_manage_access',
    'contacts_view',
    'contacts_edit',
    'contacts_create',
    'contacts_share',
    'contacts_search_full',
    'contacts_get_full',
    'contacts_search',
    'contacts_get',
    'share_text',
    'share_url',
    'share_file',
    'share_contact',
    'clipboard_write',
    'share',
  ],
  autoApproveTools: [
    'web_search',
    'web_fetch',
    'read_file',
    'list_files',
    'ssh_list_directory',
    'ssh_read_file',
    'workspace_status',
    'workspace_read_file',
    'workspace_list_files',
    'browser_snapshot',
    'browser_screenshot',
    'browser_console',
    'browser_errors',
    'browser_network',
    'browser_status',
    'browser_pdf',
    'expo_eas_status',
    'expo_eas_probe',
  ],
  timeoutMs: 5 * 60 * 1000,
  expiryFallback: 'reject',
  personaOverrides: [],
};

const DEFAULT_ANALYTICS: ApprovalAnalytics = {
  totalRequests: 0,
  totalApproved: 0,
  totalRejected: 0,
  totalExpired: 0,
  totalAllowAlways: 0,
  averageDecisionMs: 0,
  byTool: {},
};

const MAX_REQUESTS = 200;

function trimRequests(
  requests: Record<string, RemoteApprovalRequest>,
): Record<string, RemoteApprovalRequest> {
  const entries = Object.entries(requests)
    .sort(([, a], [, b]) => b.requestedAt - a.requestedAt)
    .slice(0, MAX_REQUESTS);
  return Object.fromEntries(entries);
}

function getApprovalScope(toolName: string): ApprovalScope {
  if (toolName.startsWith('ssh_')) return 'ssh';
  if (toolName.startsWith('workspace_')) return 'workspace';
  if (toolName.startsWith('browser_')) return 'browser';
  if (toolName.startsWith('expo_eas_')) return 'expo';
  if (
    toolName.startsWith('calendar_') ||
    toolName.startsWith('contacts_') ||
    toolName.startsWith('location_') ||
    toolName.startsWith('clipboard_') ||
    toolName === 'email_compose' ||
    toolName === 'sms_compose' ||
    toolName === 'phone_call' ||
    toolName === 'maps_open' ||
    toolName === 'share' ||
    toolName.startsWith('share_') ||
    toolName === 'open_url' ||
    toolName.startsWith('notification_')
  ) {
    return 'native';
  }
  return 'other';
}

function requiresActionApproval(toolName: string, args?: Record<string, unknown>): boolean {
  if (DEFAULT_POLICY.alwaysApproveTools.includes(toolName)) {
    return true;
  }

  switch (toolName) {
    case 'browser_cookies':
    case 'browser_storage': {
      const action = String(args?.action || 'get').toLowerCase();
      return action !== 'get';
    }
    case 'open_url': {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      const match = url.match(/^([a-z][a-z0-9+.-]*):/i);
      const scheme = match?.[1]?.toLowerCase();
      return scheme !== 'http' && scheme !== 'https';
    }
    default:
      return false;
  }
}

/** Build a compound key for allowlist matching (tool-level or command-level) */
function buildAllowlistKey(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'ssh_exec' && typeof args?.command === 'string') {
    const risk = analyzeCommandRisk(args.command);
    return `ssh_exec:${risk.executable}`;
  }
  return toolName;
}

function recordAnalyticsOutcome(
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
          for (const [k, v] of Object.entries(state.requests)) {
            if (v.status === 'pending') next[k] = v;
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
            (o) => o.personaId !== override.personaId,
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
              (o) => o.personaId !== personaId,
            ),
          },
        })),

      addToAllowlist: (key, personaId) =>
        set((state) => {
          if (state.allowlist.some((e) => e.key === key)) return state;
          return {
            allowlist: [...state.allowlist, { key, addedAt: Date.now(), personaId }],
          };
        }),

      removeFromAllowlist: (key) =>
        set((state) => ({
          allowlist: state.allowlist.filter((e) => e.key !== key),
        })),

      isAllowlisted: (key, personaId) => {
        const { allowlist } = get();
        return allowlist.some(
          (e) => e.key === key && (e.personaId === undefined || e.personaId === personaId),
        );
      },

      getPendingRequests: () =>
        Object.values(get().requests)
          .filter((r) => r.status === 'pending')
          .sort((a, b) => b.requestedAt - a.requestedAt),

      getRequest: (id) => get().requests[id],

      getAnalytics: () => get().analytics,

      sweepExpired: () => {
        const state = get();
        const now = Date.now();
        const timeoutMs = state.policy.timeoutMs;
        let count = 0;
        const nextRequests = { ...state.requests };
        let analytics = { ...state.analytics };

        for (const [id, req] of Object.entries(nextRequests)) {
          if (req.status === 'pending' && now - req.requestedAt > timeoutMs) {
            nextRequests[id] = { ...req, status: 'expired', resolvedAt: now };
            analytics = recordAnalyticsOutcome(analytics, req.toolName || 'unknown', 'expired');
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

// ── Approval gate for tool execution ─────────────────────────────────────

/**
 * Check if a tool call requires approval and optionally wait for it.
 * Returns true if the call is approved (or doesn't need approval).
 * Returns false if rejected or expired.
 */
export function needsApproval(toolName: string): boolean {
  return needsApprovalWithContext(toolName);
}

export function needsApprovalWithContext(
  toolName: string,
  args?: Record<string, unknown>,
  personaId?: string,
): boolean {
  const { policy, allowlist } = useApprovalStore.getState();

  // Check persistent allowlist first (including command-level SSH analysis)
  const allowKey = buildAllowlistKey(toolName, args);
  if (
    allowlist.some(
      (e) => e.key === allowKey && (e.personaId === undefined || e.personaId === personaId),
    )
  ) {
    return false;
  }

  // Check per-persona overrides
  if (personaId) {
    const override = policy.personaOverrides.find((o) => o.personaId === personaId);
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

/**
 * Get the risk assessment for a tool call (useful for UI display).
 */
export function assessToolRisk(
  toolName: string,
  args?: Record<string, unknown>,
): CommandRiskAssessment {
  if (toolName === 'ssh_exec' && typeof args?.command === 'string') {
    return analyzeCommandRisk(args.command);
  }
  // Default risk by scope
  const scope = getApprovalScope(toolName);
  const level: RiskLevel =
    scope === 'ssh'
      ? 'medium'
      : scope === 'expo'
        ? 'high'
        : scope === 'native'
          ? 'low'
          : scope === 'browser'
            ? 'low'
            : 'low';
  return { level, reasons: [], executable: '', destructive: false };
}

/**
 * Request approval for a tool call and wait for the decision.
 * Returns the resolved status.
 */
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

  // Risk assessment for ssh_exec commands
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
      const req = useApprovalStore.getState().getRequest(requestId);
      if (!req || req.status === 'pending') return;
      finish(req.status as 'approved' | 'rejected' | 'expired');
    };

    const interval = setInterval(check, 250);
    unrefTimerIfSupported(interval);
    const expiryTimer = setTimeout(() => {
      const req = useApprovalStore.getState().getRequest(requestId);
      if (req?.status === 'pending') {
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
