import { executeTool, loadMemory } from '../helpers/toolsExecutorHarness';

describe('executeTool', () => {
  const CONV_ID = 'test-conversation';

  describe('unknown tool', () => {
    it('should return error for unknown tools', async () => {
      const result = await executeTool('nonexistent_tool', '{}', CONV_ID);
      expect(result).toContain('Error');
      expect(result).toContain('unknown tool');
    });
  });

  describe('invalid JSON', () => {
    it('should handle invalid JSON args gracefully', async () => {
      const result = await executeTool('read_file', 'not json', CONV_ID);
      expect(typeof result).toBe('string');
    });
  });

  describe('path sanitization', () => {
    it('should strip path traversal attempts', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'safe.txt', content: 'safe' }),
        CONV_ID,
      );

      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '../../../etc/passwd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('should strip URL-encoded path traversal', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '..%2F..%2F..%2Fetc%2Fpasswd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });

    it('should strip backslash path traversal', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '..\\..\\..\\etc\\passwd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });

    it('should strip null bytes', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: 'safe.txt\0.evil' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });
  });
});

describe('loadMemory', () => {
  it('should return null when no memory exists', async () => {
    const result = await loadMemory('nonexistent');
    expect(result).toBeNull();
  });
});
