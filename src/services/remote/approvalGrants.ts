import type {
  RemoteApprovalGrantCandidate,
  RemoteApprovalGrantTargetKind,
} from '../../types/remote';
import {
  analyzeCommandRisk,
  getApprovalScope,
  type ApprovalScope,
  type RiskLevel,
} from './approvalRisk';
import { buildAllowlistKey } from './approvalPolicy';

export type ApprovalGrantStatus = 'active' | 'review-required';
export type ApprovalGrantSource = 'user' | 'internal' | 'legacy';

export interface AllowlistEntry extends RemoteApprovalGrantCandidate {
  addedAt: number;
  status: ApprovalGrantStatus;
  source: ApprovalGrantSource;
  sourceRequestId?: string;
  /** Original pre-v4 key retained only so the user can identify and revoke it. */
  legacyKey?: string;
}

const CATEGORICAL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,159}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,127}$/u;
const REUSABLE_RISK_LEVELS = new Set<RiskLevel>(['low', 'medium']);
const REUSABLE_SSH_EXECUTABLES = new Set([
  'cat',
  'df',
  'du',
  'grep',
  'head',
  'id',
  'ls',
  'pwd',
  'stat',
  'tail',
  'uname',
  'uniq',
  'uptime',
  'wc',
  'whoami',
]);
const APPROVAL_SCOPES = new Set<ApprovalScope>([
  'ssh',
  'workspace',
  'browser',
  'expo',
  'native',
  'other',
]);
const GRANT_TARGET_KINDS = new Set<RemoteApprovalGrantTargetKind>([
  'local-device',
  'ssh-host',
  'workspace',
  'browser-provider',
  'expo-project',
  'mcp-tool',
  'tool',
]);
const NON_REUSABLE_TOOL_NAMES = new Set([
  'browser_click',
  'browser_dialog',
  'browser_drag',
  'browser_evaluate',
  'browser_fill_form',
  'browser_press_key',
  'browser_select',
  'browser_type',
  'browser_upload',
  'calendar_create_event',
  'calendar_update_event',
  'camera_clip',
  'clipboard',
  'clipboard_write',
  'contacts_create',
  'contacts_edit',
  'contacts_form',
  'contacts_manage_access',
  'contacts_share',
  'device_permissions',
  'email_compose',
  'memory_forget',
  'mobile_ui_action',
  'open_url',
  'phone_call',
  'photos_pick',
  'screen_record',
  'share',
  'share_contact',
  'share_file',
  'share_text',
  'share_url',
  'sms_compose',
  'ssh_delete_path',
  'ssh_rename_path',
  'ssh_write_file',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategoricalToken(value: unknown): value is string {
  return typeof value === 'string' && CATEGORICAL_TOKEN_PATTERN.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

function targetKindForScope(scope: ApprovalScope, toolName: string): RemoteApprovalGrantTargetKind {
  switch (scope) {
    case 'ssh':
      return 'ssh-host';
    case 'workspace':
      return 'workspace';
    case 'browser':
      return 'browser-provider';
    case 'expo':
      return 'expo-project';
    case 'native':
      return 'local-device';
    case 'other':
      return toolName.startsWith('mcp__') ? 'mcp-tool' : 'tool';
  }
}

function resolveTargetId(
  scope: ApprovalScope,
  explicitTargetId: string | undefined,
  args: Record<string, unknown> | undefined,
): string | undefined {
  const candidates: unknown[] = [explicitTargetId, args?.targetId];
  if (scope === 'workspace') candidates.push(args?.workspaceId);
  if (scope === 'browser') candidates.push(args?.providerId, args?.browserProviderId);
  if (scope === 'expo') candidates.push(args?.projectId);

  return candidates.find(isOpaqueId);
}

function resolveActionClass(
  toolName: string,
  args: Record<string, unknown> | undefined,
  riskLevel: RiskLevel,
  destructive: boolean,
): string | undefined {
  if (toolName === 'ssh_exec') {
    if (typeof args?.command !== 'string') return undefined;
    const commandRisk = analyzeCommandRisk(args.command);
    if (
      destructive ||
      commandRisk.destructive ||
      riskLevel !== 'low' ||
      commandRisk.level !== 'low' ||
      !isCategoricalToken(commandRisk.executable) ||
      !REUSABLE_SSH_EXECUTABLES.has(commandRisk.executable)
    ) {
      return undefined;
    }
    return commandRisk.executable;
  }

  if (toolName === 'browser_cookies' || toolName === 'browser_storage') {
    const action = typeof args?.action === 'string' ? args.action.toLowerCase() : 'get';
    return isCategoricalToken(action) ? action : undefined;
  }

  return toolName;
}

export function buildApprovalGrantKey(
  candidate: Omit<RemoteApprovalGrantCandidate, 'key' | 'version'>,
): string {
  return [
    'v1',
    candidate.scope,
    candidate.toolName,
    candidate.actionClass,
    candidate.targetKind,
    candidate.targetId || '',
    candidate.personaId || '',
  ]
    .map((part) => encodeURIComponent(part))
    .join('|');
}

export function buildApprovalGrantCandidate(params: {
  toolName: string;
  args?: Record<string, unknown>;
  targetId?: string;
  personaId?: string;
  riskLevel: RiskLevel;
  destructive: boolean;
}): RemoteApprovalGrantCandidate | undefined {
  if (
    !isCategoricalToken(params.toolName) ||
    NON_REUSABLE_TOOL_NAMES.has(params.toolName) ||
    !REUSABLE_RISK_LEVELS.has(params.riskLevel) ||
    params.destructive ||
    (params.personaId !== undefined && !isOpaqueId(params.personaId))
  ) {
    return undefined;
  }

  const scope = getApprovalScope(params.toolName);
  const targetKind = targetKindForScope(scope, params.toolName);
  const targetId = resolveTargetId(scope, params.targetId, params.args);
  if (scope === 'ssh' || scope === 'workspace' || scope === 'browser' || scope === 'expo') {
    if (!targetId) return undefined;
  }

  const actionClass = resolveActionClass(
    params.toolName,
    params.args,
    params.riskLevel,
    params.destructive,
  );
  if (!actionClass) return undefined;

  const fields = {
    toolName: params.toolName,
    scope,
    actionClass,
    targetKind,
    ...(targetId ? { targetId } : {}),
    ...(params.personaId ? { personaId: params.personaId } : {}),
  } as const;

  return { version: 1, key: buildApprovalGrantKey(fields), ...fields };
}

export function isApprovalGrantCandidate(value: unknown): value is RemoteApprovalGrantCandidate {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    !isCategoricalToken(value.toolName) ||
    NON_REUSABLE_TOOL_NAMES.has(value.toolName) ||
    !isCategoricalToken(value.actionClass) ||
    !APPROVAL_SCOPES.has(value.scope as ApprovalScope) ||
    !GRANT_TARGET_KINDS.has(value.targetKind as RemoteApprovalGrantTargetKind) ||
    (value.targetId !== undefined && !isOpaqueId(value.targetId)) ||
    (value.personaId !== undefined && !isOpaqueId(value.personaId))
  ) {
    return false;
  }

  const scope = value.scope as ApprovalScope;
  const expectedTargetKind = targetKindForScope(scope, value.toolName);
  const remoteTargetRequired =
    scope === 'ssh' || scope === 'workspace' || scope === 'browser' || scope === 'expo';
  const isArgumentScopedAction =
    value.toolName === 'browser_cookies' || value.toolName === 'browser_storage';
  if (value.toolName === 'ssh_exec') {
    const actionRisk = analyzeCommandRisk(value.actionClass);
    if (
      actionRisk.destructive ||
      actionRisk.level !== 'low' ||
      !REUSABLE_SSH_EXECUTABLES.has(value.actionClass)
    ) {
      return false;
    }
  } else if (!isArgumentScopedAction && value.actionClass !== value.toolName) {
    return false;
  }
  if (
    scope !== getApprovalScope(value.toolName) ||
    value.targetKind !== expectedTargetKind ||
    (remoteTargetRequired && value.targetId === undefined) ||
    (!remoteTargetRequired && value.targetId !== undefined)
  ) {
    return false;
  }

  const expectedKey = buildApprovalGrantKey(
    value as unknown as Omit<RemoteApprovalGrantCandidate, 'key' | 'version'>,
  );
  return value.key === expectedKey;
}

export function createUserApprovalGrant(
  candidate: RemoteApprovalGrantCandidate,
  addedAt: number,
  sourceRequestId: string,
): AllowlistEntry | undefined {
  if (!isApprovalGrantCandidate(candidate)) return undefined;
  return {
    ...candidate,
    addedAt,
    status: 'active',
    source: 'user',
    sourceRequestId,
  };
}

export function createInternalAllowlistEntry(
  key: string,
  personaId: string | undefined,
  addedAt: number,
): AllowlistEntry | undefined {
  if (!isCategoricalToken(key) || (personaId !== undefined && !isOpaqueId(personaId))) {
    return undefined;
  }

  const executablePrefix = 'ssh_exec:';
  const toolName = key.startsWith(executablePrefix) ? 'ssh_exec' : key;
  const actionClass = key.startsWith(executablePrefix) ? key.slice(executablePrefix.length) : '*';
  if (actionClass !== '*' && !isCategoricalToken(actionClass)) return undefined;

  return {
    version: 1,
    key,
    toolName,
    scope: getApprovalScope(toolName),
    actionClass,
    targetKind: 'tool',
    ...(personaId ? { personaId } : {}),
    addedAt,
    status: 'active',
    source: 'internal',
  };
}

function personaMatches(entry: AllowlistEntry, personaId: string | undefined): boolean {
  return entry.personaId === undefined || entry.personaId === personaId;
}

export function hasMatchingActiveApprovalGrant(params: {
  allowlist: readonly AllowlistEntry[];
  toolName: string;
  args?: Record<string, unknown>;
  personaId?: string;
  riskLevel: RiskLevel;
  destructive: boolean;
}): boolean {
  const candidate = buildApprovalGrantCandidate(params);
  const administrativeKey = buildAllowlistKey(params.toolName, params.args);

  return params.allowlist.some((entry) => {
    if (entry.status !== 'active' || !personaMatches(entry, params.personaId)) return false;
    if (entry.source === 'internal') {
      return entry.key === params.toolName || entry.key === administrativeKey;
    }
    return entry.source === 'user' && candidate !== undefined && entry.key === candidate.key;
  });
}

function legacyReviewEntry(value: Record<string, unknown>): AllowlistEntry | undefined {
  const personaId = isOpaqueId(value.personaId) ? value.personaId : undefined;
  const addedAt =
    typeof value.addedAt === 'number' && Number.isFinite(value.addedAt) && value.addedAt >= 0
      ? value.addedAt
      : 0;
  const legacyKey = isCategoricalToken(value.legacyKey)
    ? value.legacyKey
    : isCategoricalToken(value.key)
      ? value.key
      : undefined;
  if (!legacyKey) return undefined;
  const toolName = legacyKey.startsWith('ssh_exec:') ? 'ssh_exec' : legacyKey;
  if (!isCategoricalToken(toolName)) return undefined;

  const reviewKey = `legacy-review|${encodeURIComponent(legacyKey)}|${encodeURIComponent(personaId || '')}`;
  return {
    version: 1,
    key: reviewKey,
    toolName,
    scope: getApprovalScope(toolName),
    actionClass: 'legacy',
    targetKind: 'tool',
    ...(personaId ? { personaId } : {}),
    addedAt,
    status: 'review-required',
    source: 'legacy',
    legacyKey,
  };
}

export function normalizePersistedAllowlist(value: unknown): AllowlistEntry[] {
  if (!Array.isArray(value)) return [];

  const normalized: AllowlistEntry[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) continue;

    let entry: AllowlistEntry | undefined;
    if (
      rawEntry.status === 'active' &&
      rawEntry.source === 'user' &&
      isApprovalGrantCandidate(rawEntry) &&
      typeof rawEntry.addedAt === 'number' &&
      Number.isFinite(rawEntry.addedAt) &&
      rawEntry.addedAt >= 0
    ) {
      entry = {
        version: 1,
        key: rawEntry.key,
        toolName: rawEntry.toolName,
        scope: rawEntry.scope,
        actionClass: rawEntry.actionClass,
        targetKind: rawEntry.targetKind,
        ...(rawEntry.targetId ? { targetId: rawEntry.targetId } : {}),
        ...(rawEntry.personaId ? { personaId: rawEntry.personaId } : {}),
        addedAt: rawEntry.addedAt,
        status: 'active',
        source: 'user',
        ...(isOpaqueId(rawEntry.sourceRequestId)
          ? { sourceRequestId: rawEntry.sourceRequestId }
          : {}),
      };
    } else {
      entry = legacyReviewEntry(rawEntry);
    }

    if (!entry) continue;
    const identity = `${entry.key}|${entry.personaId || ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push(entry);
  }
  return normalized;
}
