// ---------------------------------------------------------------------------
// Tests — Security: Tool Permissions & Audit
// ---------------------------------------------------------------------------

import { useToolPermissionsStore } from '../../src/services/security/permissions';
import {
  logToolCall,
  logApiCall,
  getRecentAuditEntries,
  getAuditStats,
  clearAuditLog,
  logAuditEntry,
} from '../../src/services/security/audit';

describe('useToolPermissionsStore', () => {
  beforeEach(() => {
    useToolPermissionsStore.setState({ permissions: [] });
  });

  it('starts with empty permissions', () => {
    const { permissions } = useToolPermissionsStore.getState();
    expect(permissions).toEqual([]);
  });

  it('defaults isAllowed to true for unconfigured tool', () => {
    expect(useToolPermissionsStore.getState().isAllowed('read_file')).toBe(true);
  });

  it('setPermission adds new permission', () => {
    const { setPermission } = useToolPermissionsStore.getState();
    setPermission('read_file', true);
    const { permissions } = useToolPermissionsStore.getState();
    expect(permissions).toHaveLength(1);
    expect(permissions[0].toolName).toBe('read_file');
  });

  it('setPermission updates existing permission', () => {
    const { setPermission } = useToolPermissionsStore.getState();
    setPermission('read_file', true);
    setPermission('read_file', false);
    const { permissions } = useToolPermissionsStore.getState();
    expect(permissions).toHaveLength(1);
    expect(permissions[0].allowed).toBe(false);
  });

  it('isAllowed returns false when denied', () => {
    useToolPermissionsStore.getState().setPermission('write_file', false);
    expect(useToolPermissionsStore.getState().isAllowed('write_file')).toBe(false);
  });

  it('requiresConfirmation returns true for ALWAYS_CONFIRM tools', () => {
    expect(useToolPermissionsStore.getState().requiresConfirmation('write_file')).toBe(true);
    expect(useToolPermissionsStore.getState().requiresConfirmation('file_edit')).toBe(true);
    expect(useToolPermissionsStore.getState().requiresConfirmation('email_compose')).toBe(true);
    expect(useToolPermissionsStore.getState().requiresConfirmation('contacts_manage_access')).toBe(
      true,
    );
    expect(useToolPermissionsStore.getState().requiresConfirmation('contacts_search_full')).toBe(
      true,
    );
  });

  it('requiresConfirmation returns false for non-dangerous tools', () => {
    expect(useToolPermissionsStore.getState().requiresConfirmation('read_file')).toBe(false);
  });

  it('removePermission removes a permission', () => {
    const { setPermission, removePermission } = useToolPermissionsStore.getState();
    setPermission('read_file', false);
    expect(useToolPermissionsStore.getState().permissions).toHaveLength(1);
    removePermission('read_file');
    expect(useToolPermissionsStore.getState().permissions).toHaveLength(0);
  });

  it('reset clears all permissions', () => {
    const { setPermission, reset } = useToolPermissionsStore.getState();
    setPermission('a', true);
    setPermission('b', false);
    reset();
    expect(useToolPermissionsStore.getState().permissions).toEqual([]);
  });

  it('getAllowed returns empty set when no allowed tools', () => {
    const allowed = useToolPermissionsStore.getState().getAllowed();
    expect(allowed.size).toBe(0);
  });

  it('getAllowed returns set of allowed tool names', () => {
    const { setPermission } = useToolPermissionsStore.getState();
    setPermission('dangerous_tool', false);
    setPermission('safe_tool', true);
    const allowed = useToolPermissionsStore.getState().getAllowed();
    expect(allowed.has('dangerous_tool')).toBe(false);
    expect(allowed.has('safe_tool')).toBe(true);
  });

  it('getAllowed returns multiple allowed tools', () => {
    const { setPermission } = useToolPermissionsStore.getState();
    setPermission('tool_a', false);
    setPermission('tool_b', false);
    setPermission('tool_c', true);
    const allowed = useToolPermissionsStore.getState().getAllowed();
    expect(allowed.size).toBe(1);
    expect(allowed.has('tool_c')).toBe(true);
  });
});

describe('Audit logging', () => {
  beforeEach(() => {
    clearAuditLog();
  });

  it('logToolCall adds entry', () => {
    logToolCall('read_file', '{"path":"test"}', 'success', 100, 'conv1');
    const entries = getRecentAuditEntries(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('tool_call');
    expect(entries[0].toolName).toBe('read_file');
    expect(entries[0].result).toBe('success');
  });

  it('logApiCall adds entry', () => {
    logApiCall('provider1', 'gpt-5.4', 'success', 200);
    const entries = getRecentAuditEntries(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('api_call');
    expect(entries[0].providerId).toBe('provider1');
  });

  it('truncates long arguments', () => {
    const longArgs = 'x'.repeat(1000);
    logToolCall('test', longArgs, 'success', 50, 'conv1');
    const entries = getRecentAuditEntries(1);
    expect(entries[0].arguments!.length).toBeLessThanOrEqual(504); // 500 + '...'
  });

  it('getAuditStats returns correct counts', () => {
    logToolCall('read_file', '{}', 'success', 10, 'c1');
    logToolCall('read_file', '{}', 'error', 10, 'c1', 'fail');
    logToolCall('write_file', '{}', 'success', 10, 'c1');

    const stats = getAuditStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.errorCount).toBe(1);
    expect(stats.toolCounts['read_file']).toBe(2);
    expect(stats.toolCounts['write_file']).toBe(1);
  });

  it('clearAuditLog empties the buffer', () => {
    logToolCall('test', '{}', 'success', 10, 'c1');
    clearAuditLog();
    expect(getRecentAuditEntries(10)).toEqual([]);
  });

  it('getRecentAuditEntries respects count limit', () => {
    for (let i = 0; i < 10; i++) {
      logToolCall(`tool_${i}`, '{}', 'success', 10, 'c1');
    }
    expect(getRecentAuditEntries(3)).toHaveLength(3);
  });

  it('logAuditEntry includes error field', () => {
    logToolCall('test', '{}', 'error', 10, 'c1', 'something broke');
    const entries = getRecentAuditEntries(1);
    expect(entries[0].error).toBe('something broke');
  });
});
