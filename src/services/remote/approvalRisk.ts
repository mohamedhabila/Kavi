import { parse as shellParse } from 'shell-quote';

import type { RemoteApprovalRequest } from '../../types/remote';
import { extractPackageSpecUrl } from '../python/requestNormalization';

export type ApprovalScope = NonNullable<RemoteApprovalRequest['scope']>;

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CommandRiskAssessment {
  level: RiskLevel;
  reasons: string[];
  /** Parsed executable name from the first command token. */
  executable: string;
  /** Whether destructive flags, operators, or targets were detected. */
  destructive: boolean;
}

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
  /^>>$/,
  /^\|$/,
];

const SENSITIVE_PATH_PATTERNS = [
  /^\/$/,
  /^\/etc\b/,
  /^\/boot\b/,
  /^\/sys\b/,
  /^\/proc\b/,
  /^\/dev\b/,
  /^~\/?$/,
  /^\$HOME\/?$/,
];

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

  const stringTokens = tokens.filter((t): t is string => typeof t === 'string');
  const executable = stringTokens[0] || '';

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

  const opTokens = tokens.filter(
    (t): t is { op: string } => typeof t !== 'string' && !!t && typeof t === 'object' && 'op' in t,
  );
  if (opTokens.length > 0 && level === 'low') {
    level = 'medium';
    reasons.push('Command contains operators/pipes');
  }

  return { level, reasons, executable, destructive };
}

export function getApprovalScope(toolName: string): ApprovalScope {
  if (toolName.startsWith('ssh_')) return 'ssh';
  if (toolName.startsWith('workspace_')) return 'workspace';
  if (toolName.startsWith('browser_')) return 'browser';
  if (toolName.startsWith('expo_eas_')) return 'expo';
  if (
    toolName.startsWith('calendar_') ||
    toolName === 'mobile_ui_action' ||
    toolName.startsWith('contacts_') ||
    toolName.startsWith('location_') ||
    toolName.startsWith('clipboard_') ||
    toolName === 'clipboard' ||
    toolName.startsWith('device_') ||
    toolName.startsWith('photos_') ||
    toolName.startsWith('camera_') ||
    toolName === 'email_compose' ||
    toolName === 'sms_compose' ||
    toolName === 'phone_call' ||
    toolName === 'maps_open' ||
    toolName === 'screen_record' ||
    toolName === 'haptic_feedback' ||
    toolName === 'share' ||
    toolName.startsWith('share_') ||
    toolName === 'open_url' ||
    toolName.startsWith('notification_')
  ) {
    return 'native';
  }
  return 'other';
}

/**
 * Lowest risk level the approval-grant matcher treats as ineligible for a
 * persistent ("always allow") grant — see `REUSABLE_RISK_LEVELS` in
 * approvalGrants.ts and the `riskLevel !== 'high' && riskLevel !== 'critical'`
 * check in approvalStore.ts's grantCandidateMatchesRequest. Assigning this
 * level forces per-call confirmation without escalating all the way to
 * 'critical'.
 */
const PER_CALL_CONFIRMATION_LEVEL: RiskLevel = 'high';

export function assessToolRisk(
  toolName: string,
  args?: Record<string, unknown>,
): CommandRiskAssessment {
  if (toolName === 'ssh_exec' && typeof args?.command === 'string') {
    return analyzeCommandRisk(args.command);
  }

  if (toolName === 'mobile_ui_action') {
    return {
      level: 'high',
      reasons: ['Host-reviewed external mobile action'],
      executable: '',
      destructive: false,
    };
  }

  if (toolName === 'javascript') {
    return {
      level: PER_CALL_CONFIRMATION_LEVEL,
      reasons: ['Runs model-written code in the app runtime'],
      executable: '',
      destructive: false,
    };
  }

  if (toolName === 'python') {
    const indexUrls = Array.isArray(args?.indexUrls) ? args.indexUrls : [];
    const packages = Array.isArray(args?.packages) ? args.packages : [];
    const urlShapedPackage = packages.find(
      (entry): entry is string =>
        typeof entry === 'string' && extractPackageSpecUrl(entry) !== undefined,
    );

    if (args?.allowNetwork === true) {
      return {
        level: PER_CALL_CONFIRMATION_LEVEL,
        reasons: ['Network access requested via allowNetwork'],
        executable: '',
        destructive: false,
      };
    }
    if (indexUrls.some((entry) => typeof entry === 'string' && entry.length > 0)) {
      return {
        level: PER_CALL_CONFIRMATION_LEVEL,
        reasons: ['Custom package index requested via indexUrls'],
        executable: '',
        destructive: false,
      };
    }
    if (urlShapedPackage) {
      return {
        level: PER_CALL_CONFIRMATION_LEVEL,
        reasons: [`URL-shaped package spec requested: ${urlShapedPackage}`],
        executable: '',
        destructive: false,
      };
    }
  }

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
