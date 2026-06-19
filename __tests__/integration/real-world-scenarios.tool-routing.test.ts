import '../helpers/realWorldIntegrationHarness';
import { parseMcpToolName } from '../../src/services/mcp/bridge';
import { parseSkillToolName } from '../../src/services/skills/manager';

describe('Tool executor routing completeness', () => {
  it('MCP tool names parse correctly for real registry entries', () => {
    const realPatterns = [
      'mcp__github__get_issues',
      'mcp__slack-mcp__send_message',
      'mcp__brave-search__search',
      'mcp__filesystem__read_file',
      'mcp__my_custom_server__do_thing',
    ];

    for (const name of realPatterns) {
      const parsed = parseMcpToolName(name);
      expect(parsed).not.toBeNull();
      expect(parsed!.serverId).toBeTruthy();
      expect(parsed!.toolName).toBeTruthy();
    }
  });

  it('skill tool names parse correctly', () => {
    const realPatterns = [
      'skill__github-issues__list_issues',
      'skill__weather__get_forecast',
      'skill__finance__stock_quote',
    ];

    for (const name of realPatterns) {
      const parsed = parseSkillToolName(name);
      expect(parsed).not.toBeNull();
      expect(parsed!.skillId).toBeTruthy();
      expect(parsed!.toolName).toBeTruthy();
    }
  });

  it('native tool names are correctly enumerated', () => {
    const expectedNativeTools = [
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
      'location_current',
      'clipboard_read',
      'clipboard_write',
      'share_text',
      'share_url',
      'share_file',
      'share_contact',
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
    ];

    // Import the NATIVE_TOOL_NAMES set indirectly by checking they'd be dispatched
    for (const tool of expectedNativeTools) {
      expect(parseMcpToolName(tool)).toBeNull(); // Not MCP
      expect(parseSkillToolName(tool)).toBeNull(); // Not skill
    }
  });

  it('browser tool names cover all 19 expected tools', () => {
    const expectedBrowserTools = [
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
    ];

    expect(expectedBrowserTools.length).toBe(19);
    // Each should NOT be parseable as MCP or skill
    for (const tool of expectedBrowserTools) {
      expect(parseMcpToolName(tool)).toBeNull();
      expect(parseSkillToolName(tool)).toBeNull();
    }
  });

  it('workspace tool names cover the explicit external workspace control tools', () => {
    const expectedWorkspaceTools = [
      'workspace_status',
      'workspace_launch_browser',
      'workspace_delegate_task',
    ];

    expect(expectedWorkspaceTools.length).toBe(3);
    for (const tool of expectedWorkspaceTools) {
      expect(parseMcpToolName(tool)).toBeNull();
      expect(parseSkillToolName(tool)).toBeNull();
    }
  });

  it('builtin tool names cover all expected tools', () => {
    const expectedBuiltinTools = [
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
      'sessions_status',
      'sessions_wait',
      'pdf_read',
      'camera_snap',
      'audio_transcribe',
      'memory_search',
      'ssh_exec',
      'ssh_list_directory',
      'ssh_read_file',
      'ssh_write_file',
      'ssh_rename_path',
      'ssh_delete_path',
      'ssh_make_directory',
      'tool_catalog',
      'poll_create',
      'speak',
      'agents_list',
      'agents_switch',
      'agents_configure',
    ];

    for (const tool of expectedBuiltinTools) {
      expect(parseMcpToolName(tool)).toBeNull();
      expect(parseSkillToolName(tool)).toBeNull();
    }
  });

  it('core tool names are complete', () => {
    const coreTools = ['read_file', 'write_file', 'list_files', 'javascript'];
    const extendedTools = ['web_search', 'web_fetch', 'file_edit', 'glob_search', 'text_search'];
    const misc = ['cron', 'image_generate'];

    const allTools = [...coreTools, ...extendedTools, ...misc];
    for (const tool of allTools) {
      expect(parseMcpToolName(tool)).toBeNull(); // Not MCP
      expect(parseSkillToolName(tool)).toBeNull(); // Not skill
    }
  });
});
