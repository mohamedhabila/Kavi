import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { requiresActionApproval } from '../../src/services/remote/approvalPolicy';

// Approval follows each tool's contract (`riskHints: ['requires_approval']`). A hand-kept
// list used to decide instead, disagreeing with the contracts both ways: GitHub commits,
// branches, pull requests and issues and Expo project creation ran without asking.
const ARGUMENT_DEPENDENT = new Set([
  'ssh_fs',
  'browser_cookies',
  'browser_storage',
  'open_url',
  'reminder',
]);

describe('approval follows tool contracts', () => {
  it('asks before exactly the tools whose contract requires approval', () => {
    const mismatches = TOOL_DEFINITIONS.filter((tool) => !ARGUMENT_DEPENDENT.has(tool.name))
      .filter(
        (tool) =>
          requiresActionApproval(tool.name, {}) !==
          (tool.contract?.riskHints?.includes('requires_approval') ?? false),
      )
      .map((tool) => tool.name);

    expect(mismatches).toEqual([]);
  });

  it.each([
    'skill__github__commit_files',
    'skill__github__create_branch',
    'skill__github__create_pull_request',
    'skill__github__create_issue',
    'expo_eas_create_project',
    'expo_eas_graphql',
    'ssh_exec',
    'browser_click',
    'calendar_list',
    'contacts_search',
    'memory_forget',
    'python',
    'javascript',
  ])('asks before %s', (toolName) => {
    expect(requiresActionApproval(toolName, {})).toBe(true);
  });

  it.each(['sessions_spawn', 'web_fetch', 'browser_screenshot'])(
    'lets %s run without asking',
    (toolName) => {
      expect(requiresActionApproval(toolName, {})).toBe(false);
    },
  );

  it('never marks a GitHub mutation read-only', () => {
    for (const name of ['skill__github__create_branch', 'skill__github__create_pull_request']) {
      const hints = TOOL_DEFINITIONS.find((tool) => tool.name === name)?.contract?.riskHints;
      expect(hints).not.toContain('read_only');
    }
  });

  it('keeps the argument rules', () => {
    expect(requiresActionApproval('ssh_fs', { action: 'read' })).toBe(false);
    expect(requiresActionApproval('ssh_fs', { action: 'write' })).toBe(true);
    expect(requiresActionApproval('open_url', { url: 'https://example.com' })).toBe(false);
    expect(requiresActionApproval('open_url', { url: 'tel:+15550100' })).toBe(true);
    expect(requiresActionApproval('browser_storage', { action: 'set' })).toBe(true);
    expect(requiresActionApproval('mcp__server__tool', {})).toBe(true);
  });
});
