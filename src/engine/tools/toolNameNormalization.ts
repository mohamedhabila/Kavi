// ---------------------------------------------------------------------------
// Kavi — Tool Name Normalization
// ---------------------------------------------------------------------------
// Shared between the dispatcher and worker policy code so canonical tool names
// stay consistent without importing the full tool executor graph.

const NATIVE_TOOL_NAMES = new Set([
  'calendar_list',
  'calendar_events',
  'calendar_create_event',
  'email_compose',
  'sms_compose',
  'phone_call',
  'maps_open',
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
  'location_current',
  'clipboard_read',
  'clipboard_write',
  'share_text',
  'share_url',
  'share_file',
  'share_contact',
  'share',
  'open_url',
  'notification_send',
  'notification_schedule',
  'device_status',
  'device_info',
  'device_permissions',
  'device_health',
  'photos_latest',
  'camera_clip',
  'screen_record',
  'haptic_feedback',
]);

const PARITY_TOOL_NAMES = new Set([
  'canvas_list',
  'canvas_read',
  'canvas_create',
  'canvas_update',
  'canvas_delete',
  'canvas_navigate',
  'canvas_eval',
  'canvas_snapshot',
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
  'pdf_read',
  'camera_snap',
  'audio_transcribe',
  'memory_search',
  'ssh_exec',
  'ssh_background_job_status',
  'ssh_background_job_wait',
  'ssh_list_directory',
  'ssh_read_file',
  'ssh_write_file',
  'ssh_rename_path',
  'ssh_delete_path',
  'ssh_make_directory',
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
  'tool_catalog',
  'poll_create',
  'message_effect',
  'speak',
  'agents_list',
  'agents_switch',
  'agents_configure',
]);

const BROWSER_TOOL_NAMES = new Set([
  'browser_launch',
  'browser_stop',
  'browser_status',
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
  'browser_console',
  'browser_errors',
  'browser_network',
  'browser_cookies',
  'browser_storage',
  'browser_evaluate',
  'browser_upload',
  'browser_download',
  'browser_pdf',
  'browser_fill_form',
  'browser_dialog',
]);

const WORKSPACE_TOOL_NAMES = new Set([
  'workspace_read_file',
  'workspace_write_file',
  'workspace_list_files',
  'workspace_mkdir',
  'workspace_rename',
  'workspace_delete',
  'workspace_status',
  'workspace_launch_browser',
  'workspace_delegate_task',
]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  search: 'web_search',
  search_web: 'web_search',
  websearch: 'web_search',
  google: 'web_search',
  browse: 'web_fetch',
  fetch: 'fetch_url',
  http_fetch: 'fetch_url',
  notification: 'notify',
  send_notification: 'notify',
  notification_send: 'notify',
  run_javascript: 'javascript',
  run_js: 'javascript',
  exec_js: 'javascript',
  execute_javascript: 'javascript',
  execute_js: 'javascript',
  run_python: 'python',
  run_py: 'python',
  exec_python: 'python',
  execute_python: 'python',
  execute_py: 'python',
  python3: 'python',
  code: 'javascript',
  eval: 'javascript',
  image_gen: 'image_generate',
  generate_image: 'image_generate',
  dalle: 'image_generate',
  edit_image: 'image_edit',
  image_editor: 'image_edit',
  image_editing: 'image_edit',
  modify_image: 'image_edit',
  create_canvas: 'canvas_create',
  read_canvas: 'canvas_read',
  inspect_canvas: 'canvas_read',
  update_canvas: 'canvas_update',
  eval_canvas: 'canvas_eval',
  list_canvas: 'canvas_list',
  delete_canvas: 'canvas_delete',
  navigate_canvas: 'canvas_navigate',
  snapshot_canvas: 'canvas_snapshot',
  edit_file: 'file_edit',
  replace_in_file: 'file_edit',
  search_files: 'glob_search',
  find_files: 'glob_search',
  grep: 'text_search',
  search_text: 'text_search',
  save_memory: 'update_memory',
  write_memory: 'update_memory',
  memory_update: 'update_memory',
  memory_read: 'read_memory',
  record_evidence: 'record_workflow_evidence',
  save_evidence: 'record_workflow_evidence',
  write_workflow_evidence: 'record_workflow_evidence',
  workflow_evidence_write: 'record_workflow_evidence',
  read_evidence: 'read_workflow_evidence',
  workflow_evidence_read: 'read_workflow_evidence',
  send_email: 'email_compose',
  compose_email: 'email_compose',
  send_sms: 'sms_compose',
  compose_sms: 'sms_compose',
  dial_phone: 'phone_call',
  open_maps: 'maps_open',
  pick_contact: 'contacts_pick',
  manage_contact_access: 'contacts_manage_access',
  contacts_access_picker: 'contacts_manage_access',
  contacts_expand_access: 'contacts_manage_access',
  view_contact: 'contacts_view',
  edit_contact: 'contacts_edit',
  create_contact: 'contacts_create',
  search_contacts: 'contacts_search_full',
  get_contact: 'contacts_get_full',
  schedule_task: 'create_task',
  cron_create: 'create_task',
};

const ALL_KNOWN_TOOL_NAMES = new Set([
  ...NATIVE_TOOL_NAMES,
  ...PARITY_TOOL_NAMES,
  ...BROWSER_TOOL_NAMES,
  ...WORKSPACE_TOOL_NAMES,
  'read_file',
  'write_file',
  'list_files',
  'fetch_url',
  'update_memory',
  'read_memory',
  'record_workflow_evidence',
  'read_workflow_evidence',
  'create_task',
  'javascript',
  'python',
  'web_search',
  'web_fetch',
  'file_edit',
  'glob_search',
  'text_search',
  'cron',
  'notify',
  'image_generate',
  'image_edit',
]);

function stripToolPrefix(value: string): string {
  return value.replace(/^(functions?|tools?|actions?)[._]/, '');
}

function normalizeToolCandidate(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toLowerCase();
}

function resolveKnownToolName(candidate: string): string | undefined {
  if (!candidate) {
    return undefined;
  }

  const aliased = TOOL_NAME_ALIASES[candidate];
  if (aliased) {
    return aliased;
  }

  for (const known of ALL_KNOWN_TOOL_NAMES) {
    if (known.toLowerCase() === candidate) {
      return known;
    }
  }

  return undefined;
}

export function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return name;
  }

  if (ALL_KNOWN_TOOL_NAMES.has(trimmed)) {
    return trimmed;
  }

  const directMatch = resolveKnownToolName(trimmed.toLowerCase());
  if (directMatch) {
    return directMatch;
  }

  const strippedDirectMatch = resolveKnownToolName(stripToolPrefix(trimmed.toLowerCase()));
  if (strippedDirectMatch) {
    return strippedDirectMatch;
  }

  const normalizedCandidate = normalizeToolCandidate(trimmed);
  const normalizedMatch = resolveKnownToolName(normalizedCandidate);
  if (normalizedMatch) {
    return normalizedMatch;
  }

  const strippedNormalizedMatch = resolveKnownToolName(stripToolPrefix(normalizedCandidate));
  if (strippedNormalizedMatch) {
    return strippedNormalizedMatch;
  }

  return trimmed;
}
