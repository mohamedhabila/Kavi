import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { analyzeCommandRisk } from './approvalRisk';

export interface PersonaPolicyOverride {
  personaId: string;
  /** Additional tools that always require approval for this persona. */
  alwaysApproveTools?: string[];
  /** Additional auto-approve tools for this persona. */
  autoApproveTools?: string[];
  /** Whether to require approval for all tools. */
  requireApproval?: boolean;
}

export interface ApprovalPolicy {
  /** If true, all remote tool calls require approval. */
  requireApproval: boolean;
  /** Tool names "review every tool request" still lets through without asking. */
  autoApproveTools: string[];
  /** Approval timeout in milliseconds. A request still pending then expires; it is never approved. */
  timeoutMs: number;
  /** Per-persona overrides. */
  personaOverrides: PersonaPolicyOverride[];
}

export const DEFAULT_POLICY: ApprovalPolicy = {
  requireApproval: false,
  autoApproveTools: [
    'web_search',
    'web_fetch',
    'read_file',
    'list_files',
    'ssh_fs',
    'workspace_status',
    'browser_snapshot',
    'browser_screenshot',
    'browser_inspect',
    'browser_status',
    'browser_pdf',
    'expo_eas_status',
    'expo_eas_probe',
  ],
  timeoutMs: 5 * 60 * 1000,
  personaOverrides: [],
};

let approvalRequiredToolNames: ReadonlySet<string> | undefined;

/** A built-in tool needs approval when its contract says so. */
function contractRequiresApproval(toolName: string): boolean {
  approvalRequiredToolNames ??= new Set(
    TOOL_DEFINITIONS.filter((tool) => tool.contract?.riskHints?.includes('requires_approval')).map(
      (tool) => tool.name,
    ),
  );
  return approvalRequiredToolNames.has(toolName);
}

/**
 * Whether a call is sensitive enough to ask the user first. The tool's contract decides
 * (`riskHints: ['requires_approval']`); the cases below depend on the call's arguments.
 */
export function requiresActionApproval(toolName: string, args?: Record<string, unknown>): boolean {
  if (toolName.startsWith('mcp__')) {
    return true;
  }

  switch (toolName) {
    case 'ssh_fs': {
      // Listing and reading a remote host are read-only; every other action changes it.
      const action = String(args?.action || '').toLowerCase();
      return action !== 'list' && action !== 'read';
    }
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
    case 'reminder':
      // Never gate any reminder action (create/list/update/cancel) behind approval.
      // A reminder is user-requested, fully reversible (cancel/update at any time),
      // and always visible via the tool's own list action — unlike a cron job it
      // never resumes a conversation or reaches outside the device. This is a
      // deliberate exemption, not the absence of one: without this explicit case,
      // a later generic rule (e.g. gating every 'write'-capability native tool)
      // could silently start requiring approval for reminders again.
      return false;
    default:
      return contractRequiresApproval(toolName);
  }
}

/** Stable administrative key format; persisted user grants use versioned exact keys. */
export function buildAllowlistKey(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'ssh_exec' && typeof args?.command === 'string') {
    return `ssh_exec:${analyzeCommandRisk(args.command).executable}`;
  }
  return toolName;
}
