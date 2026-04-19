// ---------------------------------------------------------------------------
// Audit Log — tests
// ---------------------------------------------------------------------------

// Mock expo-file-system NEW API
const mockFileText = jest.fn().mockReturnValue('');
const mockFileWrite = jest.fn();
let mockFileExists = false;
const mockDirExists = false;
const mockDirCreate = jest.fn();
const mockDirDelete = jest.fn();

jest.mock('expo-file-system', () => {
  return {
    Paths: { document: '/docs' },
    File: jest.fn().mockImplementation(() => ({
      get exists() {
        return mockFileExists;
      },
      text: mockFileText,
      write: mockFileWrite,
    })),
    Directory: jest.fn().mockImplementation(() => ({
      get exists() {
        return mockDirExists;
      },
      create: mockDirCreate,
      delete: mockDirDelete,
    })),
  };
});

import {
  logAuditEntry,
  logToolCall,
  logApiCall,
  getAuditLogVersion,
  getRecentAuditEntries,
  getAuditStats,
  clearAuditLog,
} from '../../src/services/security/audit';

describe('Audit Log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileExists = false;
    clearAuditLog();
  });

  it('logAuditEntry adds to buffer', () => {
    logAuditEntry({
      timestamp: Date.now(),
      type: 'tool_call',
      toolName: 'read_file',
      result: 'success',
    });
    const entries = getRecentAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].toolName).toBe('read_file');
  });

  it('logToolCall creates correct entry', () => {
    logToolCall('write_file', '{"path":"test.txt"}', 'success', 50, 'conv1');
    const entries = getRecentAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe('tool_call');
    expect(entries[0].toolName).toBe('write_file');
    expect(entries[0].duration).toBe(50);
    expect(entries[0].conversationId).toBe('conv1');
  });

  it('logToolCall redacts sensitive native action arguments', () => {
    logToolCall(
      'email_compose',
      JSON.stringify({
        recipients: ['jane@example.com'],
        subject: 'Private subject',
        body: 'Secret body',
      }),
      'success',
      10,
      'conv1',
    );
    const entries = getRecentAuditEntries();
    expect(entries[0].category).toBe('native');
    expect(entries[0].summary).toContain('recipient');
    expect(entries[0].arguments).not.toContain('jane@example.com');
    expect(entries[0].arguments).not.toContain('Private subject');
    expect(entries[0].piiRedacted).toBe(true);
  });

  it('logToolCall records errors', () => {
    logToolCall('fail_tool', '{}', 'error', 100, 'conv1', 'Something broke');
    const entries = getRecentAuditEntries();
    expect(entries[0].result).toBe('error');
    expect(entries[0].error).toBe('Something broke');
  });

  it('logApiCall creates correct entry', () => {
    logApiCall('openai', 'gpt-5.4', 'success', 200);
    const entries = getRecentAuditEntries();
    expect(entries[0].type).toBe('api_call');
    expect(entries[0].providerId).toBe('openai');
    expect(entries[0].model).toBe('gpt-5.4');
  });

  it('logApiCall with error', () => {
    logApiCall('openai', 'gpt-5.4', 'error', 5000, 'Rate limited');
    const entries = getRecentAuditEntries();
    expect(entries[0].result).toBe('error');
    expect(entries[0].error).toBe('Rate limited');
  });

  it('getRecentAuditEntries returns last N entries', () => {
    for (let i = 0; i < 10; i++) {
      logAuditEntry({ timestamp: i, type: 'tool_call', toolName: `tool${i}`, result: 'success' });
    }
    const entries = getRecentAuditEntries(3);
    expect(entries.length).toBe(3);
    expect(entries[0].toolName).toBe('tool7');
  });

  it('getAuditStats returns correct stats', () => {
    logAuditEntry({ timestamp: 1, type: 'tool_call', toolName: 'read_file', result: 'success' });
    logAuditEntry({ timestamp: 2, type: 'tool_call', toolName: 'read_file', result: 'success' });
    logAuditEntry({ timestamp: 3, type: 'tool_call', toolName: 'write_file', result: 'error' });
    logAuditEntry({ timestamp: 4, type: 'api_call', result: 'success' });

    const stats = getAuditStats();
    expect(stats.totalCalls).toBe(4);
    expect(stats.errorCount).toBe(1);
    expect(stats.toolCounts['read_file']).toBe(2);
    expect(stats.toolCounts['write_file']).toBe(1);
  });

  it('tracks audit log version and category-filtered stats', () => {
    const startVersion = getAuditLogVersion();
    logToolCall(
      'email_compose',
      JSON.stringify({ recipients: ['jane@example.com'] }),
      'success',
      12,
      'conv1',
    );
    logToolCall('ssh_exec', JSON.stringify({ command: 'ls -la' }), 'error', 20, 'conv1', 'failed');

    expect(getAuditLogVersion()).toBeGreaterThan(startVersion);

    const nativeStats = getAuditStats({ category: 'native', type: 'tool_call' });
    expect(nativeStats.totalCalls).toBe(1);
    expect(nativeStats.errorCount).toBe(0);
    expect(nativeStats.toolCounts['email_compose']).toBe(1);
  });

  it('clearAuditLog empties buffer', () => {
    logAuditEntry({ timestamp: 1, type: 'tool_call', result: 'success' });
    expect(getRecentAuditEntries().length).toBe(1);
    clearAuditLog();
    expect(getRecentAuditEntries().length).toBe(0);
  });

  it('buffer caps at MAX_ENTRIES_IN_MEMORY', () => {
    // Add 600 entries (max is 500)
    for (let i = 0; i < 600; i++) {
      logAuditEntry({ timestamp: i, type: 'tool_call', result: 'success' });
    }
    const entries = getRecentAuditEntries(1000);
    expect(entries.length).toBeLessThanOrEqual(500);
  });

  describe('disk persistence', () => {
    it('writes to disk when file does not exist', () => {
      mockFileExists = false;
      logAuditEntry({ timestamp: 1, type: 'tool_call', result: 'success' });
      expect(mockFileWrite).toHaveBeenCalled();
    });

    it('appends to existing file on disk', async () => {
      mockFileExists = true;
      mockFileText.mockReturnValue('{"timestamp":0,"type":"tool_call","result":"success"}\n');
      logAuditEntry({ timestamp: 1, type: 'tool_call', result: 'success' });
      await new Promise(process.nextTick);
      expect(mockFileWrite).toHaveBeenCalled();
      const written = mockFileWrite.mock.calls[0][0];
      expect(written).toContain('timestamp');
    });

    it('trims old entries when file exceeds max disk entries', async () => {
      mockFileExists = true;
      // Create a large string simulating many stored entries
      const lines = Array.from({ length: 1100 }, (_, i) =>
        JSON.stringify({ timestamp: i, type: 'tool_call', result: 'success' }),
      ).join('\n');
      mockFileText.mockReturnValue(lines);
      logAuditEntry({ timestamp: 9999, type: 'tool_call', result: 'success' });
      await new Promise(process.nextTick);
      expect(mockFileWrite).toHaveBeenCalled();
    });

    it('handles disk write errors gracefully', () => {
      mockFileExists = false;
      mockFileWrite.mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      // Should not throw
      logAuditEntry({ timestamp: 1, type: 'tool_call', result: 'success' });
      // Entry should still be in buffer
      const entries = getRecentAuditEntries();
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
