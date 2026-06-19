import type { ToolCatalogCategoryConfig } from './builtin-tool-catalogTypes';

export const TOOL_CATALOG_CATEGORIES: Record<string, ToolCatalogCategoryConfig> = {
  files: {
    tools: ['glob_search', 'text_search', 'read_file', 'list_files', 'write_file', 'file_edit'],
    purpose: 'Search, read, create, and edit files in the conversation workspace.',
  },
  browser: {
    tools: [
      'browser_launch',
      'browser_navigate',
      'browser_snapshot',
      'browser_screenshot',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_console',
      'browser_errors',
      'browser_network',
      'browser_cookies',
      'browser_storage',
      'browser_status',
      'browser_evaluate',
      'browser_upload',
      'browser_download',
      'browser_pdf',
      'browser_fill_form',
      'browser_dialog',
    ],
    purpose: 'Launch and control websites interactively.',
  },
  workspace: {
    tools: ['workspace_status', 'workspace_launch_browser', 'workspace_delegate_task'],
    purpose: 'Inspect and control configured external workspace targets.',
  },
  web: {
    tools: ['web_search', 'web_fetch'],
    purpose: 'Search the web and fetch online documentation or pages.',
  },
  canvas: {
    tools: [
      'canvas_list',
      'canvas_read',
      'canvas_create',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
    ],
    purpose: 'Create, inspect, read, update, evaluate, and capture session canvas previews.',
  },
  ssh: {
    tools: [
      'ssh_exec',
      'ssh_background_job_status',
      'ssh_background_job_wait',
      'ssh_list_directory',
      'ssh_read_file',
      'ssh_write_file',
      'ssh_rename_path',
      'ssh_delete_path',
      'ssh_make_directory',
    ],
    purpose: 'Execute commands and work with files on configured SSH targets.',
  },
  expo: {
    tools: [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_build',
      'expo_eas_update',
      'expo_eas_submit',
      'expo_eas_deploy_web',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ],
    purpose: 'Inspect or operate Expo and EAS projects, builds, updates, and workflows.',
  },
  github: {
    tools: [],
    purpose:
      'Commit, inspect, and monitor GitHub repositories through installed skill or MCP tools.',
  },
  sessions: {
    tools: [
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
      'wait',
    ],
    purpose: 'Manage sub-agents, background sessions, and waiting states.',
  },
  agents: {
    tools: ['agents'],
    purpose: 'Inspect, switch, or configure agent/persona behavior.',
  },
  calendar: {
    tools: ['calendar_list', 'calendar_events', 'calendar_create_event', 'calendar_update_event'],
    purpose: 'Inspect device calendars and create or update events.',
  },
  contacts: {
    tools: [
      'contacts_pick',
      'contacts_manage_access',
      'contacts_form',
      'contacts_share',
      'contacts_search',
      'contacts_get',
      'contacts_search_full',
      'contacts_get_full',
    ],
    purpose:
      'Pick, inspect, edit, create, and share device contacts with privacy-first native flows.',
  },
  native: {
    tools: [
      'email_compose',
      'sms_compose',
      'phone_call',
      'maps_open',
      'location_current',
      'device_permissions',
      'clipboard_write',
      'clipboard_read',
      'clipboard',
      'share_text',
      'share',
      'open_url',
      'notification_send',
      'notification_schedule',
      'notification_cancel',
      'device_query',
      'photos_latest',
      'camera_clip',
      'screen_record',
    ],
    purpose: 'Device, clipboard, notifications, location, sharing, and other mobile utility tools.',
  },
  media: {
    tools: ['camera_snap', 'audio_transcribe', 'speak', 'image_generate', 'image_edit'],
    purpose: 'Capture, generate, or edit media and speech.',
  },
  memory: {
    tools: ['memory_search', 'memory_recall', 'memory_remember', 'memory_manage'],
    purpose:
      'Read, write, search, and manage structured living-memory facts and workflow evidence.',
  },
  automation: {
    tools: ['cron', 'notification_send', 'notification_schedule'],
    purpose: 'Create scheduled tasks, cron jobs, and user alerts.',
  },
  code: {
    tools: ['javascript', 'python'],
    purpose:
      'Run sandboxed JavaScript or Python for calculations, data transformation, script execution, and capability-extension workflows.',
  },
  pdf: {
    tools: ['pdf_read'],
    purpose: 'Read and extract content from PDF documents.',
  },
  interaction: {
    tools: ['poll_create'],
    purpose: 'Interactive response helpers such as polls.',
  },
};

export const TOOL_CATALOG_AVAILABLE_CATEGORIES = [
  ...Object.keys(TOOL_CATALOG_CATEGORIES),
  'mcp',
  'skills',
];
