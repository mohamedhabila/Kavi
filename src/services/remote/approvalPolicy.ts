import { analyzeCommandRisk } from './approvalRisk';

export interface AllowlistEntry {
  /** Tool name or `ssh_exec:<executable>` for command-level granularity. */
  key: string;
  addedAt: number;
  /** Optional persona that scoped this entry. */
  personaId?: string;
}

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
  /** Tool names that always require approval regardless of policy. */
  alwaysApproveTools: string[];
  /** Tool names that never require approval. */
  autoApproveTools: string[];
  /** Approval timeout in milliseconds. */
  timeoutMs: number;
  /** Fallback decision when approval times out. */
  expiryFallback: 'reject' | 'approve';
  /** Per-persona overrides. */
  personaOverrides: PersonaPolicyOverride[];
}

export const DEFAULT_POLICY: ApprovalPolicy = {
  requireApproval: false,
  alwaysApproveTools: [
    'ssh_exec',
    'ssh_write_file',
    'ssh_rename_path',
    'ssh_delete_path',
    'ssh_make_directory',
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
    'calendar_list',
    'calendar_events',
    'calendar_create_event',
    'calendar_update_event',
    'email_compose',
    'sms_compose',
    'phone_call',
    'maps_open',
    'contacts_pick',
    'contacts_manage_access',
    'contacts_view',
    'contacts_edit',
    'contacts_create',
    'contacts_form',
    'contacts_share',
    'contacts_search_full',
    'contacts_get_full',
    'contacts_search',
    'contacts_get',
    'location_current',
    'clipboard_read',
    'share_text',
    'share_url',
    'share_file',
    'share_contact',
    'clipboard_write',
    'clipboard',
    'share',
    'notification_send',
    'notification_schedule',
    'notification_cancel',
    'device_permissions',
    'photos_latest',
    'camera_clip',
    'screen_record',
    'haptic_feedback',
  ],
  autoApproveTools: [
    'web_search',
    'web_fetch',
    'read_file',
    'list_files',
    'ssh_list_directory',
    'ssh_read_file',
    'workspace_status',
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

export function requiresActionApproval(
  toolName: string,
  args?: Record<string, unknown>,
): boolean {
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

export function buildAllowlistKey(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'ssh_exec' && typeof args?.command === 'string') {
    const risk = analyzeCommandRisk(args.command);
    return `ssh_exec:${risk.executable}`;
  }
  return toolName;
}
