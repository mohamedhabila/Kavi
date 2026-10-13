import type { ToolDefinition } from '../../types/tool';
import { inferToolCapabilityDescriptor } from './capabilityRegistry';

export interface ToolCategory {
  name: string;
  toolNames: string[];
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'workspace_search',
    toolNames: ['glob_search', 'text_search'],
  },
  {
    name: 'code',
    toolNames: ['javascript', 'python'],
  },
  {
    name: 'web',
    toolNames: ['web_search', 'web_fetch'],
  },
  {
    name: 'browser',
    toolNames: [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_screenshot',
      'browser_snapshot',
      'browser_inspect',
      'browser_cookies',
      'browser_storage',
      'browser_launch',
      'browser_stop',
      'browser_status',
      'browser_evaluate',
    ],
  },
  {
    name: 'canvas',
    toolNames: [
      'canvas_create',
      'canvas_read',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
      'canvas_list',
    ],
  },
  {
    name: 'ssh',
    toolNames: [
      'ssh_exec',
      'ssh_background_job_status',
      'ssh_background_job_wait',
      'ssh_fs',
    ],
  },
  {
    name: 'calendar',
    toolNames: [
      'calendar_list',
      'calendar_events',
      'calendar_create_event',
      'calendar_update_event',
    ],
  },
  {
    name: 'contacts',
    toolNames: [
      'contacts_pick',
      'contacts_manage_access',
      'contacts_form',
      'contacts_share',
      'contacts_search_full',
      'contacts_get_full',
    ],
  },
  {
    name: 'expo',
    toolNames: [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ],
  },
  {
    name: 'expo_manual_actions',
    toolNames: ['expo_eas_build', 'expo_eas_update', 'expo_eas_submit', 'expo_eas_deploy_web'],
  },
  {
    name: 'sessions',
    toolNames: [
      'sessions_spawn',
      'sessions_list',
      'sessions_send',
      'sessions_history',
      'sessions_output',
      'sessions_surface_output',
      'sessions_status',
      'sessions_wait',
      'sessions_cancel',
      'sessions_yield',
    ],
  },
  {
    name: 'agents',
    toolNames: ['agents'],
  },
  {
    name: 'media',
    toolNames: [
      'camera_snap',
      'camera_clip',
      'screen_record',
      'photos_pick',
      'audio_transcribe',
      'image_generate',
      'image_edit',
    ],
  },
  {
    name: 'device',
    toolNames: ['device_query', 'location_current'],
  },
  {
    name: 'communication',
    toolNames: [
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'share_text',
      'notification_send',
      'reminder',
      'clipboard_read',
      'clipboard_write',
      'speak',
      'open_url',
      'poll_create',
    ],
  },
  {
    name: 'workspace_files',
    toolNames: ['workspace_status', 'workspace_launch_browser', 'workspace_delegate_task'],
  },
  {
    name: 'pdf',
    toolNames: ['pdf_read'],
  },
  {
    name: 'cron',
    toolNames: ['cron'],
  },
  {
    name: 'memory_search',
    toolNames: ['memory_search'],
  },
];

export function getToolManagerCategoryForToolName(toolName: string): string {
  for (const category of TOOL_CATEGORIES) {
    if (category.toolNames.includes(toolName)) {
      return category.name;
    }
  }

  const inferredCategory = inferToolCapabilityDescriptor({
    name: toolName,
    description: toolName,
  } as Pick<ToolDefinition, 'name' | 'description'>).category;
  if (inferredCategory && inferredCategory !== 'other') {
    return inferredCategory === 'workspace_files' ? 'workspace_files' : inferredCategory;
  }

  return 'other';
}

export function mapDeferredCategoryToToolCatalogCategory(category: string): string | null {
  const legacyWebCategory = ['web', 'research'].join('_');
  const mapping: Record<string, string> = {
    workspace_search: 'files',
    code: 'code',
    web: 'web',
    [legacyWebCategory]: 'web',
    browser: 'browser',
    canvas: 'canvas',
    ssh: 'ssh',
    calendar: 'calendar',
    contacts: 'contacts',
    expo: 'expo',
    expo_manual_actions: 'expo',
    github: 'github',
    sessions: 'sessions',
    agents: 'agents',
    media: 'media',
    device: 'native',
    communication: 'interaction',
    workspace_files: 'workspace',
    pdf: 'pdf',
    cron: 'automation',
    memory_search: 'memory',
    mcp: 'mcp',
    skills: 'skills',
  };

  return mapping[category] ?? null;
}
